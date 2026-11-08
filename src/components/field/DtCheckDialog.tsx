import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { findMissingOnDates, localToday, recentCaptureDates } from "@/lib/field/stale";
import type { DT, Model } from "@/lib/field/data";

const short = (d: string) => new Date(d + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" });

/**
 * Phone-friendly check: pick one or more dates, see which ongoing DTs have NO capture in the uploaded enumeration data
 * on those dates, search, tick several and mark them complete in one go.
 */
export function DtCheckDialog({ m, feederId, open, onOpenChange, onComplete, busy }: {
  m: Model; feederId: string; open: boolean; onOpenChange: (v: boolean) => void; onComplete: (list: DT[]) => void; busy: boolean;
}) {
  const today = localToday();
  const [days, setDays] = useState<string[]>([today]);
  const [scope, setScope] = useState<"feeder" | "all">(feederId ? "feeder" : "all");
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const feeder = m.feederById.get(feederId);
  const uploaded = useMemo(() => recentCaptureDates(m, 14, today), [m, today]);
  const chips = useMemo(() => [...new Set([today, ...uploaded, ...days])].sort().reverse().slice(0, 16), [today, uploaded, days]);
  const res = useMemo(
    () => findMissingOnDates({ m, days, feeders: scope === "feeder" && feederId ? [feederId] : null }),
    [m, days, scope, feederId],
  );
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? res.missing.filter((x) => `${x.dt.dt_name ?? ""} ${x.dt.dt_id} ${x.feeder_id} ${x.holders.join(" ")}`.toLowerCase().includes(t)) : res.missing;
  }, [res, q]);
  // keep only ticks that are still in the list (after completing, or after changing dates)
  useEffect(() => {
    const ids = new Set(res.missing.map((x) => x.dt.dt_id));
    setPicked((p) => (([...p].every((id) => ids.has(id))) ? p : new Set([...p].filter((id) => ids.has(id)))));
  }, [res]);
  const chosen = res.missing.filter((x) => picked.has(x.dt.dt_id));
  const toggleDay = (d: string) => setDays((p) => (p.includes(d) ? p.filter((x) => x !== d) : [...p, d]));
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const chipCls = (on: boolean) => "min-h-10 rounded-full border px-3 text-sm font-bold " + (on ? "border-foreground bg-foreground text-background" : "bg-card hover:bg-muted");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] w-[calc(100vw-1rem)] flex-col gap-3 overflow-hidden p-4 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Check ongoing DTs against uploaded data</DialogTitle>
          <p className="text-xs text-muted-foreground">
            Pick the date(s). Ongoing DTs with no capture in the uploaded enumeration data on those dates are listed below. Tick the finished ones and mark them complete.
          </p>
        </DialogHeader>

        <div className="space-y-2">
          <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">1 · Dates to check</div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={chipCls(days.length === 1 && days[0] === today)} onClick={() => setDays([today])}>Today</button>
            <button type="button" className={chipCls(false)} disabled={!uploaded.length} onClick={() => setDays(uploaded.slice(0, 1))}>Latest upload</button>
            <button type="button" className={chipCls(false)} disabled={!uploaded.length} onClick={() => setDays(uploaded.slice(0, 3))}>Last 3 uploads</button>
            <button type="button" className="min-h-10 px-2 text-sm text-muted-foreground underline" onClick={() => setDays([])}>Clear</button>
          </div>
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {chips.map((d) => (
              <button key={d} type="button" className={chipCls(days.includes(d)) + " shrink-0"} onClick={() => toggleDay(d)}>
                {days.includes(d) ? "✓ " : ""}{short(d)}{d === today ? " (today)" : ""}{!uploaded.includes(d) ? " · no data" : ""}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Add another date
            <Input type="date" max={today} className="h-10 w-auto" onChange={(e) => { const v = e.target.value; if (v && !days.includes(v)) setDays((p) => [...p, v]); e.currentTarget.value = ""; }} />
          </label>
        </div>

        <div className="space-y-2">
          <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">2 · Which feeders</div>
          <div className="inline-flex overflow-hidden rounded-md border text-sm font-bold" role="group" aria-label="Feeder scope">
            <button type="button" disabled={!feederId} className={"min-h-10 px-3 " + (scope === "feeder" ? "bg-foreground text-background" : "hover:bg-muted")} onClick={() => setScope("feeder")}>
              This feeder{feeder ? ` (${feeder.feeder_name})` : ""}
            </button>
            <button type="button" className={"min-h-10 px-3 " + (scope === "all" ? "bg-foreground text-background" : "hover:bg-muted")} onClick={() => setScope("all")}>All feeders</button>
          </div>
        </div>

        {res.skipped.length > 0 && (
          <p className="rounded border border-warning bg-warning/15 p-2 text-xs font-bold">
            ⚠ No enumeration data has been uploaded for {res.skipped.map(short).join(", ")}, so {res.skipped.length > 1 ? "those dates were" : "that date was"} not checked. Upload it first, or pick a date that has data.
          </p>
        )}
        {res.days.length > 0 && (
          <p className="text-sm">
            Checked <b>{res.days.map(short).join(", ")}</b>: <b>{res.missing.length}</b> of {res.checked} ongoing DT{res.checked === 1 ? "" : "s"} not found in the uploaded data
            {res.found ? `, ${res.found} found (still being worked)` : ""}.
          </p>
        )}
        {!res.days.length && !res.skipped.length && <p className="text-sm text-muted-foreground">Pick at least one date above.</p>}

        {res.missing.length > 0 && (
          <>
            <div className="flex flex-wrap gap-2">
              <Input className="h-10 min-w-0 flex-1" placeholder="Search DT name, ID or enumerator" value={q} onChange={(e) => setQ(e.target.value)} />
              <Button variant="outline" className="h-10" onClick={() => setPicked(new Set([...picked, ...shown.map((x) => x.dt.dt_id)]))}>Select all {shown.length}</Button>
              <Button variant="ghost" className="h-10" disabled={!picked.size} onClick={() => setPicked(new Set())}>Clear</Button>
            </div>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
              {shown.map((x) => (
                <label key={x.dt.dt_id} className={"flex cursor-pointer items-start gap-3 rounded-lg border p-3 " + (picked.has(x.dt.dt_id) ? "border-success bg-success/10" : "bg-card")}>
                  <input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={picked.has(x.dt.dt_id)} onChange={() => toggle(x.dt.dt_id)} />
                  <div className="min-w-0 flex-1">
                    <div className="font-extrabold">{x.dt.dt_name || "(no name)"}</div>
                    <div className="text-xs text-muted-foreground">{x.dt.dt_id} · {x.feeder_id}</div>
                    <div className="text-xs">Assigned to: {x.holders.join(", ") || "—"}</div>
                    <div className={"text-xs font-semibold " + (x.lastCapture ? "" : "text-destructive")}>{x.lastCapture ? `Last captured ${short(x.lastCapture)}` : "Never captured"}</div>
                  </div>
                </label>
              ))}
              {!shown.length && <p className="p-4 text-center text-sm text-muted-foreground">No DT matches your search.</p>}
            </div>
            <div className="flex items-center justify-between gap-2 border-t pt-3">
              <span className="text-sm font-bold">{chosen.length} selected</span>
              <Button disabled={busy || !chosen.length} onClick={() => onComplete(chosen.map((x) => x.dt))}>
                {busy ? "Saving…" : `✓ Mark ${chosen.length || ""} as complete`}
              </Button>
            </div>
          </>
        )}
        {res.days.length > 0 && !res.missing.length && (
          <p className="rounded border bg-muted/50 p-3 text-sm">Every ongoing DT in scope appears in the uploaded data for the checked date(s), so none needs completing.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
