# Approval queue

Agents append a section here when they need a human decision. Each section
has a `status:` line that is `pending`, `approved` or `rejected`. The
dashboard's Approve and Reject buttons rewrite that line and add `decided:`.

## APR-001 · Publish competitor digest to shared drive
- status: pending
- agent: comms
- task: T2.3
- requested: 2026-10-13T12:30:09Z
- risk: low

Uploads `digest-2026-10-17.md` to the team's shared drive folder. Readable by
the whole team.

## APR-002 · Merge model router into main
- status: pending
- agent: coder
- task: T3.2
- requested: 2026-10-13T13:50:12Z
- risk: medium

Routes summarisation calls to a smaller model. Expected to cut researcher
spend by about a third. Tests pass with the chunking fix.

## APR-003 · Email beta testers about onboarding v2
- status: pending
- agent: comms
- task: T1.5
- requested: 2026-10-13T14:05:44Z
- risk: high

Sends an announcement to 240 beta testers. Cannot be unsent.

## APR-000 · Read access to analytics export
- status: approved
- agent: researcher
- task: T1.1
- requested: 2026-10-13T08:04:00Z
- decided: 2026-10-13T08:05:12Z
- risk: low

Read-only access to last month's funnel export.
