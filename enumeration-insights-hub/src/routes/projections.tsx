import { createFileRoute, Link } from "@tanstack/react-router";
import { RequireAuth } from "@/components/RequireAuth";
import { FieldRoleGate } from "@/components/field/FieldRoleGate";
import { useAppData, useRole } from "@/lib/field/data";
import { ProjectionsTab } from "@/components/field/ProjectionsTab";

export const Route = createFileRoute("/projections")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Projections & Reports — AEDC Enumeration" },
      { name: "description", content: "Feeder completion projections from estimated customer points, captures, allocated enumerators and the daily target." },
      { property: "og:title", content: "Projections & Reports — AEDC Enumeration" },
      { property: "og:description", content: "Project feeder completion dates with a ±10% buffer and export PDF reports." },
    ],
  }),
  component: () => (
    <RequireAuth what="Projections">
      <FieldRoleGate>
        <ProjectionsPage />
      </FieldRoleGate>
    </RequireAuth>
  ),
});

function ProjectionsPage() {
  const { data: me } = useRole();
  const { data: m, isLoading, error } = useAppData();
  return (
    <main className="mx-auto max-w-[1500px] space-y-4 p-3 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Projections &amp; Reports</h1>
        <Link to="/field" className="text-sm font-medium text-primary hover:underline">Open Field Manager →</Link>
      </div>
      {isLoading && <p className="text-muted-foreground">Loading feeder data…</p>}
      {error && <p className="text-destructive">Couldn't load data: {(error as Error).message}</p>}
      {m && <ProjectionsTab m={m} isAdmin={me?.role === "admin"} />}
    </main>
  );
}
