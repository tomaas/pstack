import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TREE = "harness/pstack/t3";
// A fork whose committed tree carries an overlay runs these tests with PSTACK_T3_OVERLAY set to it.
const COMMITTED_OVERLAY = process.env.PSTACK_T3_OVERLAY;
const FIXTURE = "overlay-fixture";
const temps = [];
after(() => temps.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

// The generators read only these folders, so the copy leaves out the other plugins.
function copyRepo() {
  const dir = mkdtempSync(join(tmpdir(), "pstack-t3-gen-"));
  temps.push(dir);
  for (const name of ["pstack", "scripts", "harness", ...(COMMITTED_OVERLAY ? [COMMITTED_OVERLAY] : [])]) {
    if (existsSync(join(ROOT, name))) {
      cpSync(join(ROOT, name), join(dir, name), { recursive: true, filter: (src) => !src.includes("node_modules") });
    }
  }
  return dir;
}

// `overlay: false` runs with no overlay at all, whatever PSTACK_T3_OVERLAY says.
function run(dir, script, args = [], { overlay = true } = {}) {
  const env = { ...process.env };
  if (!overlay) delete env.PSTACK_T3_OVERLAY;
  const result = spawnSync(process.execPath, [join(dir, "scripts", script), ...args], { encoding: "utf8", env });
  return { status: result.status, output: result.stdout + result.stderr };
}
const generate = (dir, ...args) => run(dir, "generate-pstack-t3-tree.mjs", args);
const generateClean = (dir, ...args) => run(dir, "generate-pstack-t3-tree.mjs", args, { overlay: false });
const withFixture = (dir, ...args) => run(dir, "generate-pstack-t3-tree.mjs", [...args, "--overlay", FIXTURE]);

function edit(dir, path, change) {
  const full = join(dir, path);
  writeFileSync(full, change(readFileSync(full, "utf8")));
}

const WATCH_PR_ROW = "| `scripts/watch-pr/watch-pr` |";
function watchPrRow(text) {
  const row = text.split("\n").find((line) => line.startsWith(WATCH_PR_ROW));
  assert.ok(row);
  return row;
}

function addExtra(dir, name, body) {
  mkdirSync(join(dir, FIXTURE, "extra", name), { recursive: true });
  writeFileSync(join(dir, FIXTURE, "extra", name, "SKILL.md"), body);
}

function addPatch(dir, name, body) {
  mkdirSync(join(dir, FIXTURE, "patches"), { recursive: true });
  writeFileSync(join(dir, FIXTURE, "patches", name), body);
}

describe("scripts/generate-pstack-t3-tree.mjs", () => {
  it("passes --check on the committed tree", () => {
    const result = generate(copyRepo(), "--check");
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /is up to date/);
  });

  it("fails --check when the tree is stale", () => {
    const dir = copyRepo();
    writeFileSync(join(dir, TREE, "skills/how/SKILL.md"), "edited by hand\n");
    const result = generate(dir, "--check");
    assert.equal(result.status, 1);
    assert.match(result.output, /harness\/pstack\/t3\/skills\/how\/SKILL\.md/);
    assert.match(result.output, /out of date/);
  });

  it("renders a tree with the adapter line and no local changes without --overlay", () => {
    const dir = copyRepo();
    const result = generateClean(dir);
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /0 patches, 0 extras/);
    const skill = readFileSync(join(dir, TREE, "skills/poteto-mode/SKILL.md"), "utf8");
    assert.ok(skill.includes("In T3 Code, read [the Claude Code adapter](../../docs/harness/claude-code.md), then [the T3 adapter](../../docs/harness/t3.md)"));
    assert.doesNotMatch(readFileSync(join(dir, TREE, "GENERATED.md"), "utf8"), /overlay/);
    assert.equal(generateClean(dir, "--check").status, 0);
  });

  it("fails when --overlay names a missing folder or no folder", () => {
    const dir = copyRepo();
    assert.match(generate(dir, "--check", "--overlay", "no-such-overlay").output, /FAIL no overlay folder at no-such-overlay/);
    const bare = generate(dir, "--check", "--overlay");
    assert.equal(bare.status, 64);
    assert.match(bare.output, /FAIL --overlay needs a folder/);
  });

  it("leaves the t3 tree to this script when upstream's generator rewrites harness/pstack", () => {
    const dir = copyRepo();
    const upstream = run(dir, "generate-pstack-harness-trees.mjs");
    assert.equal(upstream.status, 0, upstream.output);
    for (const script of ["generate-pstack-harness-trees.mjs", "generate-pstack-t3-tree.mjs"]) {
      const result = run(dir, script, ["--check"]);
      assert.equal(result.status, 0, `${script}: ${result.output}`);
    }
  });

  it("keeps upstream's --check failing on a stray file under harness/pstack outside t3/, and its write mode removing it", () => {
    const dir = copyRepo();
    writeFileSync(join(dir, "harness/pstack/stray.md"), "stray\n");
    const result = run(dir, "generate-pstack-harness-trees.mjs", ["--check"]);
    assert.equal(result.status, 1);
    assert.match(result.output, /harness\/pstack\/stray\.md/);
    assert.equal(run(dir, "generate-pstack-harness-trees.mjs").status, 0);
    assert.ok(!existsSync(join(dir, "harness/pstack/stray.md")));
    assert.ok(existsSync(join(dir, TREE, "GENERATED.md")));
  });

  it("fails when a Cursor name a skill uses has no row in the T3 adapter", () => {
    const dir = copyRepo();
    edit(dir, "pstack/docs/harness/t3.md", (text) => text.replaceAll("watch-pr", "the PR watcher script"));
    const result = generate(dir, "--check");
    assert.equal(result.status, 1);
    assert.match(result.output, /FAIL T3 adapter has no row for watch-pr, used by poteto-mode/);
  });

  it("fails when a Cursor name appears in the T3 adapter only in prose, not in a row's first cell", () => {
    const dir = copyRepo();
    edit(dir, "pstack/docs/harness/t3.md", (text) => `${text.replace(WATCH_PR_ROW, "| The PR watcher script |")}\nThe PR watcher script is \`watch-pr\`.\n`);
    const result = generate(dir, "--check");
    assert.equal(result.status, 1);
    assert.match(result.output, /FAIL T3 adapter has no row for watch-pr, used by poteto-mode/);
  });

  it("fails when the only row for a Cursor name sits inside a fenced code block", () => {
    const dir = copyRepo();
    edit(dir, "pstack/docs/harness/t3.md", (text) => {
      const row = watchPrRow(text);
      const example = ["~~~md", "```", "| Cursor | T3 Code |", "| --- | --- |", row, "```", "~~~"].join("\n");
      return `${text.replace(`${row}\n`, "")}\nAn example:\n\n${example}\n`;
    });
    const result = generate(dir, "--check");
    assert.equal(result.status, 1);
    assert.match(result.output, /FAIL T3 adapter has no row for watch-pr, used by poteto-mode/);
  });

  for (const marker of ["~~~", "```"]) {
    it(`fails when the only row sits in a ${marker} fence that holds a fence-like line indented four spaces`, () => {
      const dir = copyRepo();
      edit(dir, "pstack/docs/harness/t3.md", (text) => {
        const row = watchPrRow(text);
        const example = [`${marker}md`, `    ${marker}`, "| Cursor | T3 Code |", "| --- | --- |", row, marker].join("\n");
        return `${text.replace(`${row}\n`, "")}\nAn example:\n\n${example}\n`;
      });
      const result = generate(dir, "--check");
      assert.equal(result.status, 1);
      assert.match(result.output, /FAIL T3 adapter has no row for watch-pr, used by poteto-mode/);
    });
  }

  it("counts a row after a fence that opens with up to three spaces and closes", () => {
    const dir = copyRepo();
    edit(dir, "pstack/docs/harness/t3.md", (text) => {
      const row = watchPrRow(text);
      return `${text.replace(`${row}\n`, "")}\n   \`\`\`\nan example\n   \`\`\`\n\n| Cursor | T3 Code |\n| --- | --- |\n${row}\n`;
    });
    const result = generate(dir, "--check");
    assert.doesNotMatch(result.output, /no row for watch-pr/);
  });

  it("fails when the T3 adapter has no update_state row", () => {
    const dir = copyRepo();
    edit(dir, "pstack/docs/harness/t3.md", (text) => {
      assert.ok(text.includes("`update_state` routine calls, "));
      return text.replace("`update_state` routine calls, ", "");
    });
    const result = generate(dir, "--check");
    assert.equal(result.status, 1);
    assert.match(result.output, /FAIL T3 adapter has no row for update_state, used by make-bot-ui/);
  });

  it("fails when an upstream Cursor name sits only under a heading", () => {
    const dir = copyRepo();
    for (const name of ["claude-code.md", "t3.md"]) {
      edit(dir, `pstack/docs/harness/${name}`, (text) => `${text.replace(/^\| (A |Cursor )?[Cc]loud agents? .*\n/gm, "")}\n## Cursor cloud agents\n`);
    }
    const result = generate(dir, "--check");
    assert.equal(result.status, 1);
    assert.match(result.output, /FAIL neither adapter has a row for cloud agents/);
  });

  it("fails when an upstream Cursor name has a row in neither adapter", () => {
    const dir = copyRepo();
    for (const name of ["claude-code.md", "t3.md"]) {
      edit(dir, `pstack/docs/harness/${name}`, (text) => text.replaceAll("cloud_base_branch", "the base branch field"));
    }
    const result = generate(dir, "--check");
    assert.equal(result.status, 1);
    assert.match(result.output, /FAIL neither adapter has a row for cloud_base_branch/);
  });

  it("points every rewritten link at main and lists it in GENERATED.md", () => {
    const dir = copyRepo();
    const generated = readFileSync(join(dir, TREE, "GENERATED.md"), "utf8");
    for (const path of ["README.md", "docs/guide/07-overnight.md"]) {
      const source = readFileSync(join(dir, "pstack", path), "utf8");
      const urls = [...readFileSync(join(dir, TREE, path), "utf8").matchAll(/https:\/\/github\.com\/cursor\/plugins\/(?:blob|tree)\/[^/]+\/pstack\/[^)\s]+/g)]
        .map(([url]) => url)
        .filter((url) => !source.includes(url));
      assert.ok(urls.length > 0, path);
      for (const url of urls) {
        assert.match(url, /\/(blob|tree)\/main\/pstack\//);
        assert.ok(generated.includes(url), `${url} is not listed in GENERATED.md`);
      }
    }
  });

  it("fails when a patch no longer applies", () => {
    const dir = copyRepo();
    addPatch(
      dir,
      "99-drift.patch",
      "Why: a test patch whose context is not in the source.\n--- a/skills/how/SKILL.md\n+++ b/skills/how/SKILL.md\n@@ -1,1 +1,1 @@\n-this line is not in the file\n+replacement\n",
    );
    const result = withFixture(dir, "--check");
    assert.equal(result.status, 1);
    assert.match(result.output, /FAIL overlay-fixture\/patches\/99-drift\.patch no longer applies to skills\/how\/SKILL\.md/);
  });

  it("fails when a patch has no header saying why", () => {
    const dir = copyRepo();
    addPatch(dir, "98-bare.patch", "--- a/skills/how/SKILL.md\n+++ b/skills/how/SKILL.md\n@@ -1,1 +1,1 @@\n----\n+---\n");
    const result = withFixture(dir, "--check");
    assert.equal(result.status, 1);
    assert.match(result.output, /has no header saying why/);
  });

  it("fails when a hunk's line counts disagree with its header", () => {
    const dir = copyRepo();
    addPatch(dir, "97-count.patch", "Why: a test.\n--- a/skills/how/SKILL.md\n+++ b/skills/how/SKILL.md\n@@ -1,2 +1,2 @@\n----\n+---\n");
    const result = withFixture(dir, "--check");
    assert.equal(result.status, 1);
    assert.match(result.output, /FAIL overlay-fixture\/patches\/97-count\.patch hunk at line 1 has 1 old and 1 new lines, but its header says 2 and 2/);
  });

  it("applies a patch to the tree only, and GENERATED.md names the overlay", () => {
    const dir = copyRepo();
    const source = readFileSync(join(dir, "pstack/skills/how/SKILL.md"), "utf8");
    const at = source.split("\n").findIndex((line) => line.startsWith("# "));
    const h1 = source.split("\n")[at];
    addPatch(dir, "01-how.patch", `Why: a test.\n--- a/skills/how/SKILL.md\n+++ b/skills/how/SKILL.md\n@@ -${at + 1} +${at + 1} @@\n-${h1}\n+${h1} (patched)\n`);
    const result = withFixture(dir);
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /patched 01-how\.patch -> skills\/how\/SKILL\.md/);
    assert.ok(readFileSync(join(dir, TREE, "skills/how/SKILL.md"), "utf8").includes(`\n${h1} (patched)\n`));
    assert.equal(readFileSync(join(dir, "pstack/skills/how/SKILL.md"), "utf8"), source);
    assert.match(readFileSync(join(dir, TREE, "GENERATED.md"), "utf8"), /local overlay `overlay-fixture`: 1 patches/);
  });

  it("renders each extra byte for byte into the tree, with its plugin's license", () => {
    const dir = copyRepo();
    const body = "---\nname: tidy\ndescription: a test extra\n---\n\n# Tidy\n";
    addExtra(dir, "tidy", body);
    writeFileSync(join(dir, FIXTURE, "extra/LICENSE-test-kit"), "MIT\n");
    const result = withFixture(dir);
    assert.equal(result.status, 0, result.output);
    assert.equal(readFileSync(join(dir, TREE, "skills/tidy/SKILL.md"), "utf8"), body);
    assert.equal(readFileSync(join(dir, TREE, "LICENSE-test-kit"), "utf8"), "MIT\n");
  });

  it("fails --check when an extra changed and the tree was not regenerated", () => {
    const dir = copyRepo();
    addExtra(dir, "tidy", "---\nname: tidy\ndescription: a test extra\n---\n\n# Tidy\n");
    assert.equal(withFixture(dir).status, 0);
    edit(dir, `${FIXTURE}/extra/tidy/SKILL.md`, (text) => `${text}\nOne more rule.\n`);
    const result = withFixture(dir, "--check");
    assert.equal(result.status, 1);
    assert.match(result.output, /harness\/pstack\/t3\/skills\/tidy\/SKILL\.md/);
    assert.match(result.output, /out of date/);
  });

  it("fails when an extra has the name of an upstream skill", () => {
    const dir = copyRepo();
    addExtra(dir, "how", "---\nname: how\ndescription: a clash\n---\n\n# How\n");
    const result = withFixture(dir, "--check");
    assert.equal(result.status, 1);
    assert.match(result.output, /FAIL overlay-fixture\/extra\/how has the name of an upstream skill, skills\/how/);
  });

  it("fails when an extra's name is not its folder name", () => {
    const dir = copyRepo();
    addExtra(dir, "tidy", "---\nname: tidy-up\ndescription: a mismatch\n---\n\n# Tidy\n");
    const result = withFixture(dir, "--check");
    assert.equal(result.status, 1);
    assert.match(result.output, /FAIL skills\/tidy\/SKILL\.md has name "tidy-up", not its folder name tidy/);
  });

  it("regenerates the same bytes", () => {
    const dir = copyRepo();
    assert.equal(generate(dir).status, 0);
    const result = generate(dir, "--check");
    assert.equal(result.status, 0, result.output);
  });
});
