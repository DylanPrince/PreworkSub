import { PageHeader } from "@/components/common/page-header";
import { TestAnthropicButton } from "@/components/integrations/test-anthropic";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { env } from "@/lib/server";
import { requireUser } from "@/lib/session";

export const metadata = { title: "Integrations" };

type State = "CONNECTED" | "NOT CONNECTED" | "REQUIRES CONFIGURATION" | "UNSUPPORTED" | "ERROR";

const TONE: Record<State, "success" | "neutral" | "warning" | "danger"> = {
  CONNECTED: "success",
  "NOT CONNECTED": "neutral",
  "REQUIRES CONFIGURATION": "warning",
  UNSUPPORTED: "neutral",
  ERROR: "danger",
};

/**
 * Status is derived from server configuration only. A name on this page never implies a connection:
 * every integration except Anthropic is reported as not connected until its adapter ships.
 */
export default async function IntegrationsPage() {
  await requireUser();
  const rows: { name: string; purpose: string; state: State; note: string }[] = [
    {
      name: "Anthropic (Claude API)",
      purpose: "Agent execution",
      state: env.ANTHROPIC_API_KEY ? "CONNECTED" : "REQUIRES CONFIGURATION",
      note: env.ANTHROPIC_API_KEY
        ? "API key present in server environment. Use Test connection to verify it is accepted."
        : "Set ANTHROPIC_API_KEY in the server environment (never in the browser). Usage is billed by Anthropic.",
    },
    {
      name: "Shopify",
      purpose: "Store catalog, orders, inventory",
      state: "NOT CONNECTED",
      note: "Adapter planned for Milestone 6 (official Admin API, OAuth).",
    },
    {
      name: "Meta (Facebook / Instagram)",
      purpose: "Ads reporting, publishing",
      state: "NOT CONNECTED",
      note: "Requires a Meta app and review. Planned for Milestone 6.",
    },
    {
      name: "Google / YouTube",
      purpose: "Analytics, YouTube Data API",
      state: "NOT CONNECTED",
      note: "Planned for Milestone 6.",
    },
    {
      name: "TikTok",
      purpose: "Content and ads APIs",
      state: "NOT CONNECTED",
      note: "Requires developer app approval. Planned for Milestone 6.",
    },
    {
      name: "GitHub",
      purpose: "SaaS project repositories",
      state: "NOT CONNECTED",
      note: "Planned for Milestone 6.",
    },
    {
      name: "Stripe",
      purpose: "Revenue import (read-only)",
      state: "NOT CONNECTED",
      note: "Read-only import planned; the system will never initiate payments.",
    },
    {
      name: "Email provider",
      purpose: "Notifications, drafts",
      state: "NOT CONNECTED",
      note: "Provider not chosen yet.",
    },
    {
      name: "Object storage (S3-compatible)",
      purpose: "Assets and attachments",
      state: "NOT CONNECTED",
      note: "Local storage adapter first; S3 for production.",
    },
  ];

  return (
    <div>
      <PageHeader
        title="Integrations"
        description="Connection status comes from server configuration and live checks. Credentials never reach the browser."
      />
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 font-medium">Integration</th>
              <th className="px-4 py-2.5 font-medium">Used for</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 font-medium">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.name} className="align-top">
                <td className="px-4 py-3 font-medium">{r.name}</td>
                <td className="px-4 py-3 text-muted-foreground">{r.purpose}</td>
                <td className="px-4 py-3">
                  <Badge tone={TONE[r.state]}>{r.state}</Badge>
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  <p>{r.note}</p>
                  {r.name.startsWith("Anthropic") && (
                    <div className="mt-2">
                      <TestAnthropicButton disabled={!env.ANTHROPIC_API_KEY} />
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {env.AI_PROVIDER === "mock" && (
        <p className="mt-4 text-xs text-warning">
          AI_PROVIDER=mock is set: the worker uses the local mock provider regardless of the
          Anthropic key.
        </p>
      )}
    </div>
  );
}
