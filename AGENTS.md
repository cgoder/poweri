# AGENTS.md

## Agent skills

### Issue tracker

Issues and specs live as markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical roles, label strings equal to their names (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — one `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Dependencies

Mature open-source first: any capability a mature OSS project/package solves must use it (architecture permitting), after rigorous research that it is industry best practice and fits the project. Never hand-roll what exists. See `docs/adr/0009-mature-oss-first.md`.
