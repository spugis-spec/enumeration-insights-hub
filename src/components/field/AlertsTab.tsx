import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ClipboardCopy, MessageCircle, SearchCheck, Trash2 } from "lucide-react";
import { fmtDate, useOptimistic, useRefresh, waLink, type CaptureIssue, type Model } from "@/lib/field/data";
import { removeMany } from "@/lib/field/db";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Section, Stat } from "./common";

export function AlertsTab({ m }: { m: Model }) {
  const [q, setQ] = useState("");
  const list = m.alerts.filter((a) => !q || `${a.username} ${a.dt_id} ${a.dt?.dt_name} ${a.reason}`.toLowerCase().includes(q.toLowerCase()));
  const total = m.submissions.reduce((n, s) => n + s.count, 0);
  const withDt = m.submissions.filter((s) => s.dt_id).reduce((n, s) => n + s.count, 0);
  const noDt = total - withDt;
  const offenders = new Set(m.alerts.map((a) => a.username.toLowerCase())).size;

  const [showCheck, setShowCheck] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setShowCheck((v) => !v)} variant={showCheck ? "outline" : "default"}>
          <SearchCheck /> {showCheck ? "Hide capture check" : "Check capture alerts"}
        </Button>
        <span className="text-sm text-muted-foreground">{m.capture_issues.length.toLocaleString()} capture(s) with problems waiting for correction</span>
      </div>
      {showCheck && <CaptureCheck m={m} />}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Warnings" value={m.alerts.length} tone="danger" />
        <Stat label="Wrong captures" value={m.alerts.reduce((s, a) => s + a.count, 0)} tone="danger" />
        <Stat label="Staff involved" value={offenders} tone="warning" />
        <Stat label="Captures without DT" value={noDt} sub="no DT ID in the uploaded file" />
      </div>
      <Section title="Unauthorized / suspicious captures" actions={<Input className="w-64" placeholder="Filter" value={q} onChange={(e) => setQ(e.target.value)} />}>
        <p className="mb-3 text-sm text-muted-foreground">
          A capture is flagged when it is on a DT that isn't in the lookup, belongs to a different feeder than the one captured, or the enumerator isn't on the staff list. On LOCKED feeders (lock one in DT Allocation) it is also flagged when the DT wasn't allocated to that enumerator.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground">
              <tr><th className="p-2">Enumerator</th><th>DT</th><th>Problem</th><th>Captures</th><th>Last capture</th><th></th></tr>
            </thead>
            <tbody>
              {list.map((a) => (
                <tr key={a.key} className="border-t bg-destructive/5">
                  <td className="p-2 font-bold">{a.enumerator?.full_name || a.username}<div className="text-xs font-normal text-muted-foreground">@{a.username}</div></td>
                  <td>{a.dt?.dt_name ?? "?"}<div className="text-xs text-muted-foreground">{a.dt_id}</div></td>
                  <td className="font-semibold text-destructive">{a.reason}</td>
                  <td className="font-bold">{a.count}</td>
                  <td>{fmtDate(a.last)}</td>
                  <td>
                    {a.enumerator?.phone && (
                      <a target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded border border-destructive px-2 py-1 text-xs font-bold text-destructive"
                        href={waLink(a.enumerator.phone, `WARNING: ${a.enumerator.full_name || a.username}, ${a.count} capture(s) were recorded on DT ${a.dt?.dt_name ?? a.dt_id} (${a.dt_id}), which is not allocated to you (${a.reason}). Please stop and confirm your allocated DT with your supervisor.`)}>
                        <MessageCircle className="h-3 w-3" /> Warn
                      </a>
                    )}
                  </td>
                </tr>
              ))}
              {!list.length && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No warnings. All captures match their allocations.</td></tr>}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

function issueLine(i: CaptureIssue, n: number) {
  const parts = [
    i.call_back_form_no && `Call-back form: ${i.call_back_form_no}`,
    i.customer_no && `Customer no: ${i.customer_no}`,
    i.building_code && `Building code: ${i.building_code}`,
  ].filter(Boolean);
  return `${n}. DT ${i.dt_id ?? "(none)"}${i.captured_at ? ` on ${fmtDate(i.captured_at)}` : ""} — ${i.reason}${parts.length ? `\n   ${parts.join(" · ")}` : ""}`;
}

/** Problem captures grouped by enumerator, each with a ready-to-send correction message. */
function CaptureCheck({ m }: { m: Model }) {
  const refresh = useRefresh();
  const optimistic = useOptimistic();
  const [q, setQ] = useState("");
  const groups = useMemo(() => {
    const g = new Map<string, CaptureIssue[]>();
    for (const i of m.capture_issues) {
      const k = (i.username ?? "unknown").toLowerCase();
      g.set(k, [...(g.get(k) ?? []), i]);
    }
    return [...g.entries()]
      .map(([user, items]) => ({ user, items: items.sort((a, b) => (a.captured_at ?? "").localeCompare(b.captured_at ?? "")), en: m.enumByUser.get(user) }))
      .filter((x) => !q || `${x.user} ${x.en?.full_name ?? ""} ${x.items.map((i) => `${i.dt_id} ${i.customer_no} ${i.building_code} ${i.call_back_form_no}`).join(" ")}`.toLowerCase().includes(q.toLowerCase()))
      .sort((a, b) => b.items.length - a.items.length);
  }, [m, q]);

  const message = (name: string, items: CaptureIssue[], max = 40) =>
    `Hello ${name}, the following ${items.length} submission(s) need correction. Please go back to each one and fix it:\n\n${items.slice(0, max).map((i, n) => issueLine(i, n + 1)).join("\n")}${items.length > max ? `\n…and ${items.length - max} more. Contact your supervisor for the full list.` : ""}\n\nCapture ONLY the DT allocated to you.`;

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
      <p className="mb-3 text-sm text-muted-foreground">Built from the uploaded enumeration file. Only captures with a problem are kept, with the call-back form no, customer no and building code when the file had them.</p>
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
                  <Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(message(name, items, 100000)).then(() => toast.success("Message copied"))}><ClipboardCopy /> Copy</Button>
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => clear(items)}><Trash2 /> Fixed</Button>
                </div>
              </div>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-left uppercase text-muted-foreground"><tr><th className="p-1">DT</th><th>Problem</th><th>Call-back form</th><th>Customer no</th><th>Building code</th><th>Date</th></tr></thead>
                  <tbody>
                    {items.slice(0, 50).map((i) => (
                      <tr key={i.id} className="border-t"><td className="p-1">{i.dt_id ?? "—"}</td><td className="text-destructive">{i.reason}</td><td>{i.call_back_form_no ?? "—"}</td><td>{i.customer_no ?? "—"}</td><td>{i.building_code ?? "—"}</td><td>{fmtDate(i.captured_at)}</td></tr>
                    ))}
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
