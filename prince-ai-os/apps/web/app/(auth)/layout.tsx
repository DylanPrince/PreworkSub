import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2">
          <span
            aria-hidden
            className="grid size-7 place-items-center rounded-md bg-primary text-xs font-bold text-primary-foreground"
          >
            P
          </span>
          <span className="text-base font-semibold tracking-tight">Prince AI OS</span>
        </div>
        {children}
      </div>
    </main>
  );
}
