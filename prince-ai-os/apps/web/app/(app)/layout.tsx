import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { env } from "@/lib/server";
import { requireUser } from "@/lib/session";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const providerLabel =
    env.AI_PROVIDER === "mock"
      ? "Mock (dev only)"
      : env.ANTHROPIC_API_KEY
        ? "Claude API"
        : "Claude API · not configured";
  return (
    <AppShell user={{ name: user.name, email: user.email }} providerLabel={providerLabel}>
      {children}
    </AppShell>
  );
}
