import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Lock, MessageCircle, Unlock } from "lucide-react";
import { addRow, updateRow } from "@/lib/field/db";
import { auth } from "@/lib/field/firebase";
import { activeAllocs, DT_STATUSES, feederStats, fmtDate, isPrivateDt, openDtsByEnumerator, useRefresh, waLink, type DT, type Model } from "@/lib/field/data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Section, Stat, StatusBadge, selectCls } from "./common";
import { useConfirm } from "./ConfirmDialog";

export function AllocationTab({ m, isAdmin = false }: { m: Model; isAdmin?: boolean }) {
  const refresh = useRefresh();
  const { ask, dialog } = useConfirm();
  const [feederId, setFeederId] = useState<string>(m.feeders[0]?.feeder_id ?? "");
  const [statusF, setStatusF] = useState("all");
  const [q, setQ] = useState("");
  const [openStaff, setOpenStaff] = useState<string | null>(null);
  const [fq, setFq] = useState("");
  const [allocDt, setAllocDt] = useState<DT | null>(null);
  const [statusDt, setStatusDt] = useState<DT | null>(null);

  const feederMatches = useMemo(() => {
    const t = fq.trim().toLowerCase();
    return t ? m.feeders.filter((f) => `${f.feeder_name} ${f.feeder_id} ${f.area ?? ""}`.toLowerCase().includes(t)) : m.feeders;
  }, [m.feeders, fq]);
  // Typing in the feeder search jumps straight to the first matching feeder.
  function searchFeeder(v: string) {
    setFq(v);
    const t = v.trim().toLowerCase();
    if (!t) return;
    const hit = m.feeders.find((f) => `${f.feeder_name} ${f.feeder_id} ${f.area ?? ""}`.toLowerCase().includes(t));
    if (hit) setFeederId(hit.feeder_id);
  }

  const openByEnum = useMemo(() => openDtsByEnumerator(m), [m]);
  const feeder = m.feederById.get(feederId);
  const stats = feederStats(m, feederId);
  const rows = useMemo(() => {
    return m.dts
      .filter((d) => d.feeder_id === feederId)
      .filter((d) => {
        if (statusF === "all") return true;
        if (statusF === "nocapture") return !(m.subsByDt.get(d.dt_id) ?? 0);
        if (statusF === "pending") return d.status === "unassigned";
        return d.status === statusF;
      })
      .filter((d) => !q || `${d.dt_name} ${d.dt_id}`.toLowerCase().includes(q.toLowerCase()))
      .sort((a, b) => (a.status === "unassigned" ? -1 : 1) - (b.status === "unassigned" ? -1 : 1) || (a.dt_name ?? "").localeCompare(b.dt_name ?? ""));
  }, [m, feederId, statusF, q]);

  async function completeAlloc(dt: DT) {
    const acts = activeAllocs(m, dt.dt_id);
    const today = new Date().toISOString().slice(0, 10);
    try {
      for (const a of acts) await updateRow("allocations", a.id, { status: "completed", completed_on: today });
      await updateRow("dts", dt.id, { status: "completed", updated_at: new Date().toISOString() });
    } catch (e: any) { return toast.error(e.message); }
    toast.success(`${dt.dt_name} marked completed`, {
      description: acts.length ? "Use the WhatsApp button to tell the team they're done." : undefined,
    });
    refresh();
  }

  async function unassign(dt: DT) {
    for (const a of activeAllocs(m, dt.dt_id)) await updateRow("allocations", a.id, { status: "cancelled" });
    await updateRow("dts", dt.id, { status: "unassigned", updated_at: new Date().toISOString() });
    toast.success("Allocation removed");
    refresh();
  }

  async function toggleLock() {
    if (!feeder) return;
    const lock = !feeder.locked;
    const msg = lock
      ? `Lock ${feeder.feeder_name}?\n\nFrom now on, any uploaded capture on this feeder for a DT that is not allocated to that enumerator is flagged under Capture Alerts.`
      : `Unlock ${feeder.feeder_name}?\n\nCaptures on this feeder will no longer be flagged for missing allocations.`;
    ask({ title: lock ? "Lock this feeder?" : "Unlock this feeder?", body: <p className="whitespace-pre-line">{msg}</p>, confirmLabel: lock ? "Lock" : "Unlock", onConfirm: async () => {
      try { await updateRow("feeders", feeder.id, { locked: lock }); } catch (e: any) { return toast.error(e.message); }
      toast.success(lock ? "Feeder locked" : "Feeder unlocked");
      refresh();
    } });
  }

  /** The buttons for one DT (shared by the phone cards and the desktop table). */
  function actions(d: DT) {
    const acts = activeAllocs(m, d.dt_id);
    const names = acts.map((a) => m.enumById.get(a.enumerator_id)).filter(Boolean);
    return (<>
                        <Button size="sm" onClick={() => setAllocDt(d)}>{d.status === "unassigned" ? "Allocate" : "Re-allocate"}</Button>
                        {d.status === "assigned" && <Button size="sm" variant="outline" onClick={() => ask({ title: "Mark as completed?", body: <p><b>{d.dt_name || d.dt_id}</b> will be marked completed and its allocation closed.</p>, confirmLabel: "Yes, mark completed", onConfirm: () => completeAlloc(d) })}>✓ Complete</Button>}
                        {d.status === "completed" && names[0]?.phone && (
                          <a className="inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs" target="_blank" rel="noreferrer"
                            href={waLink(names[0].phone, `Hello ${names[0].full_name || names[0].username}, DT ${d.dt_name} (${d.dt_id}) is marked COMPLETED. Well done — await your next allocation.`)}>
                            <MessageCircle className="h-3 w-3" /> Notify
                          </a>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => setStatusDt(d)}>Status</Button>
                        {acts.length > 0 && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => ask({ title: "Unassign this DT?", danger: true, body: <><p><b>{d.dt_name || d.dt_id}</b> will be removed from {acts.map((a) => m.enumById.get(a.enumerator_id)?.full_name || m.enumById.get(a.enumerator_id)?.username || "an enumerator").join(", ")} and go back to <b>Not assigned</b>.</p></>, confirmLabel: "Yes, unassign", onConfirm: () => unassign(d) })}>Unassign</Button>}
</>);
  }

  /** Jump to a DT: opens its feeder and filters the list down to it. */
  function goToDt(d: DT) {
    setFeederId(d.feeder_id); setFq(""); setStatusF("all"); setQ(d.dt_id);
    window.scrollTo({ top: 0, behavior: "smooth" });
    toast.message(`Showing ${d.dt_name || d.dt_id}`, { description: "Clear the DT search box to see all DTs again." });
  }

  /** A staff name that opens a list of the other DTs they still hold. */
  function staffName({ enumId, dtId }: { enumId: string; dtId: string }) {
    const k = `${enumId}|${dtId}`;
    const open = openStaff === k;
    const setOpen = (f: (v: boolean) => boolean) => setOpenStaff(f(open) ? k : null);
    const e = m.enumById.get(enumId);
    const o = otherOpen(enumId, dtId);
    const name = e?.full_name || e?.username || "?";
    if (!o.length) return <div className="font-semibold">{name}</div>;
    return (
      <div className="font-semibold">
        <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center gap-1 text-left underline decoration-dotted underline-offset-2">
          {name} <span className="rounded bg-warning/20 px-1 text-[11px] font-bold no-underline">⚠ {o.length} other open DT{o.length > 1 ? "s" : ""} {open ? "▲" : "▼"}</span>
        </button>
        {open && (
          <ul className="mt-1 max-h-56 overflow-y-auto rounded border bg-background text-xs font-normal">
            {o.map((x) => (
              <li key={x.dt_id} className="flex items-center gap-1 border-b px-2 py-1 last:border-0">
                <button type="button" className="flex-1 text-left hover:underline" onClick={() => goToDt(x)}>
                  {x.dt_name || x.dt_id} <span className="text-muted-foreground">· {m.feederById.get(x.feeder_id)?.feeder_name ?? x.feeder_id}</span>
                </button>
                <button type="button" title="Mark completed" className="rounded border px-1.5 py-0.5 font-bold text-success hover:bg-success/10"
                  onClick={() => ask({ title: "Mark as completed?", body: <p><b>{x.dt_name || x.dt_id}</b> will be marked completed and its allocation closed.</p>, confirmLabel: "Yes, mark completed", onConfirm: () => completeAlloc(x) })}>✓</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  /** "Also on DT X" warnings for staff who still hold another DT that isn't completed. */
  function otherOpen(enumId: string, dtId: string) {
    return (openByEnum.get(enumId) ?? []).filter((x) => x.dt_id !== dtId);
  }

  if (!m.feeders.length) return <Section title="DT Allocation"><p className="text-muted-foreground">Upload the feeder lookup first.</p></Section>;

  return (
    <div className="grid gap-4 md:gap-6 xl:grid-cols-[1fr_300px]">
      <div className="space-y-4">
        <Section title="Select feeder">
          <div className="flex flex-wrap gap-2">
            <Input className="w-full sm:w-56" placeholder="Search feeder name or ID" value={fq} onChange={(e) => searchFeeder(e.target.value)} />
            <select className={selectCls + " w-full sm:w-auto sm:min-w-72 font-bold"} value={feederId} onChange={(e) => setFeederId(e.target.value)}>
              {!feederMatches.some((f) => f.feeder_id === feederId) && feeder && <option value={feederId}>{feeder.feeder_name} ({feeder.feeder_id})</option>}
              {feederMatches.map((f) => {
                const s = feederStats(m, f.feeder_id);
                return <option key={f.feeder_id} value={f.feeder_id}>{f.locked ? "🔒 " : ""}{f.feeder_name} ({f.feeder_id}) · {s.unassigned} not assigned</option>;
              })}
            </select>
            {fq.trim() && <span className="self-center text-xs text-muted-foreground">{feederMatches.length} feeder{feederMatches.length === 1 ? "" : "s"} match</span>}
            <select className={selectCls + " w-full sm:w-auto"} value={statusF} onChange={(e) => setStatusF(e.target.value)}>
              <option value="all">All DTs</option>
              <option value="pending">Pending allocation</option>
              <option value="nocapture">No capture yet</option>
              {DT_STATUSES.filter((s) => s.value !== "unassigned").map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <Input className="w-full sm:w-56" placeholder="Search DT name or ID" value={q} onChange={(e) => setQ(e.target.value)} />
            {isAdmin && feeder && (
              <Button variant={feeder.locked ? "default" : "outline"} size="sm" className="h-9" onClick={toggleLock}>
                {feeder.locked ? <><Lock /> Locked: unlock</> : <><Unlock /> Lock feeder</>}
              </Button>
            )}
          </div>
          {feeder?.locked && <p className="mt-2 rounded bg-warning/20 p-2 text-xs font-bold">🔒 Locked: captures on DTs not allocated to the enumerator are flagged under Capture Alerts.</p>}
          {feeder && <p className="mt-2 text-xs text-muted-foreground">Area: {feeder.area ?? "—"} · Type: {feeder.feeder_type ?? "—"} · Start date: {fmtDate(feeder.start_date)}</p>}
        </Section>

        {/* Phone view: one card per DT with big buttons */}
        <div className="space-y-2 md:hidden">
          {rows.map((d) => {
            const acts = activeAllocs(m, d.dt_id);
            const caps = m.subsByDt.get(d.dt_id) ?? 0;
            const last = (m.allocsByDt.get(d.dt_id) ?? []).slice(-1)[0];
            return (
              <div key={d.dt_id} className={"rounded-lg border bg-card p-3 shadow-sm " + (d.status === "unassigned" ? "border-l-4 border-l-destructive" : d.status === "assigned" ? "border-l-4 border-l-success" : "")}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className={"truncate font-extrabold " + (d.status === "unassigned" ? "text-destructive" : d.status === "assigned" ? "text-success" : "")}>{d.dt_name || "(no name)"}</div>
                    <div className="text-xs text-muted-foreground">{d.dt_id} · {d.dt_type}{isPrivateDt(d) ? " · private" : ""}</div>
                  </div>
                  <StatusBadge status={d.status} />
                </div>
                {d.status_note && <div className="mt-1 text-xs italic text-warning-foreground">{d.status_note}</div>}
                <div className="mt-2 space-y-1 text-sm">
                  {acts.length ? acts.map((a) => { return (
                    <div key={a.id}>{staffName({ enumId: a.enumerator_id, dtId: d.dt_id })}</div>
                  ); }) : <span className="text-muted-foreground">No one assigned</span>}
                </div>
                <div className="mt-1 flex justify-between text-xs text-muted-foreground">
                  <span>{last ? `From ${fmtDate(last.allocated_on)}${last.due_date ? ` · due ${fmtDate(last.due_date)}` : ""}` : ""}</span>
                  <span className={caps ? "font-bold text-foreground" : "font-bold text-destructive"}>{caps} captures</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 [&>*]:min-h-10 [&>*]:flex-1">{actions(d)}</div>
              </div>
            );
          })}
          {!rows.length && <p className="rounded-lg border bg-card p-6 text-center text-muted-foreground">No DTs match.</p>}
        </div>

        <div className="hidden overflow-x-auto rounded-lg border bg-card shadow-sm md:block">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-xs uppercase text-muted-foreground">
              <tr><th className="p-3">DT</th><th>Status</th><th>Enumerators</th><th>Allocated</th><th>Captures</th><th className="text-right pr-3">Actions</th></tr>
            </thead>
            <tbody>
              {rows.map((d) => {
                const acts = activeAllocs(m, d.dt_id);
                const last = (m.allocsByDt.get(d.dt_id) ?? []).slice(-1)[0];
                const caps = m.subsByDt.get(d.dt_id) ?? 0;
                const names = acts.map((a) => m.enumById.get(a.enumerator_id)).filter(Boolean);
                return (
                  <tr key={d.dt_id} className={"border-t " + (d.status === "unassigned" ? "bg-destructive/5" : d.status === "assigned" ? "bg-success/5" : "")}>
                    <td className="p-3">
                      <div className={"font-extrabold " + (d.status === "unassigned" ? "text-destructive" : d.status === "assigned" ? "text-success" : "")}>{d.dt_name || "(no name)"}</div>
                      <div className="text-xs text-muted-foreground">{d.dt_id} · {d.dt_type}</div>
                      {d.status_note && <div className="text-xs italic text-warning-foreground">{d.status_note}</div>}
                    </td>
                    <td><StatusBadge status={d.status} /></td>
                    <td className="text-xs">
                      {names.length ? names.map((e) => <div key={e!.id}>{staffName({ enumId: e!.id, dtId: d.dt_id })}</div>) : "—"}
                    </td>
                    <td className="text-xs">{last ? <>{fmtDate(last.allocated_on)}{last.due_date && <div className="text-muted-foreground">due {fmtDate(last.due_date)}</div>}{last.completed_on && <div className="text-muted-foreground">done {fmtDate(last.completed_on)}</div>}</> : "—"}</td>
                    <td className={"font-bold " + (caps ? "" : "text-destructive")}>{caps}</td>
                    <td className="pr-3"><div className="flex flex-wrap justify-end gap-1">{actions(d)}</div></td>
                  </tr>
                );
              })}
              {!rows.length && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No DTs match.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <aside className="order-first grid grid-cols-2 gap-3 self-start xl:order-none xl:sticky xl:top-4 xl:block xl:space-y-3 [&>*:first-child]:col-span-2">
        <div className="rounded-lg bg-sidebar p-4 text-sidebar-foreground">
          <div className="text-xs uppercase tracking-wider text-sidebar-foreground/70">{feeder?.feeder_name}</div>
          <div className="mt-2 grid grid-cols-2 gap-3 text-center">
            <div><div className="font-display text-5xl font-extrabold text-success">{stats.assigned}</div><div className="text-xs font-bold uppercase">Assigned</div></div>
            <div><div className="font-display text-5xl font-extrabold text-destructive">{stats.unassigned}</div><div className="text-xs font-bold uppercase">Not assigned</div></div>
          </div>
          <div className="mt-3 h-3 overflow-hidden rounded-full bg-sidebar-accent flex">
            <div className="bg-success" style={{ width: `${stats.total ? (stats.assigned / stats.total) * 100 : 0}%` }} />
            <div className="bg-chart-3 opacity-80" style={{ width: `${stats.total ? (stats.completed / stats.total) * 100 : 0}%`, background: "var(--accent)" }} />
          </div>
        </div>
        <Stat label="Total DTs" value={stats.total} />
        <Stat label="Completed" value={stats.completed} tone="accent" />
        <Stat label="Problematic" value={stats.problematic} tone="warning" />
        <Stat label="Access denied" value={stats.access_denied} tone="warning" />
        <Stat label="No capture yet" value={stats.noCapture} tone="danger" sub={`${stats.captures} captures on this feeder`} />
      </aside>

      {allocDt && <AllocateDialog m={m} dt={allocDt} openByEnum={openByEnum} onClose={() => setAllocDt(null)} />}
      {statusDt && <StatusDialog dt={statusDt} onClose={() => setStatusDt(null)} />}
      {dialog}
    </div>
  );
}

function AllocateDialog({ m, dt, openByEnum, onClose }: { m: Model; dt: DT; openByEnum: Map<string, DT[]>; onClose: () => void }) {
  const busyOn = (id: string) => (openByEnum.get(id) ?? []).filter((x) => x.dt_id !== dt.dt_id);
  const refresh = useRefresh();
  const [picked, setPicked] = useState<string[]>(activeAllocs(m, dt.dt_id).map((a) => a.enumerator_id));
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [due, setDue] = useState("");
  const [notes, setNotes] = useState("");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const list = m.enumerators.filter((e) => e.active !== false && (!q || `${e.full_name} ${e.username} ${e.supervisor}`.toLowerCase().includes(q.toLowerCase())));

  async function save() {
    if (!picked.length) return toast.error("Pick at least one enumerator");
    // One open DT per person at a time. Private DTs are the exception, after confirming.
    const already = new Set(activeAllocs(m, dt.dt_id).map((a) => a.enumerator_id));
    const clash = picked.filter((id) => !already.has(id) && busyOn(id).length > 0);
    if (clash.length) {
      const lines = clash.map((id) => { const e = m.enumById.get(id); return `• ${e?.full_name || e?.username}: ${busyOn(id).map((x) => x.dt_name || x.dt_id).join(", ")}`; }).join("\n");
      if (!isPrivateDt(dt)) {
        return toast.error("Already on a DT that isn't completed", { description: `${lines.replace(/\n/g, "; ")}. Mark that DT completed first. Only private DTs can be given on top of another.` });
      }
      if (!window.confirm(`This is a PRIVATE DT.\n\nThese staff are still on a DT that isn't completed:\n${lines}\n\nAllocate more than 1 DT to them at the same time?`)) return;
    }
    setBusy(true);
    const uid = auth().currentUser?.uid ?? null;
    try {
    for (const a of activeAllocs(m, dt.dt_id)) {
      if (!picked.includes(a.enumerator_id)) await updateRow("allocations", a.id, { status: "cancelled" });
    }
    const existing = new Set(activeAllocs(m, dt.dt_id).map((a) => a.enumerator_id));
    const rows = picked.filter((id) => !existing.has(id)).map((id) => ({ dt_id: dt.dt_id, enumerator_id: id, allocated_on: date, due_date: due || null, notes: notes || null, allocated_by: uid, status: "active", completed_on: null }));
    for (const r of rows) await addRow("allocations", r);
    await updateRow("dts", dt.id, { status: "assigned", status_note: null, updated_at: new Date().toISOString() });
    } catch (e: any) { setBusy(false); return toast.error(e.message); }
    toast.success(`${dt.dt_name} assigned to ${picked.length} enumerator(s)`);
    setBusy(false);
    refresh();
    onClose();
  }

  const feeder = m.feederById.get(dt.feeder_id);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        <DialogHeader><DialogTitle>Allocate {dt.dt_name}{isPrivateDt(dt) ? " (private)" : ""}</DialogTitle></DialogHeader>
        {!isPrivateDt(dt) && <p className="text-xs text-muted-foreground">Staff marked "On …" still have a DT that isn&apos;t completed. Only private DTs can be given to them on top.</p>}
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label>Allocation date<Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
            <label>Due date (optional)<Input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label>
          </div>
          <Input placeholder="Search enumerators" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="max-h-60 overflow-y-auto rounded border">
            {list.map((e) => (
              <label key={e.id} className="flex cursor-pointer items-center gap-2 border-b px-3 py-2 last:border-0 hover:bg-muted">
                <input type="checkbox" checked={picked.includes(e.id)} onChange={(ev) => setPicked(ev.target.checked ? [...picked, e.id] : picked.filter((x) => x !== e.id))} />
                <span className="font-semibold">{e.full_name || e.username}</span>
                <span className="text-xs text-muted-foreground">@{e.username}{e.supervisor ? ` · ${e.supervisor}` : ""}</span>
                {busyOn(e.id).length > 0 && <span className="ml-auto rounded bg-warning/20 px-1.5 py-0.5 text-[11px] font-bold">On {busyOn(e.id).map((x) => x.dt_name || x.dt_id).join(", ")}</span>}
              </label>
            ))}
            {!list.length && <p className="p-3 text-muted-foreground">No enumerators. Admin must upload the staff list.</p>}
          </div>
          <Input placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
          {picked.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {picked.map((id) => {
                const e = m.enumById.get(id);
                if (!e?.phone) return null;
                return (
                  <a key={id} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs"
                    href={waLink(e.phone, `Hello ${e.full_name || e.username}, you have been allocated DT ${dt.dt_name} (${dt.dt_id}) on feeder ${feeder?.feeder_name} from ${date}${due ? `, due ${due}` : ""}. Capture ONLY this DT.`)}>
                    <MessageCircle className="h-3 w-3" /> Notify {e.full_name || e.username}
                  </a>
                );
              })}
            </div>
          )}
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={busy}>Save allocation</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatusDialog({ dt, onClose }: { dt: DT; onClose: () => void }) {
  const refresh = useRefresh();
  const [status, setStatus] = useState(dt.status);
  const [note, setNote] = useState(dt.status_note ?? "");
  async function save() {
    try { await updateRow("dts", dt.id, { status, status_note: note || null, updated_at: new Date().toISOString() }); }
    catch (e: any) { return toast.error(e.message); }
    toast.success("Status updated");
    refresh();
    onClose();
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Status: {dt.dt_name}</DialogTitle></DialogHeader>
        <select className={selectCls + " w-full"} value={status} onChange={(e) => setStatus(e.target.value)}>
          {DT_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <Input placeholder="Reason / details (e.g. gate locked, owner refused)" value={note} onChange={(e) => setNote(e.target.value)} />
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save}>Update</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
