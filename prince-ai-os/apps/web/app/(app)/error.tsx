"use client";
import { Button } from "@/components/ui/button";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div role="alert" className="rounded-xl border border-danger/40 bg-danger-soft p-6">
      <h1 className="text-sm font-semibold text-danger">Something went wrong</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {error.digest ? `Error reference ${error.digest}. ` : ""}Details were logged on the server.
      </p>
      <Button className="mt-4" variant="secondary" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
