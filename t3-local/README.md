# pstack for T3 Code (tomaas/pstack)

This repository is a fork of [cursor/plugins](https://github.com/cursor/plugins). It installs [pstack](https://github.com/cursor/plugins/tree/main/pstack) by poteto into T3 Code. T3 Code runs Claude Code and Codex sessions, so the T3 layer reuses upstream's Claude Code adapter and covers only what T3 adds: threads and worktrees, `delegate_task`, PR watching, schedules, thread memory, previews and devices. It replaces tomaas/p3-stack.

The skills keep upstream's names and text: `/poteto-mode`, `/poteto-help`, `/setup-pstack`, `poteto-agent`, `comment-sicko`.

## Layout

The branch has two parts. The first is in upstream's own shape and could go to cursor/plugins as a PR. The second is this fork's alone, and never goes upstream.

| Path | Part | What it is |
| --- | --- | --- |
| `pstack/docs/harness/t3.md` | upstream shape | The T3 adapter. A session reads the Claude Code adapter, then this one, which wins where they differ. |
| `scripts/generate-pstack-t3-tree.mjs`, `scripts/test/` | upstream shape | Renders `harness/pstack/t3/` from `pstack/` and both adapters, and with `--overlay t3-local` this fork's patches and extras. `--check` fails on a stale tree, a patch that no longer applies, or a Cursor name with no adapter row. |
| `harness/pstack/t3/` | upstream shape | The generated tree that `t3-local/install.sh` installs. Committed. Never edit it by hand. |
| `t3-local/patches/` | this fork | Local changes, applied to the generated tree only. |
| `t3-local/extra/` | this fork | Skills from other cursor/plugins plugins that pstack calls, vendored verbatim. |
| `t3-local/install.sh`, `t3-local/check`, `t3-local/test/` | this fork | The installer and the checks. |

Every other file is upstream's. Never edit one here: put a local change in `t3-local/patches`. `t3-local/check` fails when the branch changes a file outside the T3 layer.

## Install

```bash
git clone -b t3 https://github.com/tomaas/pstack.git pstack
pstack/t3-local/install.sh --dry-run
pstack/t3-local/install.sh
```

`t3-local/install.sh` links each skill folder of `harness/pstack/t3/skills` into `~/.claude/skills` (Claude Code sessions) and `~/.agents/skills` (Codex sessions). `--project <dir>` installs into the project's `.claude/skills` and `.agents/skills` instead. `--dry-run` prints what it would do. An entry that already has a skill's name is kept and reported as `keep <name> (...)`, unless it is this checkout's own link. Rerunning it is safe.

Coming from tomaas/p3-stack, its links point at that checkout and are kept. Remove each one you want replaced with `rm ~/.agents/skills/<name>`, with no trailing slash, then rerun `t3-local/install.sh`.

Then run `/setup-pstack` once. In T3 it writes `~/.claude/rules/pstack-models.md`. A project's own `p3-models.md` at the worktree root wins over it.

## Sync with upstream

1. Merge cursor/plugins `main` into this fork's `main`: GitHub's "Sync fork" button, or `git fetch upstream && git merge upstream/main` with `upstream` set to cursor/plugins.
2. On `t3`: `git fetch origin && git merge origin/main`.
3. `node scripts/generate-pstack-harness-trees.mjs && node scripts/generate-pstack-t3-tree.mjs --overlay t3-local`. A failure names what to fix: a patch whose context changed upstream, or a new Cursor name that needs a row in `pstack/docs/harness/t3.md`. Rework the patch or add the row, never an upstream file.
4. Refresh the extras (see Extras), then `t3-local/check`. It checks both trees, that only T3 layer files differ from `origin/main` (set `UPSTREAM_REF` for another ref), and runs the tests.
5. Commit the regenerated trees.

## Patches

Each patch is a header saying why, then a unified diff of one tree source, with paths from `pstack/`. The generator applies it to the tree only and fails when a hunk no longer matches exactly.

| Patch | File | Why |
| --- | --- | --- |
| `01-reflect-copy-linked-skill.patch` | `skills/reflect/SKILL.md` | The install links skills into this checkout, so editing a skill through its link changes the shared checkout. The patch replaces upstream's last paragraph with the safe steps to copy a linked skill out before editing it, and keeps upstream's rule against editing a skill under `plugins/cache/`. |
| `02-statechart-render-absolute-path.patch` | `skills/statechart/references/render.md` | T3 shows an image in the thread only when the reply embeds it by absolute path. |
| `03-t3-adapter-local-install.patch` | `docs/harness/t3.md` | The upstream adapter names a generic install and skips `/deslop` when no deslop skill is listed. This fork names `t3-local/install.sh` and the bundled deslop. |

## Extras

pstack calls a few skills that ship in other cursor/plugins plugins. An extra is one of them, copied byte for byte into `t3-local/extra/<name>/`. The generator renders it into `harness/pstack/t3/skills/<name>/` like an upstream skill, with the same name and folder checks, and fails when an extra has the name of an upstream skill. The plugin's license ships as `t3-local/extra/LICENSE-<plugin>` and lands next to the tree's `LICENSE`. `t3-local/extra/SOURCES` records the cursor/plugins commit each extra came from.

| Extra | From | Why |
| --- | --- | --- |
| `deslop` | `cursor-team-kit/skills/deslop` (MIT, Cursor), at the commit in `t3-local/extra/SOURCES` | poteto-mode runs `/deslop` before every commit, and the T3 install has no `cursor-team-kit`. |

To refresh on a sync: `cp cursor-team-kit/skills/deslop/SKILL.md t3-local/extra/deslop/SKILL.md && cp cursor-team-kit/LICENSE t3-local/extra/LICENSE-cursor-team-kit`, write the merged cursor/plugins commit into `t3-local/extra/SOURCES` when either file changed, then run `node scripts/generate-pstack-t3-tree.mjs --overlay t3-local`.

## Credit

pstack is by Lauren Tan (poteto), with Cursor, MIT. The T3 adaptation continues the p3-stack work started by Uzair Ansar. See [`NOTICE`](NOTICE) and [`pstack/LICENSE`](../pstack/LICENSE).
