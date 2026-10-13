"use client";
import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export function UserMenu({ name, email }: { name: string; email: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div className="flex items-center gap-2">
      <div className="hidden text-right sm:block">
        <p className="text-xs font-medium leading-tight">{name}</p>
        <p className="text-[11px] leading-tight text-muted-foreground">{email}</p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Sign out"
        disabled={pending}
        onClick={() =>
          start(async () => {
            await authClient.signOut();
            router.push("/sign-in");
            router.refresh();
          })
        }
      >
        <LogOut />
      </Button>
    </div>
  );
}
