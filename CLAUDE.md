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

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is **not in git** (xl-319) — it is a local, opt-in export (`bd export -o .beads/issues.jsonl`); a fresh clone gets its issues with `bd bootstrap`, which pulls `refs/dolt/data` from origin (as of the last `bd dolt push`). See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

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
tools/build.sh                   # game (GBK) + dev tools + unit tests (UTF-8) -> tools/build/classes
tools/test.sh                    # the Java-side unit tests (zero dependencies)
tools/run-game.sh                # launch the original game
tools/export-truth.sh            # re-export the 96 script ground-truth JSONs
tools/export-trace.sh --check    # re-export the behaviour traces, twice, and cmp
tools/export-random.sh           # re-export the java.util.Random golden data
tools/export-scaled-blit.sh      # re-export the ScaledBlit sampling golden data
tools/export-present.sh          # re-export the Java2D SrcOver present golden data

cd web && pnpm install           # browser port; see web/README.md
pnpm typecheck && pnpm test && pnpm build
pnpm bake                        # 重烘场景 JSON 与 WebP（产物入库，改了脚本/烘焙器才要跑）
```

`web/`'s three commands run in CI (`.github/workflows/web.yml`). The Java side
has CI too (`.github/workflows/java.yml`): `tools/build.sh`, `tools/test.sh`,
and `tools/export-truth.sh` followed by `git diff --exit-code -- tools/ground-truth`
— that last pair is two separate steps on purpose, because "the exporter ran"
and "what it produced matches what is committed" are different questions and
only the second is the check. **`tools/export-trace.sh --check` is now wired up
too** (xl-u7b, 2026-09-17), as a *separate, parallel* job named `trace` — the
`check` job's four steps take 44s while this one takes six minutes, and splitting
them means a broken compile shows up without waiting for the traces. It needs
`xvfb-run -a`: `export-trace.sh` hard-codes `-Djava.awt.headless=false` (the
battle driver wants real Swing components) and a runner has no display.

The readings that made it safe to wire up were taken **on a real runner** before
the change, not estimated (run 35224054598):

| question | reading |
|---|---|
| does it run at all | without xvfb **exit 1**; with `xvfb-run -a` **exit 0** |
| how long | `--check` over the full set: **364 s** (job total 6m47s) |
| is it deterministic there | **63/63 byte-identical, 0 failures** |
| does the runner's output match what's committed | `git diff -- tools/traces/out` → **0** |

That last row is the real precondition and is *not* the same question as the one
above it — `--check` only proves this run reproduces, and a **stable** wrong
answer looks identical to a right one in its eyes. That was then demonstrated,
not assumed: PR #1 deliberately corrupted one value in a committed trace, and
**the `--check` step stayed green while the `git diff` step went red** — exactly
the split the two steps exist for. The measuring rig lives on in
`.github/workflows/java-trace-probe.yml` (`workflow_dispatch` only).

⚠️ Two things that used to be written here as "unverified" and are **no longer
true**, corrected 2026-09-17: `java.yml` **has** run on real runners — `gh run
list --workflow=java.yml` goes back to 2026-09-13 and it has been green
throughout (44–50s for the `check` job). It still carries `workflow_dispatch` so
it can be run by hand without touching its `paths` list.

**Run every Java-side command from the repo root** — the game resolves
`script/`, `sources/`, `image/` as relative paths. `web/`'s commands run from
`web/`.

The Java side has **three** checks. Two are re-export-and-diff, and both must
come back empty:

- `tools/export-truth.sh` — data layer. Re-run it and `git diff
  tools/ground-truth` must be empty. It covers two families: the parsed
  scripts (one JSON per `script/*.txt`, 26 top-level fields — 96 × 26 on
  2026-09-10, count it) and, since M6 (xl-i06.5), the original sample saves
  under `tools/ground-truth/存档/`: a byte-for-byte copy of each `存档N.txt`
  (truth — the exporter never writes it) plus the JSON the original
  `Loader.loadLine` actually reads out of it. The exporter refuses to write
  when the draft area `sources/Record/` differs from those copies, and
  `SaveDraftIntactTest` (in `tools/test.sh`) checks the same thing.
- `tools/export-trace.sh --check` — behaviour layer, **every driver**
  (which ones exist is `ExportTrace.pickDriver`; how many scripts that is, is whatever
  `tools/traces/scripts/*.json` holds — count it, don't trust a number written
  here). Re-run it and `git diff tools/traces/out` must be empty; `--check`
  additionally exports each script twice in separate JVMs and `cmp`s them, which is what makes the traces usable
  as truth at all. **Both halves are needed**: `--check` only proves this run is
  reproducible — a *stable* wrong answer looks identical to a right one, and the
  empty `git diff` is what catches that. See `docs/trace-format.md`.

The third is `tools/test.sh`, a unit-test suite that exists **only** to cover
what those two cannot see. Which ones those are was measured, not argued
(2026-09-08, `xl-f8y`): ten mutations, three caught by the re-export checks and
**seven invisible to both** — among them the two kinds of `src/` edit this repo
actually sanctions (`fix(path)`'s path normalisation, `fix(diag)`'s
missing-image warning) and `ExportTrace`'s promise that an unknown `driver` is
a hard failure, which would otherwise export a trace that is exit-0, valid JSON
and byte-identical across two runs. Re-running that same matrix afterwards:
**all seven now go red, and the three the re-export checks already caught still
do.** The matrix, the three families it falls into, and every mutation verbatim:
`docs/java-side-test-gap.md`.

Two things about the suite are load-bearing, not incidental:

- **It does not unit-test `src/`, on purpose.** The original is frozen
  specification; a suite for code nobody may change buys nothing, and its
  behaviour is already pinned where the port actually consumes it. Two of the
  ten mutations stay green under `tools/test.sh` for exactly this reason —
  they are the truth layer's and the trace layer's job. **One gap needs one
  check, and every gap needs at least one.**
- **Zero dependencies, no build system** (user's call, 2026-09-08). The runner
  is `tools/test/devtools/TestMain.java`; `tools/build.sh` still just calls
  `javac`, now in three stages instead of two. `TestMain` fails loudly when
  **no assertion ran at all**, when a registered class contributed none, and
  when its hand-written `SUITE` and the on-disk `*Test.java` scan disagree —
  each of those verified by breaking it on purpose.

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

烘焙分两半（xl-rh9.2）：场景那半（地图 / 主角 / NPC / 头像 / 对话框 / 旁白
/ BGM）与战斗那半（`image/` 下 26 个目录 2405 个文件）。战斗素材再按顶层
目录切成两个包 —— 技能动画与背景动画共 1770 张走 `web/public/` 按需加载，
其余 635 张进主包（实测主包只涨 126 KB）。**产物是不是这批输入烘出来的**，
由 `web/src/generated/bakeStamp.json` 与 `src/assets/bakeStamp.test.ts` 守着
（xl-23y）：烘焙器源码闭包与它读过的每一个输入都算进指纹，改了烘焙器不重烘
就会红。

⚠️ **「烘焙器的输入」比你以为的宽得多**（xl-haw，2026-09-12 现数 **3778 个输入 +
56 个烘焙器源文件**；这两个数**现数，别写死**）。踩过的地方：

- **`src/` 下每一个 `.java` 都是输入** —— 烘焙器要从原版源码里扫「哪几张素材有代码
  引用」「战斗背景音乐读的是哪几首」。**改原版源码也要 `pnpm bake`。**
- **`tools/traces/out/` 下的每一份行为真值也是输入** —— 走到过哪些场景决定烘哪几首
  BGM。**改一份真值（哪怕只是剧本的 description 那一行）也要重烘。**
- **`web/src/` 里有一批文件在烘焙器的源码闭包里**（menu/funcButtons.ts、menu/scroll.ts、
  state/npc.ts、state/treasure.ts 之类，**名字上看不出来**）。**在这些文件里只改一句
  注释，指纹也会红。**

⚠️ 判法：**不要按文件名猜**，指纹里查不到路径时用烘焙器现爬的闭包比。
⚠️ 每次重烘会让几十个 `*.m4a` 出现纯时间戳差异（判据是**差异偏移全部小于 300**，
不是字节数），要逐个 `git checkout` 回去 —— 而那个循环撞上 `index.lock` 时会静默失败，
**计数不看 checkout 的退出码，失败与成功同形**（xl-03x.10 实测）。

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
- **Behaviour truth lives in `tools/traces/`, and it now covers five drivers.**
  Declarative scripts in `traces/scripts/`, exported traces in `traces/out/` —
  both committed, and any diff in `out/` is a signal. One exporter
  (`tools/export-trace.sh`, one command for all of them) dispatches on the script's
  own `driver` field: `scene` (a step = one tick), `battle` (a step = one
  `BattlePanel.run()` loop body + one `paint()`), `menu`, `shop` and `saveload`
  (a step = one input event). **How many scripts each driver has is not written down
  here** — that number has already gone stale twice in one day; read it off
  disk:

  ```bash
  for f in tools/traces/scripts/*.json; do
    python3 -c "import json,sys;print(json.load(open(sys.argv[1])).get('driver','scene'))" "$f"
  done | sort | uniq -c
  ```

  (2026-09-10 on the xl-i06.12 branch that printed 13 battle / 5 menu /
  2 saveload / 14 scene / 4 shop = 38 — a reading, not a spec. This spot has
  now gone stale four times: 21 on 2026-09-07, 24 on 2026-09-09, 33 and then
  38 on 2026-09-10. M6 added the fifth driver and three scene scripts that
  start from a save via a `load` field.) An unrecognised
  name is a hard failure, never a guess — but a **missing** `driver` field
  defaults to `scene`, the exporter's one and only leniency (the scene
  scripts predate the field; giving them one would change the script echo and
  force a re-export). A new script that omits it gets `scene` silently, so
  write it. Do not hand-write expected values for
  the state or viewport layers; read them out of a trace. Overview table,
  per-driver formats and pitfalls: `docs/trace-format.md`.
- **Cross-end frame comparison: which drivers the capture page assembles is a reading, not a constant.**
  `tools/compare-frames.sh` runs the original side for every driver, but the capture
  page only assembles the drivers listed in `web/src/replay/implemented.ts`
  (`IMPLEMENTED_DRIVERS` — that array is the single source of truth; read it
  off disk, don't trust a list written here. As of 2026-09-10 every driver
  the exporter has is wired, M6 / xl-i06.12 having added `saveload`.) Scripts
  that start from an original save (saveload, and scene scripts with `load`)
  get that save parsed on the Node side by the same test-side readers the
  state-layer checks use (`web/src/compare/saveFixtures.ts`) — there is no
  second, browser-side save reader. The machinery for an unassembled driver is
  still there and still worth knowing: such a script makes the pipeline
  **exit non-zero and name the driver plus its owning issue** — a script that
  was never assembled compares as "zero frames differ", which looks exactly
  like "the two sides agree". See `docs/frame-compare.md` § 装配不出来的驱动器.

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

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root, both created
2026-09-07 by the M2 grilling. `CONTEXT.md` is a **glossary only** — it pins
down three words that were each doing two jobs (脚本 vs 剧本, 真值's three
meanings, 一步's per-driver definitions). Decisions live in `docs/adr/`
(five so far), each ticket's acceptance bar in `bd show <id>`. Maintained by
`/domain-modeling`. See `docs/agents/domain.md`.
