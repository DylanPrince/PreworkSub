# Next steps

1. **You**: decide whether to add an `ANTHROPIC_API_KEY` (incurs usage charges, capped by the budget env
   vars). Then run one task per executable agent and check output and cost.
2. Agent Builder (create/version agents, sandbox run).
3. AI Command Center v1 on top of `requestRun`.
4. Approval system with backend enforcement.
5. Business switcher, per-business budgets, task filters.
6. Add remaining executable agents through the registry (each needs a schema, instructions, evaluation
   checks, mock output and tests).
