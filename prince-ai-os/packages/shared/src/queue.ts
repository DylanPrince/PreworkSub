/** BullMQ queue names and job payload contracts shared by web (producer) and worker (consumer). */
export const QUEUES = {
  agentRuns: "agent-runs",
} as const;

export const AGENT_RUN_JOB = "execute-agent-run";

/** v1 job contract. The job carries only the run id; everything else is loaded from Postgres. */
export interface AgentRunJobV1 {
  version: 1;
  runId: string;
}
