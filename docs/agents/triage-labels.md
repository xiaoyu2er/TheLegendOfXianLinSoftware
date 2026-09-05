# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those
roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the
corresponding label string from this table.

## In bd

    bd label add <id> ready-for-agent      # apply
    bd label remove <id> needs-triage      # clear
    bd list --label ready-for-agent        # filter
    bd label list-all                      # every label in use

Labels are created implicitly on first use — there is no label registry to
seed. Beware `--parent` label inheritance (see `issue-tracker.md`).

Edit the right-hand column to match whatever vocabulary you actually use.
