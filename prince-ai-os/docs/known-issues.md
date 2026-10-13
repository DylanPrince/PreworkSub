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
- Command Center workstreams are dispatched by the owner; nothing runs a whole plan automatically
  yet (that is the workflow milestone). Agent suggestions match plan roles to agent names, so a role
  with no matching agent needs a manual choice.
- Forwarded results between workstreams are truncated to 6,000 characters each.
- Prompts estimated above 80k tokens are refused (`input_too_large`), to stay within the flat price
  tier of every model.
- If you switch the built-in agents' model to Fable 5.1 (`AI_DEFAULT_MODEL` at first seed), their
  worst case can exceed the $0.25 per-run budget and runs are refused; duplicate them and raise the
  budget or lower max output tokens.
- Effort levels `xhigh` and `max` exist in the API but are not offered.
- Agents have no tools; outputs are analysis/drafts only. Market Research cannot browse the web and
  says so in its `limitations` field.
- Cancellation of a running job is cooperative (Postgres polled every second); BullMQ job is not
  force-killed.
- Overview "Scheduled tasks", revenue and profit show "Not tracked yet" until workflows and the
  finance module exist.
- Approvals currently gate one action (flagged Command Center workstreams). There are no
  notifications for pending requests yet; check the Approvals page or the overview alert.
- Approval expiry (72 hours) and the rejection block (30 days) are fixed, not configurable.
- The owner can approve their own requests (single-owner workspaces have no one else); the decision
  is still a separate, audited step.
- Built-in (shared) agents cannot be edited or disabled in the UI; duplicate them into a business
  instead. There is no instance-admin role yet.
- Agent Builder offers vetted output contracts only; free-form custom JSON schemas are not supported.
- Spending limits are set through environment variables, not in the UI.
- The e2e suite reuses one signed-in session after the first form sign-in, because Better Auth's
  sign-in rate limit refuses rapid repeated sign-ins.
- Next.js dev server may full-reload once when a route first compiles; E2E tests therefore run against
  a production build.
- Test databases accumulate rows (suites are non-destructive by design); drop and recreate them manually
  if they grow.
