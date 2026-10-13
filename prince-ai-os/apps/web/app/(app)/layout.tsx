import type { ReactNode } from "react";
import { getAiStatus, runPolicyFromEnv } from "@prince/core";
import { AppShell } from "@/components/shell/app-shell";
import { db } from "@/lib/server";
import { requireUser } from "@/lib/session";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const { mode, anthropicConfigured, realCallsAvailable, mockAvailable, budget } =
    await getAiStatus(db, runPolicyFromEnv());
  return (
    <AppShell
      user={{ name: user.name, email: user.email }}
      aiStatus={{ mode, anthropicConfigured, realCallsAvailable, mockAvailable, budget }}
    >
      {children}
    </AppShell>
  );
}
