import { cn } from "@/lib/utils";
import { statusLabel } from "@/lib/field/data";

export function Stat({ label, value, tone = "default", sub }: { label: string; value: number | string; tone?: "default" | "success" | "danger" | "warning" | "accent"; sub?: string }) {
  const toneCls = {
    default: "border-l-primary",
    success: "border-l-success text-success",
    danger: "border-l-destructive text-destructive",
    warning: "border-l-warning",
    accent: "border-l-accent",
  }[tone];
  return (
    <div className={cn("rounded-lg border border-l-4 bg-card p-4 shadow-sm", toneCls)}>
      <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-display text-4xl font-extrabold leading-none mt-1">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const cls: Record<string, string> = {
    unassigned: "bg-destructive text-destructive-foreground",
    assigned: "bg-success text-success-foreground",
    completed: "bg-primary text-primary-foreground",
    problematic: "bg-warning text-warning-foreground",
    access_denied: "bg-foreground text-background",
  };
  return (
    <span className={cn("inline-block rounded px-2 py-0.5 text-xs font-extrabold uppercase tracking-wide", cls[status] ?? "bg-muted")}>
      {status === "unassigned" ? "Not assigned" : statusLabel(status)}
    </span>
  );
}

export function Section({ title, children, actions }: { title: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-xl font-bold uppercase tracking-wide">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

export const selectCls = "h-9 rounded-md border border-input bg-background px-2 text-sm";
