import { useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { readRow, type CaptureRow } from "@/lib/field/captureEngine";
import { activeAllocs, type DT, type Model } from "@/lib/field/data";
import { localToday } from "@/lib/field/stale";
import { selectCls } from "./common";
import { cellText } from "./UploadsTab";

const keyOf = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
const short = (d: string) => new Date(d + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

/** Reads the first sheet of a file picked from this device (same raw-value handling as the Uploads tab). */
async function readSheet(file: File): Promise<CaptureRow[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { cellDates: true });
  const raw = XLSX.utils.sheet_to_json<Record<string, any>>(wb.Sheets[wb.SheetNames[0]!]!, { defval: null, raw: true });
  return raw.map((r) => {
    const o: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(r)) o[k] = cellText(v);
    return o;
  });
}

type Missing = { dt: DT; holders: string[]; kind: string };

/**
 * Check ongoing DTs against a file picked from this device (nothing is uploaded or saved from the file):
 * pick the file, the feeder and the date. Ongoing DTs — assigned, self-assigned or authorized —
 * whose DT ID does not appear in the file on that date are listed so they can be marked complete.
 * Completed DTs stay on record as Completed, with the completion date kept on their allocations.
 */
export function DtFileCheckDialog({ m, feederId, open, onOpenChange, onComplete, busy }: {
  m: Model; feederId: string; open: boolean; onOpenChange: (v: boolean) => void; onComplete: (list: DT[]) => void; busy: boolean;
}) {
  const today = localToday();
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<CaptureRow[] | null>(null);
  const [parseErr, setParseErr] = useState("");
  const [parsing, setParsing] = useState(false);
  const [feeder, setFeeder] = useState(feederId || m.feeders[0]?.feeder_id || "");
  const [date, setDate] = useState(today);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setParsing(true); setParseErr(""); setPicked(new Set());
    try {
      const parsed = await readSheet(file);
      setRows(parsed); setFileName(file.name);
      if (!parsed.length) setParseErr("That file has no data rows.");
    } catch (e: any) {
      setRows(null); setFileName("");
      setParseErr("Could not read that file: " + (e?.message ?? e));
    } finally { setParsing(false); }
  }

  const stats = useMemo(() => {
    if (!rows) return null;
    const dts = new Set<string>();
    let onDate = 0, withDt = 0;
    for (const r of rows) {
      const f = readRow(r);
      if (f.day !== date) continue;
      onDate++;
      if (f.dt) { withDt++; dts.add(keyOf(f.dt)); }
    }
    return { total: rows.length, onDate, withDt, dts };
  }, [rows, date]);

  const missing = useMemo<Missing[]>(() => {
    if (!stats || !feeder) return [];
    return m.dts
      .filter((d) => d.feeder_id === feeder && d.status === "assigned" && !stats.dts.has(keyOf(d.dt_id)))
      .map((d) => {
        const live = activeAllocs(m, d.dt_id);
        const holders = live.map((a) => m.enumById.get(a.enumerator_id)).filter((e): e is NonNullable<typeof e> => !!e).map((e) => e.full_name || e.username);
        const self = live.some((a) => a.self_assigned);
        const kind = self ? (live.some((a) => a.self_assigned && a.authorized === true) ? "Self-assigned · Authorized" : "Self-assigned · awaiting authorization") : "Assigned";
        return { dt: d, holders, kind };
      })
      .sort((a, b) => (a.dt.dt_name ?? a.dt.dt_id).localeCompare(b.dt.dt_name ?? b.dt.dt_id));
  }, [m, stats, feeder]);

  const ongoingCount = useMemo(() => (feeder ? m.dts.filter((d) => d.feeder_id === feeder && d.status === "assigned").length : 0), [m, feeder]);
  const chosen = missing.filter((x) => picked.has(x.dt.dt_id));
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const feederName = m.feederById.get(feeder)?.feeder_name ?? feeder;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] w-[calc(100vw-1rem)] flex-col gap-3 overflow-hidden p-4 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Check ongoing DTs against a file</DialogTitle>
          <p className="text-xs text-muted-foreground">
            Pick a Customer Enumeration or LT Pole file from this device, choose the feeder and the date, and every ongoing DT
            (assigned, self-assigned or authorized) that does <b>not</b> appear in that file on that date is listed below to mark complete.
            The file itself is only read here — nothing from it is uploaded or saved. Completed DTs stay on record as Completed.
          </p>
        </DialogHeader>

        <div className="space-y-2">
          <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">1 · File from this device</div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" className="h-10" disabled={parsing} onClick={() => fileRef.current?.click()}>
              {parsing ? "Reading…" : "📁 Choose file"}
            </Button>
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={(e) => { void onFile(e.target.files?.[0]); e.currentTarget.value = ""; }} />
            {fileName && <span className="text-sm font-semibold">{fileName}</span>}
            {rows && <span className="text-xs text-muted-foreground">{rows.length.toLocaleString()} rows read</span>}
          </div>
          {parseErr && <p className="rounded border border-destructive bg-destructive/10 p-2 text-xs font-bold">{parseErr}</p>}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">2 · Feeder to check</div>
            <select className={selectCls + " h-10 w-full"} value={feeder} onChange={(e) => { setFeeder(e.target.value); setPicked(new Set()); }}>
              {m.feeders.map((f) => (
                <option key={f.feeder_id} value={f.feeder_id}>{f.feeder_name} ({f.feeder_id})</option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">3 · Date to check</div>
            <Input type="date" max={today} className="h-10" value={date} onChange={(e) => { setDate(e.target.value); setPicked(new Set()); }} />
          </div>
        </div>

        {stats && (
          <p className="text-sm">
            In <b>{fileName}</b>: <b>{stats.onDate.toLocaleString()}</b> rows dated <b>{short(date)}</b>, covering <b>{stats.dts.size}</b> DT{stats.dts.size === 1 ? "" : "s"}.
            On <b>{feederName}</b>, <b>{missing.length}</b> of {ongoingCount} ongoing DT{ongoingCount === 1 ? "" : "s"} did not appear on that date.
          </p>
        )}
        {stats && stats.onDate === 0 && (
          <p className="rounded border border-warning bg-warning/15 p-2 text-xs font-bold">
            ⚠ No rows in that file are dated {short(date)}. Check the date — if the file uses a different date column or order, every ongoing DT will look missing.
          </p>
        )}
        {stats && stats.onDate > 0 && stats.withDt === 0 && (
          <p className="rounded border border-warning bg-warning/15 p-2 text-xs font-bold">
            ⚠ Rows were found for {short(date)} but none carried a DT ID (a <b>DT ID</b> column, or one starting with <b>dss_</b>), so nothing can be matched.
          </p>
        )}

        {missing.length > 0 && (
          <>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" className="h-10" onClick={() => setPicked(new Set(missing.map((x) => x.dt.dt_id)))}>Select all {missing.length}</Button>
              <Button variant="ghost" className="h-10" disabled={!picked.size} onClick={() => setPicked(new Set())}>Clear</Button>
            </div>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
              {missing.map((x) => (
                <label key={x.dt.dt_id} className={"flex cursor-pointer items-start gap-3 rounded-lg border p-3 " + (picked.has(x.dt.dt_id) ? "border-success bg-success/10" : "bg-card")}>
                  <input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={picked.has(x.dt.dt_id)} onChange={() => toggle(x.dt.dt_id)} />
                  <div className="min-w-0 flex-1">
                    <div className="font-extrabold">{x.dt.dt_name || "(no name)"} <span className="ml-1 rounded-full border border-success px-2 py-0.5 align-middle text-[10px] font-bold text-success">Ongoing</span></div>
                    <div className="text-xs text-muted-foreground">{x.dt.dt_id} · {x.dt.feeder_id}</div>
                    <div className="text-xs">{x.kind}{x.holders.length ? ` — ${x.holders.join(", ")}` : ""}</div>
                    <div className="text-xs font-semibold text-destructive">Not in the file on {short(date)}</div>
                  </div>
                </label>
              ))}
            </div>
            <div className="flex items-center justify-between gap-2 border-t pt-3">
              <span className="text-sm font-bold">{chosen.length} selected</span>
              <Button disabled={busy || !chosen.length} onClick={() => onComplete(chosen.map((x) => x.dt))}>
                {busy ? "Saving…" : `✓ Mark ${chosen.length || ""} as complete`}
              </Button>
            </div>
          </>
        )}
        {stats && stats.onDate > 0 && stats.withDt > 0 && !missing.length && (
          <p className="rounded border bg-muted/50 p-3 text-sm">Every ongoing DT on {feederName} appears in the file on {short(date)}, so none needs completing.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
