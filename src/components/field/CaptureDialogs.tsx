import { useState } from "react";
import { Download } from "lucide-react";
import type { Analysis, CaptureInput, ReportKind, scanFeeders } from "@/lib/field/captureEngine";
import type { Model } from "@/lib/field/data";
import { downloadSheet } from "@/lib/field/dataTools";
import type { CheckChoice } from "@/lib/field/captureRun";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/* ---------- Which feeders and dates to check ---------- */
export function CaptureScopeDialog({
  req, m, hasData, legacyCount, onCancel, onRun, initialRange, allowRestore = true,
}: {
  req: { inputs: CaptureInput[]; scan: ReturnType<typeof scanFeeders> };
  m: Model; hasData: boolean; legacyCount: number; onCancel: () => void;
  onRun: (c: CheckChoice) => void;
  /** Dates to start with, e.g. the date a Dashboard report was generated for. */
  initialRange?: { from: string | null; to: string | null } | undefined;
  allowRestore?: boolean;
}) {
  const { scan } = req;
  const inLookup = scan.feeders.filter((f) => f.inLookup);
  const notIn = scan.feeders.filter((f) => !f.inLookup);
  const locked = inLookup.filter((f) => m.feederById.get(f.feeder_id)?.locked).map((f) => f.feeder_id);
  const [sel, setSel] = useState<Set<string>>(new Set(locked.length ? locked : inLookup.map((f) => f.feeder_id)));
  const [mode, setMode] = useState<"all" | "range">(initialRange?.from ? "range" : "all");
  const [from, setFrom] = useState(initialRange?.from ?? scan.dayMin ?? "");
  const [to, setTo] = useState(initialRange?.to ?? initialRange?.from ?? scan.dayMax ?? "");
  const [lock, setLock] = useState(false);
  const [restore, setRestore] = useState(hasData && allowRestore);
  const toggle = (id: string) => setSel((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const bad = mode === "range" && (!from || !to || from > to);
  const labels = req.inputs.map((i) => `${i.source === "lt" ? "LT Pole" : "Customer Enumeration"}: ${i.rows.length.toLocaleString()} rows`).join(" · ");

  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Which feeders and dates should I check?</DialogTitle>
          <DialogDescription>{labels}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <section>
            <div className="mb-1 flex items-center justify-between">
              <b>Feeders in your lookup that are in this data</b>
              <span className="space-x-2 text-xs">
                <button type="button" className="underline" onClick={() => setSel(new Set(inLookup.map((f) => f.feeder_id)))}>all</button>
                <button type="button" className="underline" onClick={() => setSel(new Set())}>none</button>
              </span>
            </div>
            {!inLookup.length && <p className="rounded border border-destructive p-2 text-destructive">None of the feeders in this data are in your feeder lookup, so there is nothing to check. Upload the lookup first.</p>}
            <div className="max-h-48 divide-y overflow-y-auto rounded border">
              {inLookup.map((f) => (
                <label key={f.feeder_id} className="flex cursor-pointer items-center gap-2 px-3 py-2 hover:bg-muted">
                  <input type="checkbox" checked={sel.has(f.feeder_id)} onChange={() => toggle(f.feeder_id)} />
                  <span className="flex-1">{m.feederById.get(f.feeder_id)?.feeder_name ?? f.feeder_id} <span className="text-xs text-muted-foreground">({f.feeder_id})</span></span>
                  {m.feederById.get(f.feeder_id)?.locked && <span className="rounded bg-warning/20 px-1 text-[10px] font-bold">LOCKED</span>}
                  <span className="text-xs text-muted-foreground">{f.rows.toLocaleString()} rows</span>
                </label>
              ))}
            </div>
            {notIn.length > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                Not in your lookup, so left out: {notIn.slice(0, 8).map((f) => `${f.feeder_id} (${f.rows.toLocaleString()})`).join(", ")}{notIn.length > 8 ? `, +${notIn.length - 8} more` : ""}. The one exception: a person working on the chosen feeders who captured on one of these is flagged as picking the wrong feeder.
              </p>
            )}
          </section>
          <section>
            <b>Dates</b>
            <div className="mt-1 space-y-1">
              <label className="flex items-center gap-2"><input type="radio" checked={mode === "all"} onChange={() => setMode("all")} /> Every date in the data{scan.dayMin ? ` (${scan.dayMin} to ${scan.dayMax})` : ""}</label>
              <label className="flex items-center gap-2"><input type="radio" checked={mode === "range"} onChange={() => setMode("range")} /> Only these dates</label>
              {mode === "range" && (
                <div className="ml-6 flex flex-wrap items-center gap-2">
                  <input type="date" className="rounded border px-2 py-1" value={from} onChange={(e) => setFrom(e.target.value)} />
                  <span>to</span>
                  <input type="date" className="rounded border px-2 py-1" value={to} onChange={(e) => setTo(e.target.value)} />
                </div>
              )}
            </div>
          </section>
          <section className="space-y-1">
            <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={lock} onChange={(e) => setLock(e.target.checked)} /><span>Also <b>lock</b> the chosen feeders, so later captures on unallocated DTs keep being flagged in Capture Alerts</span></label>
            {hasData && allowRestore && <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={restore} onChange={(e) => setRestore(e.target.checked)} /><span>Keep a restore point first (lets you undo this upload, uses extra space)</span></label>}
            {legacyCount > 0 && <p className="text-xs text-muted-foreground">{legacyCount.toLocaleString()} old per-capture records will be replaced so nothing is counted twice.</p>}
          </section>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button disabled={!sel.size || bad} onClick={() => onRun({ feeders: [...sel], from: mode === "range" ? from : null, to: mode === "range" ? to : null, lock, restore })}>
            Check {sel.size} feeder{sel.size === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- What the check found ---------- */
const REPORT_GROUPS: { kinds: ReportKind[]; title: string; hint: string }[] = [
  { kinds: ["self_assigned"], title: "Self-assigned DTs: captured, but not assigned on the app", hint: "Each was assigned to whoever captured it and now waits for you to authorize it in DT Allocation." },
  { kinds: ["left_ongoing"], title: "Has an ongoing DT, but captured on a different one", hint: "Their own DT is not marked complete yet. The different DT was self-assigned to them and waits for authorization." },
  { kinds: ["other_holder"], title: "Captured on a DT assigned to someone else", hint: "Includes team partners who picked a DT that is not assigned to them." },
  { kinds: ["wrong_feeder"], title: "Captured on a feeder that is not in the lookup", hint: "By people who work on the chosen feeders." },
  { kinds: ["not_on_staff"], title: "Usernames not on the staff list", hint: "Resolve them in Capture Alerts. Their username stays on the DT either way." },
  { kinds: ["after_completed", "not_allocated", "dt_not_in_lookup", "feeder_mismatch"], title: "Other problems", hint: "" },
];
const KIND_LABEL: Record<ReportKind, string> = {
  left_ongoing: "Left ongoing DT", self_assigned: "Self-assigned", other_holder: "Someone else's DT", not_on_staff: "Not on staff list", wrong_feeder: "Wrong feeder",
  dt_not_in_lookup: "DT not in lookup", feeder_mismatch: "Feeder mismatch", after_completed: "After completed", not_allocated: "Not allocated",
};

export function CaptureReportDialog({ rep, onClose, goTo }: { rep: { a: Analysis; label: string; feeders: string[]; from: string | null; to: string | null }; onClose: () => void; goTo: ((t: string) => void) | undefined }) {
  const { a } = rep;
  const s = a.stats;
  const exportFlagged = () =>
    downloadSheet(
      "flagged_captures",
      a.issues.map((i) => ({
        FID: i.fid ?? "", "DT ID": i.dt_id ?? "", "Feeder ID": i.feeder_id ?? "", "Building code": i.building_code ?? "", "Structure no": i.structure_no ?? "",
        "Customer no": i.customer_no ?? "", "Call back form no": i.call_back_form_no ?? "", Username: i.username ?? "", Reason: i.reason, "Correct DT (should be on)": i.correct_dt ?? "", "Captured at": i.captured_at ?? "",
        Source: i.source === "lt" ? "LT Pole" : "Customer Enumeration",
      })),
      ["FID", "DT ID", "Feeder ID", "Building code", "Structure no", "Customer no", "Call back form no", "Username", "Reason", "Correct DT (should be on)", "Captured at", "Source"],
    );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Check finished</DialogTitle>
          <DialogDescription>
            {s.rowsRead.toLocaleString()} rows read · {s.inScope.toLocaleString()} on {rep.feeders.length} chosen feeder{rep.feeders.length === 1 ? "" : "s"} · {(s.ignoredNotFocused + s.ignoredNotInLookup).toLocaleString()} on other feeders left out{s.ignoredDates ? ` · ${s.ignoredDates.toLocaleString()} outside the dates` : ""} · {a.issues.length.toLocaleString()} flagged
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          {a.confirmed.length > 0 && (
            <section>
              <h3 className="font-bold text-success">Confirmed working: assigned staff who captured on their own DT <span className="font-normal text-muted-foreground">({a.confirmed.length})</span></h3>
              <div className="mt-1 max-h-44 overflow-auto rounded border">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted text-left"><tr><th className="p-2">DT</th><th>Feeder</th><th>Worked by</th><th>Dates</th><th>Captures</th></tr></thead>
                  <tbody>
                    {a.confirmed.map((c) => (
                      <tr key={c.dt_id} className="border-t align-top">
                        <td className="p-2 font-semibold">{c.dt_name ?? c.dt_id}<div className="font-normal text-muted-foreground">{c.dt_id}</div></td>
                        <td>{c.feeder_id ?? "—"}</td><td>{c.users.join(", ")}</td><td>{c.days.join(", ") || "—"}</td><td className="font-bold">{c.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          {REPORT_GROUPS.map((g) => {
            const rows = a.report.filter((r) => g.kinds.includes(r.kind));
            if (!rows.length) return null;
            return (
              <section key={g.title}>
                <h3 className="font-bold">{g.title} <span className="font-normal text-muted-foreground">({rows.length})</span></h3>
                {g.hint && <p className="text-xs text-muted-foreground">{g.hint}</p>}
                <div className="mt-1 max-h-52 overflow-auto rounded border">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-muted text-left"><tr><th className="p-2">DT</th><th>Feeder</th><th>Captured by</th><th>Captures</th><th></th></tr></thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={i} className="border-t align-top">
                          <td className="p-2 font-semibold">{r.dt_name ?? r.dt_id ?? "—"}<div className="font-normal text-muted-foreground">{r.dt_id ?? ""}</div></td>
                          <td>{r.feeder_id ?? "—"}</td>
                          <td>{r.users.join(", ") || "—"}</td>
                          <td className="font-bold">{r.count}</td>
                          <td>
                            {r.holders.length > 0 && <div>Assigned to {r.holders.join(", ")}</div>}
                            {r.partner && <span className="rounded bg-warning/30 px-1 font-bold">team partner</span>}
                            {g.kinds.length > 1 && <span className="text-muted-foreground">{KIND_LABEL[r.kind]}</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
          {!a.report.length && <p className="rounded border p-3">Nothing was flagged: every capture on the chosen feeders was on a DT assigned to the person who captured it.</p>}
        </div>
        <DialogFooter className="gap-2">
          {a.issues.length > 0 && <Button variant="outline" onClick={exportFlagged}><Download /> Download flagged captures</Button>}
          {goTo && a.selfAssign.length > 0 && <Button variant="outline" onClick={() => { onClose(); goTo("allocation"); }}>Open DT Allocation to authorize</Button>}
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}