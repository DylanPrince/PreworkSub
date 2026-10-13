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
- Command Center workstreams are dispatched by the owner. Saved workflows run their steps
  automatically, but a Command Center plan cannot yet be turned into a workflow. Agent suggestions
  match plan roles to agent names, so a role with no matching agent needs a manual choice.
- Workflows start by hand only: scheduled, webhook and event triggers are not built. Steps have no
  conditions or branches; every step runs once its dependencies succeed. The editor is a form, not a
  visual graph.
- If a server process stops between creating a workflow step's task and queueing its run, that step
  stays "open" and the run shows as running; cancel the run and start it again.
- Forwarded results between workstreams or workflow steps are truncated to 6,000 characters each.
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
- Overview "Scheduled tasks" shows "Not tracked yet": recurring schedules do not exist.
- Business modules hold records people enter. No store, ad platform, publishing account, bank or code
  host is connected: approved content is published and recorded by a person, approved campaigns are
  launched in the ad platform by a person, and campaign performance is not tracked. Finance figures
  are only as complete as the entries recorded; there is no import yet.
- Agents do not write back into module records: their drafts appear on the task page and are copied
  into the record by a person.
- Money is in US dollars only. Finance periods and the calendar use UTC days and months.
- Approvals gate four actions so far (flagged Command Center workstreams, workflow steps marked for
  approval, content publication and campaign launch). There are no notifications for pending requests yet; check the Approvals page or the
  overview alert.
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
