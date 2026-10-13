# Next steps

1. **You**: add `ANTHROPIC_API_KEY` to the server environment, run the free verification in
   `docs/api-key-setup.md`, then tell me when you authorize a live test. No paid call is made before
   that.
2. Approval system with backend enforcement (`ApprovalRequest`, approvals queue, approve/reject with
   audit). Required before any agent gets a tool that spends money, publishes, purchases or contacts
   customers; workstreams the plan flags for owner approval will route through it.
3. Workflows: saved multi-agent sequences on top of run records (sequential and parallel steps,
   approval gates, loop limits), reusing the Command Center's dependency handling.
4. Executable configurations for the remaining 16 roster agents.
5. Business switcher, per-business budgets, limits editable in Settings, task filters.
