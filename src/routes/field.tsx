import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AlertTriangle, BarChart3, Bus, CalendarClock, LogOut, Upload, Users, Zap, Cable } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { RequireAuth } from "@/components/RequireAuth";
import { FieldRoleGate } from "@/components/field/FieldRoleGate";
import { useAppData, useRole } from "@/lib/field/data";
import { OverviewTab } from "@/components/field/OverviewTab";
import { AllocationTab } from "@/components/field/AllocationTab";
import { UploadsTab } from "@/components/field/UploadsTab";
import { ProjectionsTab } from "@/components/field/ProjectionsTab";
import { VehiclesTab } from "@/components/field/VehiclesTab";
import { AlertsTab } from "@/components/field/AlertsTab";
import { UsersTab } from "@/components/field/UsersTab";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/field")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>): { tab?: string } => (typeof s["tab"] === "string" ? { tab: s["tab"] } : {}),
  head: () => ({
    meta: [
      { title: "Field Manager — DT Allocation & Monitoring" },
      { name: "description", content: "Allocate DTs to enumerators, track supervisors and monitor feeder progress." },
      { property: "og:title", content: "Field Manager — DT Allocation & Monitoring" },
      { property: "og:description", content: "DT allocation, supervisor tracking and feeder progress for AEDC enumeration." },
    ],
  }),
  component: FieldPage,
});

function FieldPage() {
  return (
    <RequireAuth what="Field Manager">
      <FieldRoleGate>
        <Dashboard />
      </FieldRoleGate>
    </RequireAuth>
  );
}

const TABS = [
  { id: "overview", label: "Overview", icon: BarChart3, admin: true },
  { id: "allocation", label: "DT Allocation", icon: Cable },
  { id: "alerts", label: "Capture Alerts", icon: AlertTriangle, admin: true },
  { id: "projections", label: "Projections & Reports", icon: CalendarClock, admin: true },
  { id: "vehicles", label: "Vehicle Schedule", icon: Bus, admin: true },
  { id: "uploads", label: "Data Uploads", icon: Upload, admin: true },
  { id: "users", label: "Users & Staff", icon: Users, admin: true },
] as const;

function Dashboard() {
  const { logout } = useAuth();
  const { data: me } = useRole();
  const { data: m, isLoading, error } = useAppData();
  const search = Route.useSearch();
  const [tab, setTab] = useState<string>(search.tab ?? "allocation");
  const isAdmin = me?.role === "admin";

  // Same session as the top bar: signing out here signs out everywhere.
  const signOut = () => logout();

  const tabs = TABS.filter((t) => !("admin" in t) || isAdmin);
  const activeTab = tabs.some((t) => t.id === tab) ? tab : "allocation";

  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-background">
      <header className="bg-foreground text-background">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-2 px-3 py-2 sm:gap-4 sm:px-4 sm:py-3">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-md bg-accent text-accent-foreground"><Zap className="h-5 w-5" /></div>
            <span className="font-display text-base font-bold uppercase tracking-wider sm:text-xl">Field Manager · DT Allocation</span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <div className="hidden text-right leading-tight sm:block">
              <div className="font-bold">{me?.name}</div>
              <div className="text-xs uppercase tracking-wider text-primary">{me?.role}</div>
            </div>
            <button onClick={signOut} className="inline-flex items-center gap-1 rounded-md border border-background/30 px-3 py-1.5 hover:bg-background/10">
              <LogOut className="h-4 w-4" /> <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-[1500px] gap-1 overflow-x-auto px-4">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-t-md px-4 py-2.5 text-sm font-bold transition-colors",
                activeTab === t.id ? "bg-background text-foreground" : "text-background/70 hover:text-background",
              )}
            >
              <t.icon className="h-4 w-4" /> {t.label}
              {t.id === "alerts" && m && m.alerts.length > 0 && (
                <span className="rounded-full bg-destructive px-2 text-xs text-destructive-foreground">{m.alerts.length}</span>
              )}
            </button>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-[1500px] p-3 md:p-6">
        {me?.role === "none" && <p className="rounded-md bg-destructive/10 p-4 text-destructive">Your account has no role yet. Ask the admin to give you access.</p>}
        {isLoading && <p className="text-muted-foreground">Loading data…</p>}
        {error && <p className="text-destructive">Couldn't load data: {(error as Error).message}</p>}
        {m && me && (
          <>
            {activeTab === "overview" && <OverviewTab m={m} goTo={setTab} />}
            {activeTab === "allocation" && <AllocationTab m={m} isAdmin={isAdmin} />}
            {activeTab === "alerts" && <AlertsTab m={m} goTo={setTab} />}
            {activeTab === "projections" && <ProjectionsTab m={m} isAdmin={isAdmin} />}
            {activeTab === "vehicles" && <VehiclesTab m={m} isAdmin={isAdmin} />}
            {activeTab === "uploads" && isAdmin && <UploadsTab m={m} />}
            {activeTab === "users" && isAdmin && <UsersTab m={m} />}
          </>
        )}
      </main>
    </div>
  );
}
