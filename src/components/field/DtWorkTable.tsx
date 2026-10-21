import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CheckCheck, Download, Undo2, UserPlus } from "lucide-react";
import { fmtDate, useRefresh, type Model } from "@/lib/field/data";
import { buildDtWork, type DtWork, type DtWorker, type DtWorkState } from "@/lib/field/fieldwork";
import { addMany, patchMany } from "@/lib/field/db";
import { auth } from "@/lib/field/firebase";
import { downloadSheet } from "@/lib/field/dataTools";
import { useScope, scopeFeederIds } from "@/lib/field/scope";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const STATE_LABEL: Record<DtWorkState, string> = {
  self: "Not assigned on the app",
  unauthorised: "Self-assigned · awaiting authorisation",
  wrong_staff: "Captured by someone not on this DT",
  ok: "Assigned & matches",
};
const STATE_CLS: Record<DtWorkState, string> = {
  self: "bg-destructive text-destructive-foreground",
  unauthorised: "bg-warning text-warning-foreground",
  wrong_staff: "bg-destructive text-destructive-foreground",
  ok: "bg-success text-success-foreground",
};
type Filter = "flagged" | "all" | DtWorkState;

/** One person on a DT. Supervisors, people who have left and strangers each look different so nobody is mistaken for a current enumerator. */
export function WorkerChip({ w, dtHasHolders }: { w: DtWorker; dtHasHolders: boolean }) {
  const kindCls = {
    staff: "border-border bg-muted",
    supervisor: "border-accent bg-accent/15",
    former: "border-dashed border-warning bg-warning/20 italic",
    unknown: "border-destructive bg-destructive/10 text-destructive",
  }[w.kind];
  const tag = w.kind === "supervisor" ? "Supervisor" : w.kind === "former" ? `No longer on project · ${w.note}` : w.kind === "unknown" ? "Not on staff list" : null;
  const off = dtHasHolders && !w.historyOnly && !w.isHolder;
  return (
    <span className={cn("mr-1 mb-1 inline-flex flex-wrap items-center gap-1 rounded border px-1.5 py-0.5 text-xs", kindCls)} title={w.enumerator?.full_name ?? w.username}>
      <b>@{w.username}</b>
      {tag && <span className="rounded bg-background/70 px-1 text-[10px] font-bold uppercase not-italic">{tag}</span>}
      <span className="text-muted-foreground not-italic">
        {w.historyOnly ? "earlier upload" : `${w.customers} cust${w.poles ? ` · ${w.poles} LT` : ""}`}
      </span>
      {off && <span className="font-bold text-destructive not-italic">⚠ not on DT</span>}
    </span>
  );
}

export function DtWorkTable({ m, onlyDts, canEdit = true, defaultFilter = "flagged" }: { m: Model; onlyDts?: Set<string> | undefined; canEdit?: boolean; defaultFilter?: Filter }) {
  const refresh = useRefresh();
  const scope = useScope();
  const [filter, setFilter] = useState<Filter>(defaultFilter);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const feederIds = useMemo(() => scopeFeederIds(scope, m.feeders.map((f) => f.feeder_id)), [scope, m.feeders]);
  const all = useMemo(() => buildDtWork(m, feederIds, scope), [m, feederIds, scope]);
  const base = useMemo(() => (onlyDts ? all.filter((r) => onlyDts.has(r.dt.dt_id)) : all), [all, onlyDts]);
  const n = (f: (r: DtWork) => boolean) => base.filter(f).length;
  const shown = base.filter((r) => (filter === "all" ? true : filter === "flagged" ? r.state !== "ok" || r.teamGaps.length > 0 : r.state === filter))
    .filter((r) => !q || `${r.dt.dt_id} ${r.dt.dt_name ?? ""} ${r.feederName} ${r.workers.map((w) => w.username + " " + (w.enumerator?.full_name ?? "")).join(" ")}`.toLowerCase().includes(q.toLowerCase()));

  async function authorise(r: DtWork) {
    setBusy(true);
    try {
      const uid = auth().currentUser?.uid ?? null;
      await patchMany("allocations", r.selfAllocIds.map((id) => ({ id, patch: { authorised: true, authorised_by: uid, authorised_on: new Date().toISOString().slice(0, 10) } })));
      toast.success(`Authorised the assignment on ${r.dt.dt_name || r.dt.dt_id}`);
      await refresh();
    } catch (e: any) { toast.error(e?.message ?? "Couldn't authorise"); }
    setBusy(false);
  }
  async function remove(r: DtWork) {
    if (!window.confirm(`Remove the self-assignment on ${r.dt.dt_name || r.dt.dt_id}? The DT goes back to Not assigned. Captures already uploaded stay on record.`)) return;
    setBusy(true);
    try {
      await patchMany("allocations", r.selfAllocIds.map((id) => ({ id, patch: { status: "cancelled" } })));
      const stillHeld = r.liveAllocIds.length > r.selfAllocIds.length;
      if (!stillHeld && r.dt.status === "assigned") await patchMany("dts", [{ id: r.dt.id, patch: { status: "unassigned", status_note: null, updated_at: new Date().toISOString() } }]);
      toast.success("Self-assignment removed");
      await refresh();
    } catch (e: any) { toast.error(e?.message ?? "Couldn't remove"); }
    setBusy(false);
  }
  /** Not assigned on the app at all (locked feeder, or only non-staff captured): assign it to the listed staff, already authorised. */
  async function assignToWorkers(r: DtWork) {
    const staff = r.workers.filter((w) => w.enumerator && w.kind === "staff");
    if (!staff.length) return toast.error("None of the people who worked on it are on the staff list. Assign it from DT Allocation.");
    setBusy(true);
    try {
      const uid = auth().currentUser?.uid ?? null;
      const today = new Date().toISOString().slice(0, 10);
      await addMany("allocations", staff.map((w) => ({ dt_id: r.dt.dt_id, enumerator_id: w.enumerator!.id, allocated_on: today, due_date: null, notes: "Assigned from uploaded captures", allocated_by: uid, status: "active", completed_on: null, self_assigned: true, authorised: true, authorised_by: uid })));
      if (r.dt.status === "unassigned") await patchMany("dts", [{ id: r.dt.id, patch: { status: "assigned", status_note: null, updated_at: new Date().toISOString() } }]);
      toast.success(`Assigned to ${staff.map((w) => "@" + w.username).join(", ")}`);
      await refresh();
    } catch (e: any) { toast.error(e?.message ?? "Couldn't assign"); }
    setBusy(false);
  }
  function download() {
    const rows = shown.map((r) => ({
      FEEDER: r.feederName, FEEDER_ID: r.dt.feeder_id, DT_NAME: r.dt.dt_name ?? "", DT_ID: r.dt.dt_id, DT_STATUS: r.dt.status,
      CHECK: STATE_LABEL[r.state], ASSIGNED_ON_APP: r.holders.map((h) => h.username).join(", "),
      WORKED_BY: r.workers.map((w) => `${w.username}${w.kind !== "staff" ? ` (${w.kind === "former" ? "former: " + w.note : w.kind})` : ""} ${w.customers}c/${w.poles}lt`).join("; "),
      CUSTOMERS: r.customers, LT_POLES: r.poles, TEAM_MEMBERS_WITHOUT_CAPTURE: r.teamGaps.join(", "),
    }));
    downloadSheet("dt_work_log", rows, ["FEEDER", "FEEDER_ID", "DT_NAME", "DT_ID", "DT_STATUS", "CHECK", "ASSIGNED_ON_APP", "WORKED_BY", "CUSTOMERS", "LT_POLES", "TEAM_MEMBERS_WITHOUT_CAPTURE"]);
  }

  const chip = (f: Filter, label: string, count: number) => (
    <button key={f} onClick={() => setFilter(f)} className={cn("rounded-full border px-3 py-1 text-xs font-bold", filter === f ? "bg-foreground text-background" : "hover:bg-muted")}>
      {label} <span className="opacity-70">({count})</span>
    </button>
  );

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {chip("flagged", "Needs attention", n((r) => r.state !== "ok" || r.teamGaps.length > 0))}
        {chip("self", "Not assigned on the app", n((r) => r.state === "self"))}
        {chip("unauthorised", "Awaiting authorisation", n((r) => r.state === "unauthorised"))}
        {chip("wrong_staff", "Wrong staff", n((r) => r.state === "wrong_staff"))}
        {chip("ok", "Matches", n((r) => r.state === "ok"))}
        {chip("all", "All DTs", base.length)}
        <Input className="ml-auto w-56" placeholder="Search DT, feeder, username" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button size="sm" variant="outline" disabled={!shown.length} onClick={download}><Download /> Download</Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-muted-foreground">
            <tr><th className="p-2">DT</th><th>Feeder</th><th>Assigned on the app</th><th>Worked on it (who)</th><th>Check</th>{canEdit && <th />}</tr>
          </thead>
          <tbody>
            {shown.slice(0, 300).map((r) => (
              <tr key={r.dt.dt_id} className={cn("border-t align-top", r.state === "wrong_staff" || r.state === "self" ? "bg-destructive/5" : r.state === "unauthorised" ? "bg-warning/10" : "")}>
                <td className="p-2 font-bold">{r.dt.dt_name || r.dt.dt_id}<div className="text-xs font-normal text-muted-foreground">{r.dt.dt_id} · {r.dt.status}</div></td>
                <td className="text-xs">{r.feederName}</td>
                <td className="text-xs">
                  {r.holders.length ? r.holders.map((h) => h.full_name || h.username).join(" + ") : <span className="text-muted-foreground">nobody</span>}
                  {r.team && <div className="font-bold text-muted-foreground">team of {r.holders.length}</div>}
                </td>
                <td className="py-2">
                  {r.workers.map((w) => <WorkerChip key={w.key} w={w} dtHasHolders={r.holders.length > 0} />)}
                  {r.teamGaps.length > 0 && <div className="text-xs font-bold text-warning-foreground">⚠ No capture yet from team member(s): {r.teamGaps.join(", ")}</div>}
                  <div className="text-xs text-muted-foreground">{r.customers} customer{r.customers === 1 ? "" : "s"}{r.poles ? ` · ${r.poles} LT pole${r.poles === 1 ? "" : "s"}` : ""} · last {fmtDate(r.workers.map((w) => w.last).filter(Boolean).sort().pop())}</div>
                </td>
                <td><span className={cn("inline-block rounded px-2 py-0.5 text-xs font-extrabold", STATE_CLS[r.state])}>{STATE_LABEL[r.state]}</span></td>
                {canEdit && (
                  <td className="whitespace-nowrap text-right">
                    {r.state === "unauthorised" && (<>
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => authorise(r)}><CheckCheck /> Authorise</Button>
                      <Button size="sm" variant="ghost" className="text-destructive" disabled={busy} onClick={() => remove(r)}><Undo2 /> Remove</Button>
                    </>)}
                    {r.state === "self" && <Button size="sm" variant="outline" disabled={busy} onClick={() => assignToWorkers(r)}><UserPlus /> Assign to them</Button>}
                  </td>
                )}
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">{base.length ? "Nothing in this view." : "No captures on the feeders you are working on yet."}</td></tr>}
          </tbody>
        </table>
        {shown.length > 300 && <p className="p-2 text-xs text-muted-foreground">Showing the first 300 of {shown.length}. Use the search or Download for the rest.</p>}
      </div>
    </div>
  );
}
