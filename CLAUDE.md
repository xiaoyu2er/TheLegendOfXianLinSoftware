# Project Instructions for AI Agents

This file provides instructions and context for AI coding agents working on this project.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:970c3bf2 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

## Agent Context Profiles

The managed Beads block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `bd` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `bd prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

## Session Completion

This protocol applies when ending a Beads implementation workflow. It is subordinate to explicit user, repository, and orchestrator instructions.

1. **File issues for remaining work** - Create beads for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Handle git/sync by active profile**:
   ```bash
   # Conservative/minimal/default: report status and proposed commands; wait for approval.
   git status

   # Team-maintainer opt-in only, unless current instructions forbid it:
   git pull --rebase
   bd dolt push
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END BEADS INTEGRATION -->


## Build & Test

Two toolchains live side by side: **Java** at the repo root (the original game,
which is the migration's specification) and **pnpm** under `web/` (the browser
port: 1024×640 舞台 + 数据烘焙 + 宿舍与大地图两个场景).

```bash
brew install openjdk@17          # source targets JavaSE-1.7; 17 compiles it
tools/build.sh                   # game (GBK) + dev tools (UTF-8) -> tools/build/classes
tools/run-game.sh                # launch the original game
tools/export-truth.sh            # re-export the 96 script ground-truth JSONs
tools/export-trace.sh --check    # re-export the behaviour traces, twice, and cmp

cd web && pnpm install           # browser port; see web/README.md
pnpm typecheck && pnpm test && pnpm build
pnpm bake                        # 重烘场景 JSON 与 WebP（产物入库，改了脚本/烘焙器才要跑）
```

`web/`'s three commands run in CI (`.github/workflows/web.yml`); the Java side
has no CI yet.

**Run every Java-side command from the repo root** — the game resolves
`script/`, `sources/`, `image/` as relative paths. `web/`'s commands run from
`web/`.

**The Java side has no unit-test suite yet.** What it has instead are two
re-export-and-diff regression checks, both of which must come back empty:

- `tools/export-truth.sh` — data layer. Re-run it and `git diff
  tools/ground-truth` must be empty (96 scripts × 26 fields).
- `tools/export-trace.sh --check` — behaviour layer, **all four drivers**
  (scene / battle / menu / shop, 9 scripts). Re-run it and `git diff
  tools/traces/out` must be empty; `--check` additionally exports each script
  twice in separate JVMs and `cmp`s them, which is what makes the traces usable
  as truth at all. **Both halves are needed**: `--check` only proves this run is
  reproducible — a *stable* wrong answer looks identical to a right one, and the
  empty `git diff` is what catches that. See `docs/trace-format.md`.

`web/` has vitest (`pnpm test`). Building the real Java-side suite is tracked in
beads (`xl-9bd.5`).

## Architecture Overview

**Original (`src/`, 87 files / 18k lines):** Swing, one `JFrame` with a
`CardLayout` switching eight panels — start, scene, battle, menu, shop,
equipment shop, load/save, end. Each panel hand-draws into an offscreen
`BufferedImage`. Game content lives in 96 GBK text files under `script/`
(collision grid + NPCs + dialogue + events), parsed by the single entry point
`tools.Reader`.

**Migration target:** Pixi (scene + battle) and React (menus, shops, dialogue)
under `web/`, with the game state machine decoupled from rendering. Decisions
and their evidence: `docs/MIGRATION-PLAN.md`. Task tracking: `bd ready`.

`web/` 现在能烘焙并渲染宿舍与大地图两个场景（xl-9bd.3）。数据烘焙是
`web/scripts/bake.ts`（`pnpm bake`），产物入库在 `web/src/generated/`，
黄金测试拿 `tools/ground-truth/` 对齐。

## Conventions & Patterns

- **Source files are GBK-encoded with CRLF line endings.** Compile with
  `-encoding GBK`. To edit programmatically, round-trip through UTF-8 and write
  back as GBK+CRLF — verified lossless across all 88 `.java` files. Never write
  a bare LF into `src/`.
- **Data files are GBK too** (`script/*.txt`, `sources/Shop/*.txt`, saves), and
  they are also **CRLF** — `grep`/`awk` patterns anchored with `$` need
  `tr -d '\r'` first, or they silently match nothing.
- **No `-Dfile.encoding` flags are needed or effective.** Encoding is specified
  explicitly at the four I/O points; JVM-level charset flags were measured to
  have no effect on openjdk 17.
- **During migration the Java source is the specification.** Keep it runnable;
  do not change game logic. The only sanctioned edits are portability and
  diagnostics, each as its own commit (see `fix(io)`, `fix(path)`, `fix(diag)`).
- **Do not "fix" the script data.** The three backslash paths in
  `script/剧情1.txt` and `script/迷宫1.txt` are deliberate test fixtures for the
  web data-baking pipeline's path normalisation.
- `tools.Reader.readImage` warns on stderr for missing files; `tools.Clock`
  scales all timing with `factor` defaulting to `1.0` (identity), and has a
  default-off timer-freeze mode used only by the trace exporter.
- **Behaviour truth lives in `tools/traces/`, and it now covers four drivers.**
  Declarative scripts in `traces/scripts/`, exported traces in `traces/out/` —
  both committed, and any diff in `out/` is a signal. One exporter
  (`tools/export-trace.sh`, one command for all four) dispatches on the script's
  own `driver` field to `scene` (5 scripts, a step = one tick), `battle`
  (2 scripts, a step = one `BattlePanel.run()` loop body + one `paint()`),
  `menu` and `shop` (1 script each, a step = one input event). An unrecognised
  name is a hard failure, never a guess — but a **missing** `driver` field
  defaults to `scene`, the exporter's one and only leniency (the five scene
  scripts predate the field; giving them one would change the script echo and
  force a re-export). A new script that omits it gets `scene` silently, so
  write it. Do not hand-write expected values for
  the state or viewport layers; read them out of a trace. Overview table,
  per-driver formats and pitfalls: `docs/trace-format.md`.
- **Cross-end frame comparison is only wired up for `scene`.**
  `tools/compare-frames.sh` runs the original side for all four, but the capture
  page assembles `scene` only; battle / menu / shop wait for **M2 (xl-82c) /
  M3 (xl-6lo) / M4 (xl-knp)** to build those panels in `web/`. Until then those
  scripts make the pipeline **exit non-zero and name the driver plus its owning
  issue** — a script that was never assembled compares as "zero frames differ",
  which looks exactly like "the two sides agree". See
  `docs/frame-compare.md` § 装配不出来的驱动器.

## Workspace layout

One working copy, one beads DB, no long-running services:

    ~/code/TheLegendOfXianLinSoftware/   the only working copy
      └── .beads/embeddeddolt/xl/        the beads DB (embedded Dolt)

Run `bd` from anywhere inside it.

**Gas Town was tried and dropped (2026-09-06).** The rig at `~/gt/xianlin` is
stopped and is no longer authoritative for anything. Its services are down and
its Dolt server is off, so `bd` under `~/gt` now fails with `connection
refused` instead of answering from a stale database. `~/gt` is kept on disk for
now, but nothing reads it. Three things learned the hard way, worth knowing
before anyone revives it:

- **`gt doctor --fix` corrupts the beads config.** It appends empty `prefix:`
  and `issue-prefix:` values to `.beads/config.yaml` and rewrites
  `metadata.json` to point at a different database, turning `bd count` into
  `Total: 0`. It also ignores the check name you pass it and always fixes
  everything. See `bd memories gt-doctor`.
- **gt 1.1.0 cannot read a beads 1.2.2 database at all.** Its `ready_issues`
  view still queries `depends_on_id`, a column beads split into
  `depends_on_issue_id` / `_wisp_id` / `_external`. Fixed on gt's `main`
  (`HEAD-649b832`), not in the released 1.1.0.
- **Every gt-spawned agent blocks on Claude Code's trust-folder dialog**, and
  gt spins forever waiting rather than reporting it.

**A silent-failure warning that outlived the rig:** `bd` in a repo whose
embedded DB is empty answers `0` — it does not error. Any check that reads
"no issues found" as success cannot distinguish an empty database from a
healthy one. The previous version of this section claimed running `bd` in this
clone "fails loudly on purpose"; that was measured to be false.

## Agent skills

### Issue tracker

Issues live in **beads** (`bd`, prefix `xl`) in this repo's `.beads/`, not
GitHub Issues — the GitHub remote hosts code only. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles, applied as bd labels with their default names. See
`docs/agents/triage-labels.md`.

### Dispatch

派一张票给 agent 时，prompt 只需要一句话——纪律、命名约定与验收方式都在
`docs/agents/dispatch.md` 里，被派的 agent 自己读。

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root (neither exists
yet; created lazily by `/domain-modeling`). See `docs/agents/domain.md`.
