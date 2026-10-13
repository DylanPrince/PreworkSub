# AI OS

The orchestrator (Claude) breaks goals into tasks, hands them to specialist
agents, and records everything in the files below. The dashboard in
`dashboard/` only reads these files (and flips approval status lines), so the
system can crash and restart without losing state.

| File | What lives there |
|------|------------------|
| `ai-os/CLAUDE.md` | Agents, goals and task breakdown (this file) |
| `ai-os/notes/progress.log` | Append-only task progress log |
| `ai-os/notes/approvals.md` | Human approval queue |
| `ai-os/logs/usage.jsonl` | One line per model call: tokens and latency |

## Agents

- **orchestrator** — plans goals, assigns tasks, merges results
- **researcher** — gathers sources and summarises them
- **coder** — writes and edits code in the repo
- **reviewer** — checks work against the goal before it ships
- **comms** — drafts outbound messages (always needs human approval)

## Goals

Task markers: `[ ]` todo, `[~]` in progress, `[x]` done, `[!]` blocked.

### G1 · Ship onboarding flow v2
owner: orchestrator
due: 2026-10-20

- [x] T1.1 Audit current onboarding drop-off points (@researcher)
- [x] T1.2 Draft new three-step flow spec (@orchestrator)
- [~] T1.3 Implement welcome screen in the Android app (@coder)
- [ ] T1.4 Review accessibility of new screens (@reviewer)
- [ ] T1.5 Announce rollout to beta testers (@comms)

### G2 · Weekly competitor digest
owner: researcher
due: 2026-10-17

- [x] T2.1 Pull release notes from five competitors (@researcher)
- [~] T2.2 Summarise changes into digest (@researcher)
- [!] T2.3 Publish digest to shared drive (@comms)

### G3 · Reduce model spend by 20%
owner: orchestrator
due: 2026-10-31

- [x] T3.1 Baseline token usage per agent (@orchestrator)
- [~] T3.2 Route summarisation tasks to a smaller model (@coder)
- [ ] T3.3 Add prompt caching to researcher calls (@coder)
- [ ] T3.4 Re-measure and report savings (@reviewer)
