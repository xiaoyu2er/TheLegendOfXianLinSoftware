# Issue tracker: beads (bd)

Issues for this repo live in **beads**, not GitHub Issues. The GitHub remote
(`xiaoyu2er/TheLegendOfXianLinSoftware`) hosts the code only.

Issue prefix: `xl`. Child issues get hierarchical IDs (`xl-tkx` -> `xl-tkx.1`).

## Where the database actually is

One database, in this working copy, embedded — nothing to start:

    ~/code/TheLegendOfXianLinSoftware/.beads/embeddeddolt/xl/

Run `bd` from anywhere inside the repo.

**This replaced a Gas Town rig on 2026-09-06.** The rig at `~/gt/xianlin` held
the authoritative database until then; it is stopped, its Dolt server is off,
and `bd` under `~/gt` now fails with `connection refused`. `~/gt` is still on
disk but nothing reads it. The 55 issues were carried across by copying the
Dolt database directory, then verified by count and by spot-check, not by
re-import.

## The failure mode this file used to get wrong

An earlier version of this section claimed that running `bd` in this clone
"fails loudly" with `Error: no beads database found`. **That was measured to be
false on 2026-09-06.** With an empty embedded database, `bd count` answers:

    0

No error, exit code 0. This is the project's signature hazard in its purest
form: an empty database and a healthy one are indistinguishable to any check
whose pass condition is "found no problems". Whenever you verify beads state,
assert a *number you knew before you started* — `bd count` equals the expected
total — never merely that the command succeeded.

Run `bd prime` for bd's own full workflow reference.

## Mapping the skills' vocabulary to bd

| When a skill says…              | Do this                                              |
| ------------------------------- | ---------------------------------------------------- |
| publish to the issue tracker    | `bd create "<title>" -t <type> [--parent <id>] -d <desc> --acceptance <criteria>` |
| fetch the relevant ticket       | `bd show <id>` (add `--json` when you need to parse) |
| apply a triage label            | `bd label add <id> <label>` — see `triage-labels.md` |
| declare a blocking edge         | `bd dep add <blocked-id> <blocker-id>`               |
| work the frontier               | `bd ready` — open, unblocked, unclaimed              |
| claim a ticket                  | `bd update <id> --claim` (atomic; see below)         |
| close a ticket                  | `bd close <id> --reason "<what changed>"`            |
| comment on a ticket             | `bd comment <id> "<text>"`                           |

Issue types: `epic` `feature` `task` `bug` `chore` `decision`.
This repo's convention: **epic = milestone, feature = system slice, bug = defect.**

## Claiming is atomic — rely on it

`bd update <id> --claim` sets assignee + `in_progress` in one operation and
**hard-fails** if someone else already holds it:

    Error claiming xl-tkx.1: issue already claimed by agent-a

A claimed issue drops out of `bd ready` immediately. Two agents cannot both
grab the same ticket. Set `BEADS_ACTOR` to identify yourself.

## Parallel agents and git worktrees

`bd worktree create <name>` makes a worktree that **shares the main repo's
`.beads` database automatically** (via git common-directory discovery — no
redirect config). Verified: `bd where` from inside a worktree resolves to the
main repo's `.beads/embeddeddolt`.

    bd worktree create scaffold
    BEADS_ACTOR=scaffold bd -C scaffold update xl-tkx.1 --claim

`bd swarm validate <epic-id>` computes the waves of parallelisable work from
the dependency graph. `bd merge-slot` serialises conflict resolution when
several agents converge on a merge.

Caveat: `bd worktree remove` refuses with `unpushed commits` whenever the
branch is not on `origin`, even at zero diff from `master`. Check the diff
yourself, then use `--force`.

## Persistence — do NOT use issues.jsonl as the source of truth

Issues live in a local Dolt database under `.beads/`. Cross-machine sync is
`bd dolt push` / `bd dolt pull`, stored under `refs/dolt/data` on the git
remote. `.beads/issues.jsonl` is **not in git** (xl-319): it was a
hand-refreshed export that fell days behind — 125 records committed against 272
in the live database. Export one locally with `bd export -o .beads/issues.jsonl`
when you need it (it is gitignored); `bd import` during normal operation is an
anti-pattern either way.

**The issue data is on origin now, but only as of the last `bd dolt push`.**
This paragraph used to say it had never left this machine; that stopped being
true and nobody noticed, which is the whole reason to check with git rather
than trusting either bd command:

- `git ls-remote origin 'refs/dolt/*'` → `a0cef5ae…  refs/dolt/data`
  (re-measured 2026-09-12) — decisive.
- `bd dolt remote list` reports `origin git+https://github.com/...` — that is
  `sync.remote` from `config.yaml`, a declared intent, not evidence.
- `bd dolt show` reports no remote — the embedded Dolt engine itself has none
  registered. It says this whether or not data has been pushed.

⚠️ **What is on origin is a snapshot, not a mirror**: a clone bootstrapped on
2026-09-12 came up with 251 issues while the live database held 273. Since
`.beads/issues.jsonl` left git (xl-319), `bd dolt push` is the *only* way issue
data reaches anyone else — run it before relying on cross-machine sync, and do
not infer its state from the two bd commands above.

## Label inheritance gotcha

`bd create --parent <id>` **inherits the parent's labels** by default. When
creating children under an epic that carries a triage label, pass
`--no-inherit-labels` unless the child genuinely shares that state.

## Wayfinding operations (used by /wayfinder)

- **Map** → an `epic`; the Notes / Decisions-so-far / Fog body lives in its description.
- **Child ticket** → `bd create --parent <map-id> -t decision`, question in the body.
- **Blocking** → `bd dep add <child> <blocker>`.
- **Frontier** → `bd ready`.
- **Claim** → `bd update <id> --claim`.
- **Resolve** → `bd comment <id> "<answer>"`, then `bd close <id> --reason`,
  then append a context pointer to the map epic with `bd note <map-id>`.
