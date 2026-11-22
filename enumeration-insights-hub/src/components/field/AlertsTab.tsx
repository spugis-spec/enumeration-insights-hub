import { Fragment, useMemo, useState } from "react";
import { toast } from "sonner";
import { ClipboardCopy, MessageCircle, SearchCheck, Trash2, Undo2 } from "lucide-react";
import {
  activeAllocs, fmtDate, openDtsByEnumerator, STAFF_REASON, STAFF_RESPONSES, useOptimistic, useRefresh, waLink, WRONG_RESPONSES,
  type Alert, type CaptureIssue, type Model, type ResolvedAlert,
} from "@/lib/field/data";
import { removeMany, safeId, upsertMany } from "@/lib/field/db";
import { auth } from "@/lib/field/firebase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Section, selectCls, Stat } from "./common";

type View = "wrong" | "staff" | "resolved";
type Item = { key: string; username: string; reason: string };

const norm = (s: string) => s.trim().toLowerCase();

export function AlertsTab({ m, goTo }: { m: Model; goTo?: (tab: string) => void }) {
  const refresh = useRefresh();
  const [q, setQ] = useState("");
  const wrong = useMemo(() => m.alerts.filter((a) => a.reason !== STAFF_REASON), [m.alerts]);
  const staffAlerts = useMemo(() => m.alerts.filter((a) => a.reason === STAFF_REASON), [m.alerts]);
  const [view, setView] = useState<View>(() => (wrong.length || !staffAlerts.length ? "wrong" : "staff"));
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState("");
  const [busy, setBusy] = useState(false);
  const [showCheck, setShowCheck] = useState(false);

  const total = m.customerSubmissions.reduce((n, s) => n + s.count, 0);
  const withDt = m.customerSubmissions.filter((s) => s.dt_id).reduce((n, s) => n + s.count, 0);
  const noDt = total - withDt;
  const wrongCaptures = wrong.reduce((n, a) => n + a.count, 0);
  const staffCaptures = staffAlerts.reduce((n, a) => n + a.count, 0);
  const involved = new Set(m.alerts.map((a) => norm(a.username))).size;
  const openBy = useMemo(() => openDtsByEnumerator(m), [m]);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const isFuture = (d: string | null) => !!d && d.slice(0, 10) > tomorrow;
  const match = (text: string) => !q || text.toLowerCase().includes(q.toLowerCase());

  // "Not on staff list" is answered per username, so those alerts are grouped by person.
  const staffUsers = useMemo(() => {
    const g = new Map<string, { key: string; username: string; alerts: Alert[]; count: number; last: string | null }>();
    for (const a of staffAlerts) {
      const k = norm(a.username);
      const cur = g.get(k) ?? { key: k, username: a.username, alerts: [], count: 0, last: null };
      cur.alerts.push(a);
      cur.count += a.count;
      if (a.last && (!cur.last || a.last > cur.last)) cur.last = a.last;
      g.set(k, cur);
    }
    return [...g.values()].sort((a, b) => b.count - a.count);
  }, [staffAlerts]);

  const wrongShown = wrong.filter((a) => match(`${a.username} ${a.enumerator?.full_name ?? ""} ${a.dt_id} ${a.dt?.dt_name ?? ""} ${a.reason}`));
  const staffShown = staffUsers.filter((u) => match(u.username));
  const resolvedShown = m.resolvedAlerts.filter((a) => match(`${a.username} ${a.dt_id} ${a.reason} ${a.response}`));

  const shownKeys = view === "wrong" ? wrongShown.map((a) => a.key) : view === "staff" ? staffShown.map((u) => u.key) : [];
  const toggle = (k: string) => setSel((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const switchView = (v: View) => { setView(v); setSel(new Set()); setBulk(""); };

  async function resolve(kind: "user" | "alert", items: Item[], response: string) {
    if (!items.length || !response) return;
    setBusy(true);
    const now = new Date().toISOString();
    const uid = auth().currentUser?.uid ?? null;
    try {
      await upsertMany(
        "alert_resolutions",
        items.map((i) => ({ id: safeId(`${kind}:${i.key}`), kind, key: i.key, username: i.username, reason: i.reason, response, resolved_at: now, resolved_by: uid })),
        (r) => r.id,
      );
    } catch (e: any) {
      setBusy(false);
      return toast.error(/permission/i.test(e?.message ?? "") ? "Not allowed yet: add the alert_resolutions block to the Firestore rules (see MERGE_GUIDE.md)." : (e?.message ?? "Couldn't save"));
    }
    setSel(new Set());
    setBulk("");
    toast.success(`${items.length} ${kind === "user" ? "username(s)" : "alert(s)"} marked "${response}". They are out of the count.`);
    await refresh();
    setBusy(false);
  }

  async function reopen(list: ResolvedAlert[]) {
    const ids = [...new Set(list.map((r) => r.resolution?.id).filter((x): x is string => !!x))];
    if (!ids.length) return;
    setBusy(true);
    try { await removeMany("alert_resolutions", ids); } catch (e: any) { setBusy(false); return toast.error(e?.message ?? "Couldn't reopen"); }
    toast.success(`${ids.length} answer(s) removed. The alerts are back.`);
    await refresh();
    setBusy(false);
  }

  async function removeFuture() {
    const n = m.futureIds.submissions.length + m.futureIds.issues.length;
    if (!window.confirm(`Remove ${n} row(s) dated in the future?\n\nThey are misread dates (day and month swapped). Upload the file again afterwards: dates are now read day-first.`)) return;
    setBusy(true);
    try {
      await removeMany("submissions", m.futureIds.submissions);
      await removeMany("capture_issues", m.futureIds.issues);
    } catch (e: any) { setBusy(false); return toast.error(e?.message ?? "Couldn't remove"); }
    toast.success(`${n} row(s) removed. Re-upload the captures file.`);
    await refresh();
    setBusy(false);
  }

  const responses = view === "staff" ? STAFF_RESPONSES : WRONG_RESPONSES;
  function applyBulk() {
    if (!bulk) return toast.error("Pick a response first");
    if (view === "staff") {
      const items = staffUsers.filter((u) => sel.has(u.key)).map((u) => ({ key: u.key, username: u.username, reason: STAFF_REASON }));
      void resolve("user", items, bulk);
    } else {
      const items = wrong.filter((a) => sel.has(a.key)).map((a) => ({ key: a.key, username: a.username, reason: a.reason }));
      void resolve("alert", items, bulk);
    }
  }

  const range = (a: { first: string | null; last: string | null }) => {
    const f = fmtDate(a.first), l = fmtDate(a.last);
    return <>{f === l ? l : `${f} – ${l}`}{(isFuture(a.first) || isFuture(a.last)) && <span className="ml-1 rounded bg-warning/30 px-1 text-[10px] font-bold">future date?</span>}</>;
  };
  const holders = (a: Alert) => activeAllocs(m, a.dt_id).map((x) => m.enumById.get(x.enumerator_id)).filter(Boolean).map((e) => e!.full_name || e!.username).join(", ");
  const theirs = (a: Alert) => (a.enumerator ? (openBy.get(a.enumerator.id) ?? []) : []);
  const futureCount = m.futureIds.submissions.length + m.futureIds.issues.length;

  const chip = (v: View, label: string, n: number) => (
    <button onClick={() => switchView(v)} className={"rounded-full border px-3 py-1 text-sm font-bold " + (view === v ? "bg-foreground text-background" : "hover:bg-muted")}>
      {label} <span className="opacity-70">({n})</span>
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setShowCheck((v) => !v)} variant={showCheck ? "outline" : "default"}>
          <SearchCheck /> {showCheck ? "Hide capture check" : "Check capture alerts"}
        </Button>
        <span className="text-sm text-muted-foreground">{m.capture_issues.length.toLocaleString()} capture(s) with problems waiting for correction</span>
        {goTo && <Button variant="outline" size="sm" onClick={() => goTo("uploads")}>Use the Dashboard's Customer Enumeration upload →</Button>}
      </div>
      {showCheck && <CaptureCheck m={m} />}

      {futureCount > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-warning bg-warning/15 p-3 text-sm">
          <span className="font-bold">⚠ {futureCount.toLocaleString()} row(s) have a date in the future.</span>
          <span className="text-muted-foreground">This happens when day and month are swapped in an upload (12/10 read as 10 Dec). Dates are now read day-first. Remove these rows, then upload the file again.</span>
          <Button size="sm" variant="outline" disabled={busy} onClick={removeFuture}><Trash2 /> Remove them</Button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <button className="text-left" onClick={() => switchView("wrong")}><Stat label="Wrong captures" value={wrongCaptures} tone="danger" sub={`${wrong.length} to review`} /></button>
        <button className="text-left" onClick={() => switchView("staff")}><Stat label="Not on staff list" value={staffUsers.length} tone="warning" sub={`usernames · ${staffCaptures} captures`} /></button>
        <Stat label="Staff involved" value={involved} tone="warning" />
        <Stat label="Supervisor captures" value={m.supervisorCaptures} sub="not flagged" />
        <Stat label="Captures without DT" value={noDt} sub="no DT ID in the uploaded file" />
      </div>

      <Section title="Unauthorized / suspicious captures" actions={<Input className="w-64" placeholder="Filter" value={q} onChange={(e) => setQ(e.target.value)} />}>
        <div className="mb-3 flex flex-wrap gap-2">
          {chip("wrong", "Wrong captures", wrong.length)}
          {chip("staff", "Not on staff list", staffUsers.length)}
          {chip("resolved", "Resolved", m.resolvedAlerts.length)}
        </div>

        {view !== "resolved" && (
          <>
            <p className="mb-3 text-sm text-muted-foreground">
              {view === "wrong"
                ? "Captures on a DT that isn't in the lookup, is on a different feeder, or (on LOCKED feeders) isn't allocated to that enumerator, or was captured after the DT was completed. Pick one or many, choose a response, and they leave the count."
                : "Usernames in the capture file that aren't on the staff list, for example people who left. Answer once per username and every capture from them clears. Supervisors whose name matches a supervisor on the staff list are not flagged."}
            </p>
            {sel.size > 0 && (
              <div className="sticky top-0 z-10 mb-3 flex flex-wrap items-center gap-2 rounded-md border bg-card p-2 shadow">
                <span className="text-sm font-bold">{sel.size} selected</span>
                <select className={selectCls} value={bulk} onChange={(e) => setBulk(e.target.value)}>
                  <option value="">Resolve as…</option>
                  {responses.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                <Button size="sm" onClick={applyBulk} disabled={busy || !bulk}>{busy ? "Saving…" : "Apply"}</Button>
                <Button size="sm" variant="ghost" onClick={() => setSel(new Set())}>Clear</Button>
              </div>
            )}
            <div className="overflow-x-auto">
              {view === "wrong" ? (
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="p-2"><input type="checkbox" aria-label="Select all" checked={!!shownKeys.length && shownKeys.every((k) => sel.has(k))} onChange={(e) => setSel(e.target.checked ? new Set(shownKeys) : new Set())} /></th>
                      <th>Staff</th><th>Assigned to them</th><th>Captured DT</th><th>Problem</th><th>Captures</th><th>Dates</th><th>Resolve</th>
                    </tr>
                  </thead>
                  <tbody>
                    {wrongShown.map((a) => {
                      const mine = theirs(a);
                      return (
                        <tr key={a.key} className="border-t bg-destructive/5 align-top">
                          <td className="p-2"><input type="checkbox" checked={sel.has(a.key)} onChange={() => toggle(a.key)} /></td>
                          <td className="p-2 font-bold">{a.enumerator?.full_name || a.username}<div className="text-xs font-normal text-muted-foreground">@{a.username}{a.enumerator?.supervisor ? ` · ${a.enumerator.supervisor}` : ""}</div></td>
                          <td className="text-xs">{mine.length ? mine.slice(0, 3).map((d) => <div key={d.dt_id}>{d.dt_name || d.dt_id} <span className="text-muted-foreground">· {m.feederById.get(d.feeder_id)?.feeder_name ?? d.feeder_id}</span></div>) : <span className="text-muted-foreground">no open DT</span>}</td>
                          <td>{a.dt?.dt_name ?? "?"}<div className="text-xs text-muted-foreground">{a.dt_id}{a.dt ? ` · ${m.feederById.get(a.dt.feeder_id)?.feeder_name ?? a.dt.feeder_id}` : ""}</div></td>
                          <td className="font-semibold text-destructive">{a.reason}{holders(a) && <div className="text-xs font-normal text-muted-foreground">DT holder: {holders(a)}</div>}</td>
                          <td className="font-bold">{a.count}</td>
                          <td className="text-xs">{range(a)}</td>
                          <td>
                            <div className="flex flex-wrap items-center gap-1">
                              <select className={selectCls} value="" disabled={busy} onChange={(e) => void resolve("alert", [{ key: a.key, username: a.username, reason: a.reason }], e.target.value)}>
                                <option value="">Resolve as…</option>
                                {WRONG_RESPONSES.map((r) => <option key={r} value={r}>{r}</option>)}
                              </select>
                              {a.enumerator?.phone && (
                                <a target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded border border-destructive px-2 py-1 text-xs font-bold text-destructive"
                                  href={waLink(a.enumerator.phone, `WARNING: ${a.enumerator.full_name || a.username}, ${a.count} capture(s) were recorded on DT ${a.dt?.dt_name ?? a.dt_id} (${a.dt_id}), which is not allocated to you (${a.reason}). Please stop and confirm your allocated DT with your supervisor.`)}>
                                  <MessageCircle className="h-3 w-3" /> Warn
                                </a>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {!wrongShown.length && <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">No wrong captures to review.</td></tr>}
                  </tbody>
                </table>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="p-2"><input type="checkbox" aria-label="Select all" checked={!!shownKeys.length && shownKeys.every((k) => sel.has(k))} onChange={(e) => setSel(e.target.checked ? new Set(shownKeys) : new Set())} /></th>
                      <th>Username</th><th>Captures</th><th>DTs</th><th>Last capture</th><th>Resolve</th>
                    </tr>
                  </thead>
                  <tbody>
                    {staffShown.map((u) => (
                      <tr key={u.key} className="border-t bg-warning/10 align-top">
                        <td className="p-2"><input type="checkbox" checked={sel.has(u.key)} onChange={() => toggle(u.key)} /></td>
                        <td className="p-2 font-bold">@{u.username}</td>
                        <td className="font-bold">{u.count}</td>
                        <td className="text-xs">{new Set(u.alerts.map((a) => a.dt_id)).size}</td>
                        <td className="text-xs">{range({ first: null, last: u.last })}</td>
                        <td>
                          <select className={selectCls} value="" disabled={busy} onChange={(e) => void resolve("user", [{ key: u.key, username: u.username, reason: STAFF_REASON }], e.target.value)}>
                            <option value="">Resolve as…</option>
                            {STAFF_RESPONSES.map((r) => <option key={r} value={r}>{r}</option>)}
                          </select>
                        </td>
                      </tr>
                    ))}
                    {!staffShown.length && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">Everyone in the capture file is on the staff list.</td></tr>}
                  </tbody>
                </table>
              )}
            </div>
            {view === "wrong" && <p className="mt-2 text-xs text-muted-foreground">Corrected = fixed in the capture app · Approved = allowed · Reallocated = DT now assigned to them · Mistake = entered in error · Warned = staff told.</p>}
          </>
        )}

        {view === "resolved" && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground"><tr><th className="p-2">Staff</th><th>DT</th><th>Problem</th><th>Captures</th><th>Answer</th><th>When</th><th></th></tr></thead>
              <tbody>
                {resolvedShown.map((a) => (
                  <tr key={a.key} className="border-t">
                    <td className="p-2 font-bold">{a.enumerator?.full_name || a.username}<div className="text-xs font-normal text-muted-foreground">@{a.username}</div></td>
                    <td className="text-xs">{a.dt?.dt_name ?? "?"}<div className="text-muted-foreground">{a.dt_id}</div></td>
                    <td className="text-xs">{a.reason}</td>
                    <td>{a.count}</td>
                    <td className="font-semibold">{a.response}{a.auto && <div className="text-xs font-normal text-muted-foreground">matched a supervisor name</div>}</td>
                    <td className="text-xs">{a.resolution ? fmtDate(a.resolution.resolved_at) : "—"}</td>
                    <td>{a.resolution && <Button size="sm" variant="ghost" disabled={busy} onClick={() => reopen([a])}><Undo2 /> Reopen</Button>}</td>
                  </tr>
                ))}
                {!resolvedShown.length && <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">Nothing resolved yet.</td></tr>}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-muted-foreground">Reopening a "not on staff list" answer brings back every alert for that username.</p>
          </div>
        )}
      </Section>
    </div>
  );
}

function issueLine(i: CaptureIssue, n: number, dtLabel: (id: string | null) => string) {
  const parts = [
    i.fid && `FID: ${i.fid}`,
    i.feeder_id && `Feeder: ${i.feeder_id}`,
    i.structure_no && `Structure no: ${i.structure_no}`,
    i.call_back_form_no && `Call-back form: ${i.call_back_form_no}`,
    i.customer_no && `Customer no: ${i.customer_no}`,
    i.building_code && `Building code: ${i.building_code}`,
  ].filter(Boolean);
  const correct = i.correct_dt ? `\n   Should be working on: ${i.correct_dt.split(", ").map((d) => dtLabel(d)).join(", ")}` : "";
  return `${n}. ${i.source === "lt" ? "[LT Pole] " : ""}Wrong DT: ${dtLabel(i.dt_id)}${i.captured_at ? ` on ${fmtDate(i.captured_at)}` : ""} — ${i.reason}${parts.length ? `\n   ${parts.join(" · ")}` : ""}${correct}`;
}

/** Problem captures grouped by enumerator, each with a ready-to-send correction message. */
function CaptureCheck({ m }: { m: Model }) {
  const refresh = useRefresh();
  const optimistic = useOptimistic();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggleOpen = (ids: string[], on?: boolean) => setOpen((p) => { const n = new Set(p); for (const id of ids) { if (on ?? !n.has(id)) n.add(id); else n.delete(id); } return n; });
  /** Full DT name with its code, never the bare code. */
  const dtName = (id: string | null) => (id ? m.dtById.get(id)?.dt_name || id : "(none)");
  const dtLabel = (id: string | null) => (id ? (m.dtById.get(id)?.dt_name ? `${m.dtById.get(id)!.dt_name} (${id})` : id) : "(none)");
  const groups = useMemo(() => {
    const g = new Map<string, CaptureIssue[]>();
    for (const i of m.capture_issues) {
      const k = (i.username ?? "unknown").toLowerCase();
      g.set(k, [...(g.get(k) ?? []), i]);
    }
    return [...g.entries()]
      .map(([user, items]) => ({ user, items: items.sort((a, b) => (a.captured_at ?? "").localeCompare(b.captured_at ?? "")), en: m.enumByUser.get(user) }))
      .filter((x) => !q || `${x.user} ${x.en?.full_name ?? ""} ${x.items.map((i) => `${i.dt_id} ${i.fid} ${i.structure_no} ${i.customer_no} ${i.building_code} ${i.call_back_form_no}`).join(" ")}`.toLowerCase().includes(q.toLowerCase()))
      .sort((a, b) => b.items.length - a.items.length);
  }, [m, q]);

  const message = (name: string, items: CaptureIssue[], max = 40) =>
    `Hello ${name}, the following ${items.length} submission(s) need correction. Please go back to each one and fix it:\n\n${items.slice(0, max).map((i, n) => issueLine(i, n + 1, dtLabel)).join("\n")}${items.length > max ? `\n…and ${items.length - max} more. Contact your supervisor for the full list.` : ""}\n\nCapture ONLY the DT allocated to you.`;

  async function clear(items: CaptureIssue[]) {
    if (!window.confirm(`Remove these ${items.length} capture(s) from the list? Do this once they have been corrected.`)) return;
    const ids = new Set(items.map((i) => i.id));
    optimistic((mm) => ({ ...mm, capture_issues: mm.capture_issues.filter((i) => !ids.has(i.id)) }));
    try { await removeMany("capture_issues", [...ids]); } catch (e: any) { refresh(); return toast.error(e.message); }
    toast.success(`${ids.size} capture(s) cleared`);
    refresh();
  }

  return (
    <Section title="Capture check: submissions to correct" actions={<Input className="w-full sm:w-64" placeholder="Search staff, DT, customer no…" value={q} onChange={(e) => setQ(e.target.value)} />}>
      <p className="mb-3 text-sm text-muted-foreground">Built from the uploaded Customer Enumeration and LT Pole files. Only captures with a problem are kept. Press Details on a row for the FID, building code, customer no., structure no. (LT), and the wrong and correct DT. Flags clear themselves once the DT is allocated or authorized.</p>
      <div className="space-y-3">
        {groups.map(({ user, items, en }) => {
          const name = en?.full_name || user;
          const msg = message(name, items);
          return (
            <div key={user} className="rounded-lg border bg-destructive/5 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div><span className="font-bold">{name}</span> <span className="text-xs text-muted-foreground">@{user}</span> · <span className="font-bold text-destructive">{items.length} to fix</span></div>
                <div className="flex flex-wrap gap-1">
                  {en?.phone && (
                    <a target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1 rounded-md border border-destructive px-2 text-xs font-bold text-destructive" href={waLink(en.phone, msg)}>
                      <MessageCircle className="h-3 w-3" /> Send on WhatsApp
                    </a>
                  )}
                  <Button size="sm" variant="outline" onClick={() => toggleOpen(items.slice(0, 50).map((i) => i.id), !items.slice(0, 50).every((i) => open.has(i.id)))}>{items.slice(0, 50).every((i) => open.has(i.id)) ? "Hide all details" : "Show all details"}</Button>
                  <Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(message(name, items, 100000)).then(() => toast.success("Message copied"))}><ClipboardCopy /> Copy</Button>
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => clear(items)}><Trash2 /> Fixed</Button>
                </div>
              </div>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-left uppercase text-muted-foreground"><tr><th className="p-1">DT</th><th>Problem</th><th>Date</th><th></th></tr></thead>
                  <tbody>
                    {items.slice(0, 50).map((i) => {
                      const isOpen = open.has(i.id);
                      return (
                        <Fragment key={i.id}>
                          <tr className="border-t align-top">
                            <td className="p-1 font-semibold">{dtName(i.dt_id)}{i.source === "lt" && <span className="ml-1 rounded bg-muted px-1 text-[10px] font-bold">LT</span>}</td>
                            <td className="text-destructive">{i.reason}</td>
                            <td>{fmtDate(i.captured_at)}</td>
                            <td className="text-right"><Button size="sm" variant="ghost" className="h-6 px-2 text-xs" aria-expanded={isOpen} onClick={() => toggleOpen([i.id])}>{isOpen ? "Hide details" : "Details"}</Button></td>
                          </tr>
                          {isOpen && (
                            <tr className="bg-muted/50">
                              <td colSpan={4} className="p-2">
                                <dl className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
                                  <div><dt className="text-[10px] uppercase text-muted-foreground">Wrong DT</dt><dd className="font-semibold text-destructive">{dtLabel(i.dt_id)}</dd></div>
                                  <div><dt className="text-[10px] uppercase text-muted-foreground">Correct DT (should be on)</dt><dd className="font-semibold text-success">{i.correct_dt ? i.correct_dt.split(", ").map(dtLabel).join(", ") : "—"}</dd></div>
                                  <div><dt className="text-[10px] uppercase text-muted-foreground">Feeder</dt><dd>{i.feeder_id ?? "—"}</dd></div>
                                  <div><dt className="text-[10px] uppercase text-muted-foreground">FID</dt><dd>{i.fid ?? "—"}</dd></div>
                                  <div><dt className="text-[10px] uppercase text-muted-foreground">Structure no (LT)</dt><dd>{i.structure_no ?? "—"}</dd></div>
                                  <div><dt className="text-[10px] uppercase text-muted-foreground">Building code</dt><dd>{i.building_code ?? "—"}</dd></div>
                                  <div><dt className="text-[10px] uppercase text-muted-foreground">Customer no</dt><dd>{i.customer_no ?? "—"}</dd></div>
                                  <div><dt className="text-[10px] uppercase text-muted-foreground">Call-back form</dt><dd>{i.call_back_form_no ?? "—"}</dd></div>
                                </dl>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
                {items.length > 50 && <p className="p-1 text-xs text-muted-foreground">…and {items.length - 50} more (all included in Copy).</p>}
              </div>
            </div>
          );
        })}
        {!groups.length && <p className="p-4 text-center text-muted-foreground">No captures need correction.</p>}
      </div>
    </Section>
  );
}
