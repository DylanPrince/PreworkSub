# Known issues and limitations

- **No real Claude run has been executed** in this environment: no `ANTHROPIC_API_KEY` is configured.
  The provider is tested through the real SDK against a fake HTTP layer. Watch the first real run
  (structured output, token counts, cost) as described in `docs/api-key-setup.md`.
- Spending limits are application safeguards, not a billing cap: other uses of the same key, price
  table drift and estimated costs for aborted calls can make the Anthropic bill differ. Set a Console
  spend limit as the hard cap.
- Pre-flight cost estimates use a character-based token estimate with 25% headroom plus 500 tokens.
  A prompt that tokenizes much worse than 4 characters per token could exceed its reservation; the
  actual cost is still recorded.
- If a worker process dies mid-call, the run's reservation stays counted (conservatively) until the
  job is picked up again after its lock expires (60 s) and re-executed.
- Budget windows attribute a run to the UTC day and month in which its latest attempt started.
- Agents have no tools; outputs are analysis/drafts only. Market Research cannot browse the web and
  says so in its `limitations` field.
- Cancellation of a running job is cooperative (Postgres polled every second); BullMQ job is not
  force-killed.
- Overview "Pending approvals", "Scheduled tasks", revenue and profit show "Not tracked yet" until
  M4/M5.
- Built-in (shared) agents cannot be edited or disabled in the UI; duplicate them into a business
  instead. There is no instance-admin role yet.
- Agent Builder offers vetted output contracts only; free-form custom JSON schemas are not supported.
- Spending limits are set through environment variables, not in the UI.
- Next.js dev server may full-reload once when a route first compiles; E2E tests therefore run against
  a production build.
- Test databases accumulate rows (suites are non-destructive by design); drop and recreate them manually
  if they grow.
