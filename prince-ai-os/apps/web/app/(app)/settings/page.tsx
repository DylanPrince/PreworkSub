import { formatUsd } from "@prince/shared";
import { PageHeader } from "@/components/common/page-header";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db, env } from "@/lib/server";
import { requireUser } from "@/lib/session";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requireUser();
  const prices = await db.modelPrice.findMany({ orderBy: { inputPerMTok: "desc" } });
  return (
    <div className="space-y-4">
      <PageHeader title="Settings" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Appearance</CardTitle>
              <CardDescription>
                Dark mode is the default. Your choice is stored in this browser.
              </CardDescription>
            </div>
            <ThemeToggle />
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p>{user.name}</p>
            <p className="text-muted-foreground">{user.email}</p>
            <p className="pt-2 text-xs text-muted-foreground">
              Multi-factor authentication is planned for Milestone 7.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>AI spend limits</CardTitle>
              <CardDescription>
                Hard limits enforced by the worker before every run. Set in the server environment.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Daily (AI_DAILY_BUDGET_USD)</span>
              <span className="font-mono">{formatUsd(env.AI_DAILY_BUDGET_USD)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Monthly (AI_MONTHLY_BUDGET_USD)</span>
              <span className="font-mono">{formatUsd(env.AI_MONTHLY_BUDGET_USD)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Default model</span>
              <code className="font-mono text-xs">{env.AI_DEFAULT_MODEL}</code>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Model price table</CardTitle>
              <CardDescription>
                USD per million tokens, used for cost tracking and budget checks.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1.5 pr-3 font-medium">Model</th>
                  <th className="py-1.5 pr-3 font-medium">Input</th>
                  <th className="py-1.5 pr-3 font-medium">Output</th>
                  <th className="py-1.5 pr-3 font-medium">Cache write</th>
                  <th className="py-1.5 font-medium">Cache read</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border font-mono">
                {prices.map((p) => (
                  <tr key={p.model}>
                    <td className="py-1.5 pr-3">{p.model}</td>
                    <td className="py-1.5 pr-3">${Number(p.inputPerMTok)}</td>
                    <td className="py-1.5 pr-3">${Number(p.outputPerMTok)}</td>
                    <td className="py-1.5 pr-3">${Number(p.cacheWritePerMTok)}</td>
                    <td className="py-1.5">${Number(p.cacheReadPerMTok)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[11px] text-muted-foreground">{prices[0]?.source}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
