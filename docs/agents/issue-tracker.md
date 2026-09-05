# Issue tracker: beads (bd)

Issues for this repo live in **beads**, not GitHub Issues. The GitHub remote
(`xiaoyu2er/TheLegendOfXianLinSoftware`) hosts the code only.

Issue prefix: `xl`. Child issues get hierarchical IDs (`xl-tkx` → `xl-tkx.1`).

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
remote. `.beads/issues.jsonl` is a **passive export** — useful for review and
disaster recovery, but `bd import` during normal operation is an anti-pattern.

**The issue data has never left this machine.** Two bd commands disagree about
the remote, so check with git rather than trusting either:

- `bd dolt remote list` reports `origin git+https://github.com/...` — that is
  `sync.remote` from `config.yaml`, a declared intent.
- `bd dolt show` reports `Remotes: (none)` — the embedded Dolt engine itself
  has no remote registered.
- `git ls-remote origin 'refs/dolt/*'` returns **nothing** — decisive: no beads
  data has ever been pushed.

Before relying on cross-machine sync, run that `git ls-remote` and then an
actual `bd dolt push`; do not infer from the two commands above.

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
