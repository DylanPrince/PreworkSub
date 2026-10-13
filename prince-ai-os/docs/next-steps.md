# Next steps

1. **You**: add `ANTHROPIC_API_KEY` to the server environment and run the verification in
   `docs/api-key-setup.md` before the first paid run.
2. AI Command Center v1: chat that routes a request to an executable agent, shows the worst-case cost,
   creates a task and follows the run. Reuses `requestRun`.
3. Approval system with backend enforcement (`ApprovalRequest`, queue page, approve/reject with audit).
   Required before any agent gets a tool that spends money, publishes, purchases or contacts customers.
4. Workflows: multi-agent sequences on top of run records, with approval gates and loop limits.
5. Executable configurations for the remaining 16 roster agents.
6. Business switcher, per-business budgets, limits editable in Settings, task filters.
