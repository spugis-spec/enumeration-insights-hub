import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { adminExists, claimAdmin } from "@/lib/field/users";
import { useRole } from "@/lib/field/data";
import { Button } from "@/components/ui/button";

/**
 * Field Manager access is a role record (users/{uid}) on the shared project.
 * If nobody has been set up yet, the signed-in person can become the first admin.
 */
export function FieldRoleGate({ children }: { children: ReactNode }) {
  const { data: me, isLoading } = useRole();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const setup = useQuery({ queryKey: ["field-setup-needed"], queryFn: async () => !(await adminExists()), enabled: me?.role === "none" });

  if (isLoading) return <p className="p-6 text-sm text-muted-foreground">Loading access…</p>;
  if (me && me.role === "none") {
    return (
      <div className="mx-auto mt-16 max-w-md space-y-3 rounded-lg border bg-card p-6 shadow-sm">
        {setup.data ? (
          <>
            <h1 className="text-lg font-semibold">Set up Field Manager</h1>
            <p className="text-sm text-muted-foreground">No Field Manager admin exists yet. Make {me.email} the admin? Other people are then added from Users &amp; Staff.</p>
            <Button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await claimAdmin();
                  toast.success("You are now the Field Manager admin");
                  await qc.invalidateQueries();
                } catch (e: any) {
                  toast.error(e?.message ?? "Couldn't set up admin");
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "Please wait…" : "Make me the admin"}
            </Button>
          </>
        ) : (
          <>
            <h1 className="text-lg font-semibold">No Field Manager access yet</h1>
            <p className="text-sm text-muted-foreground">You're signed in as {me.email}, but this account has no Field Manager role. Ask the admin to add you in Users &amp; Staff.</p>
          </>
        )}
      </div>
    );
  }
  return <>{children}</>;
}
