"use client";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Polls a progress signature endpoint while work is active, and refreshes the server-rendered page
 * whenever the signature differs from the one it was rendered with.
 */
export function ProgressPoller({
  url,
  signature,
  active,
}: {
  url: string;
  signature: string;
  active: boolean;
}) {
  const router = useRouter();
  const { data, dataUpdatedAt } = useQuery({
    queryKey: ["progress", url],
    queryFn: async () => {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`Status ${res.status}`);
      return (await res.json()) as { signature: string; active: boolean };
    },
    enabled: active,
    refetchInterval: active ? 1500 : false,
  });
  useEffect(() => {
    if (data && data.signature !== signature) router.refresh();
  }, [data, dataUpdatedAt, signature, router]);
  if (!active) return null;
  return (
    <p aria-live="polite" className="text-xs text-muted-foreground">
      Live: agents are working…
    </p>
  );
}
