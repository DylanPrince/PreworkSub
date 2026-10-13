# Known issues and limitations

- **No real Claude run has been executed** in this environment: no `ANTHROPIC_API_KEY` is configured.
  The Anthropic provider is unit-tested for configuration and error mapping only. First real run should
  be watched (structured output parsing, cost figures).
- Agents have no tools; outputs are analysis/drafts only. Market Research cannot browse the web and
  says so in its `limitations` field.
- Cost of automatic retry attempts is stored in `retry_scheduled` event data, not summed into the run's
  `costUsd`. Budget checks therefore slightly under-count spend from retried attempts.
- Budget checks are not atomic across concurrent workers: two runs started at the same moment can both
  pass a nearly exhausted limit (bounded by one run's per-run budget each).
- Cancellation of a running job is cooperative (Postgres polled every second); BullMQ job is not
  force-killed.
- `costIsEstimate` is never set yet (all priced models have table entries).
- Overview "Pending approvals", "Scheduled tasks", revenue and profit show "Not tracked yet" until
  M4/M5.
- Agent configuration cannot be edited in the UI yet (Agent Builder, M3).
- Next.js dev server may full-reload once when a route first compiles; E2E tests therefore run against
  a production build.
- Test databases accumulate rows (suites are non-destructive by design); drop and recreate them manually
  if they grow.
