import type { ReactNode } from "react";
import { useAuth } from "@/lib/auth";

/** One sign-in for every tab: the form lives in the top bar, so pages only need to wait for it. */
export function RequireAuth({ children, what }: { children: ReactNode; what: string }) {
  const { user, ready } = useAuth();
  if (!ready) {
    return <p className="p-6 text-sm text-muted-foreground">Checking session…</p>;
  }
  if (!user) {
    return (
      <div className="mx-auto mt-16 max-w-md rounded-lg border bg-card p-6 text-center shadow-sm">
        <h1 className="text-lg font-semibold">Sign in to open {what}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Use <b>Admin sign in</b> at the top right. One sign-in covers every tab.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}
