# Project Instructions for AI Agents

This file provides instructions and context for AI coding agents working on this project.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:6cd5cc61 -->
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

This is a **Java** repo (no `package.json`, no npm). The `web/` port does not
exist yet.

```bash
brew install openjdk@17          # source targets JavaSE-1.7; 17 compiles it
tools/build.sh                   # game (GBK) + dev tools (UTF-8) -> tools/build/classes
tools/run-game.sh                # launch the original game
tools/export-truth.sh            # re-export the 96 script ground-truth JSONs
tools/export-trace.sh --check    # re-export the behaviour traces, twice, and cmp
```

**Run every command from the repo root** — the game resolves `script/`,
`sources/`, `image/` as relative paths.

There is **no automated test suite yet**. The two regression checks that exist
today are both re-export-and-diff:

- `tools/export-truth.sh` — re-run it and `git diff tools/ground-truth` must be
  empty (data layer: 96 scripts × 26 fields).
- `tools/export-trace.sh --check` — re-run it and `git diff tools/traces/out`
  must be empty; `--check` additionally exports each script twice in separate
  JVMs and `cmp`s the two, which is what makes the traces usable as truth at
  all. See `docs/trace-format.md`.

Building the real suite is tracked in beads (`xl-tkx.3`).

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
- **Behaviour truth lives in `tools/traces/`.** Declarative scripts in
  `traces/scripts/`, exported per-tick traces in `traces/out/` — both are
  committed, and any diff in `out/` is a signal. Do not hand-write expected
  values for the state or viewport layers; read them out of a trace.

## Agent skills

### Issue tracker

Issues live in **beads** (`bd`, prefix `xl`), not GitHub Issues — the GitHub
remote hosts code only. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles, applied as bd labels with their default names. See
`docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root (neither exists
yet; created lazily by `/domain-modeling`). See `docs/agents/domain.md`.
