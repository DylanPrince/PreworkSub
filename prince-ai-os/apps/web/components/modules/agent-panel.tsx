import Link from "next/link";
import type { RunModes } from "@/components/tasks/run-controls";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AskAgent } from "./ask-agent";
import { RelatedTasks, type RelatedTask } from "./related-tasks";

/** "Ask an agent" about a record, plus the agent work already done on it. */
export function AgentPanel({
  subjectType,
  subjectId,
  agents,
  defaultAgentId,
  suggestions,
  modes,
  tasks,
  canAsk,
  description = "Agents read this record's current details. Results are drafts for you to review; nothing is sent or published.",
}: {
  subjectType: "product" | "content_item" | "campaign" | "saas_project" | "finance";
  subjectId: string;
  agents: { id: string; name: string }[];
  defaultAgentId?: string;
  suggestions: string[];
  modes: RunModes;
  tasks: RelatedTask[];
  canAsk: boolean;
  description?: string;
}) {
  return (
    <Card aria-labelledby={`agent-work-${subjectType}`}>
      <CardHeader>
        <div>
          <CardTitle id={`agent-work-${subjectType}`}>Ask an agent</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {!canAsk ? (
          <p className="text-sm text-muted-foreground">
            Members, admins and owners of this business can ask agents.
          </p>
        ) : agents.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No runnable agent is available to this business.{" "}
            <Link href="/agent-builder" className="underline">
              Build one in Agent Builder
            </Link>
            .
          </p>
        ) : (
          <AskAgent
            subjectType={subjectType}
            subjectId={subjectId}
            agents={agents}
            defaultAgentId={defaultAgentId}
            suggestions={suggestions}
            modes={modes}
          />
        )}
        <div>
          <h3 className="mb-1 text-xs font-medium text-muted-foreground">
            Agent work on this record
          </h3>
          <RelatedTasks tasks={tasks} />
        </div>
      </CardContent>
    </Card>
  );
}
