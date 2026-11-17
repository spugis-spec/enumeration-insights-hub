import { useEffect, useMemo, useRef, useState } from "react";
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
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

type Progress = { label: string; pct: number };
type Scan = { dts: Set<string>; onDate: number; withDt: number };

/** Fallback parser (main thread) — same raw-value handling as the Uploads tab. */
async function readSheetMainThread(file: File): Promise<CaptureRow[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { cellDates: true });
  const raw = XLSX.utils.sheet_to_json<Record<string, any>>(wb.Sheets[wb.SheetNames[0]!]!, { defval: null, raw: true });
  return raw.map((r) => {
    const o: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(r)) o[k] = cellText(v);
    return o;
  });
}

/**
 * Parses the spreadsheet in the app's parse worker so the page never freezes,
 * then normalises the cell values in chunks, reporting progress as it goes.
 */
async function readSheetWithProgress(file: File, onProgress: (p: Progress) => void): Promise<CaptureRow[]> {
  onProgress({ label: "Reading the file…", pct: 5 });
  const buf = await file.arrayBuffer();
  let rawRows: Record<string, any>[] | null = null;
  try {
    onProgress({ label: "Reading the spreadsheet in the background…", pct: 20 });
    rawRows = await new Promise<Record<string, any>[]>((resolve, reject) => {
      const worker = new Worker(new URL("../../lib/parse.worker.ts", import.meta.url), { type: "module" });
      const id = "dt-file-check";
      const done = (fn: () => void) => { worker.terminate(); fn(); };
      worker.onmessage = (e: MessageEvent<{ id: string; rows?: Record<string, any>[]; error?: string }>) => {
        if (e.data.id !== id) return;
        if (e.data.error) done(() => reject(new Error(e.data.error)));
        else done(() => resolve(e.data.rows ?? []));
      };
      worker.onerror = () => done(() => reject(new Error("spreadsheet worker failed")));
      worker.postMessage({ id, buffer: buf }, [buf]);
    });
  } catch {
    rawRows = null; // fall back to the main-thread parser below
  }
  if (!rawRows) return readSheetMainThread(file);
  const out: CaptureRow[] = new Array(rawRows.length);
  const CHUNK = 4000;
  for (let i = 0; i < rawRows.length; i += CHUNK) {
    const end = Math.min(rawRows.length, i + CHUNK);
    for (let j = i; j < end; j++) {
      const r = rawRows[j]!;
      const o: Record<string, string | null> = {};
      for (const [k, v] of Object.entries(r)) o[k] = cellText(v);
      out[j] = o;
    }
    onProgress({ label: "Preparing the rows…", pct: 20 + Math.round((end / Math.max(1, rawRows.length)) * 20) });
    await tick();
  }
  return out;
}

type Missing = { dt: DT; holders: string[]; kind: string };

/**
 * Check ongoing DTs against a file picked from this device (nothing is uploaded or saved from the file):
 * pick the file, the feeder and the date. Ongoing DTs — assigned, self-assigned or authorized —
 * whose DT ID does not appear in the file on that date are listed so they can be marked complete.
 * Only the DTs actually ticked are completed; DTs found in the file stay ongoing.
 * Completed DTs stay on record as Completed, with the completion date kept on their allocations.
 * Reading and checking run in chunks with a progress bar, so the page never sits frozen.
 */
export function DtFileCheckDialog({ m, feederId, open, onOpenChange, onComplete, busy }: {
  m: Model; feederId: string; open: boolean; onOpenChange: (v: boolean) => void; onComplete: (list: DT[]) => void; busy: boolean;
}) {
  const today = localToday();
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<CaptureRow[] | null>(null);
  const [parseErr, setParseErr] = useState("");
  const [progress, setProgress] = useState<Progress | null>(null);
  const [scan, setScan] = useState<Scan | null>(null);
  const [feeder, setFeeder] = useState(feederId || m.feeders[0]?.feeder_id || "");
  const [date, setDate] = useState(today);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);
  const runRef = useRef(0);

  async function onFile(file: File | undefined) {
    if (!file) return;
    const run = ++runRef.current;
    setParseErr(""); setPicked(new Set()); setScan(null); setRows(null);
    try {
      const parsed = await readSheetWithProgress(file, (p) => { if (runRef.current === run) setProgress(p); });
      if (runRef.current !== run) return;
      setRows(parsed); setFileName(file.name);
      if (!parsed.length) { setParseErr("That file has no data rows."); setProgress(null); }
    } catch (e: any) {
      if (runRef.current !== run) return;
      setRows(null); setFileName(""); setProgress(null);
      setParseErr("Could not read that file: " + (e?.message ?? e));
    }
  }

  // Chunked scan of the parsed rows for the chosen date, with progress — never one long freeze.
  useEffect(() => {
    if (!rows || !open) return;
    const run = ++runRef.current;
    setScan(null); setPicked(new Set());
    (async () => {
      const dts = new Set<string>();
      let onDate = 0, withDt = 0;
      const CHUNK = 2000;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const end = Math.min(rows.length, i + CHUNK);
        for (let j = i; j < end; j++) {
          const f = readRow(rows[j]!);
          if (f.day !== date) continue;
          onDate++;
          if (f.dt) { withDt++; dts.add(keyOf(f.dt)); }
        }
        if (runRef.current !== run) return;
        setProgress({ label: `Checking rows against ${short(date)} — ${end.toLocaleString()} of ${rows.length.toLocaleString()} rows`, pct: 40 + Math.round((end / Math.max(1, rows.length)) * 60) });
        await tick();
      }
      if (runRef.current !== run) return;
      setScan({ dts, onDate, withDt });
      setProgress(null);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, date, open]);

  const missing = useMemo<Missing[]>(() => {
    if (!scan || !feeder) return [];
    return m.dts
      .filter((d) => d.feeder_id === feeder && d.status === "assigned" && !scan.dts.has(keyOf(d.dt_id)))
      .map((d) => {
        const live = activeAllocs(m, d.dt_id);
        const holders = live.map((a) => m.enumById.get(a.enumerator_id)).filter((e): e is NonNullable<typeof e> => !!e).map((e) => e.full_name || e.username);
        const self = live.some((a) => a.self_assigned);
        const kind = self ? (live.some((a) => a.self_assigned && a.authorized === true) ? "Self-assigned · Authorized" : "Self-assigned · awaiting authorization") : "Assigned";
        return { dt: d, holders, kind };
      })
      .sort((a, b) => (a.dt.dt_name ?? a.dt.dt_id).localeCompare(b.dt.dt_name ?? b.dt.dt_id));
  }, [m, scan, feeder]);

  const ongoingCount = useMemo(() => (feeder ? m.dts.filter((d) => d.feeder_id === feeder && d.status === "assigned").length : 0), [m, feeder]);
  const foundCount = scan ? ongoingCount - missing.length : 0;
  const chosen = missing.filter((x) => picked.has(x.dt.dt_id));
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const feederName = m.feederById.get(feeder)?.feeder_name ?? feeder;
  const working = progress !== null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] w-[calc(100vw-1rem)] flex-col gap-3 overflow-hidden p-4 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Check ongoing DTs against a file</DialogTitle>
          <p className="text-xs text-muted-foreground">
            Pick a Customer Enumeration or LT Pole file from this device, choose the feeder and the date, and every ongoing DT
            (assigned, self-assigned or authorized) that does <b>not</b> appear in that file on that date is listed below to mark complete.
            DTs that <b>are</b> found in the file stay ongoing, and <b>only the DTs you tick</b> are marked complete — nothing is completed automatically.
            The file itself is only read here — nothing from it is uploaded or saved. Completed DTs stay on record as Completed.
          </p>
        </DialogHeader>

        <div className="space-y-2">
          <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">1 · File from this device</div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" className="h-10" disabled={working} onClick={() => fileRef.current?.click()}>
              📁 Choose file
            </Button>
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={(e) => { void onFile(e.target.files?.[0]); e.currentTarget.value = ""; }} />
            {fileName && <span className="text-sm font-semibold">{fileName}</span>}
            {rows && <span className="text-xs text-muted-foreground">{rows.length.toLocaleString()} rows read</span>}
          </div>
          {parseErr && <p className="rounded border border-destructive bg-destructive/10 p-2 text-xs font-bold">{parseErr}</p>}
          {progress && (
            <div className="space-y-1" role="status" aria-live="polite">
              <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary transition-all duration-200" style={{ width: `${Math.min(100, Math.max(0, progress.pct))}%` }} />
              </div>
              <p className="text-xs font-semibold">{progress.label} — {progress.pct}%</p>
            </div>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">2 · Feeder to check</div>
            <select className={selectCls + " h-10 w-full"} value={feeder} disabled={working} onChange={(e) => { setFeeder(e.target.value); setPicked(new Set()); }}>
              {m.feeders.map((f) => (
                <option key={f.feeder_id} value={f.feeder_id}>{f.feeder_name} ({f.feeder_id})</option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">3 · Date to check</div>
            <Input type="date" max={today} className="h-10" value={date} disabled={working} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>

        {scan && !working && (
          <p className="text-sm">
            In <b>{fileName}</b>: <b>{scan.onDate.toLocaleString()}</b> rows dated <b>{short(date)}</b>, covering <b>{scan.dts.size}</b> DT{scan.dts.size === 1 ? "" : "s"}.
            Of the <b>{ongoingCount}</b> ongoing DT{ongoingCount === 1 ? "" : "s"} on <b>{feederName}</b>, <b>{foundCount}</b> {foundCount === 1 ? "was" : "were"} found in the file (stays ongoing)
            and <b>{missing.length}</b> {missing.length === 1 ? "was" : "were"} not found (listed below). Only the ones you tick will be marked complete.
          </p>
        )}
        {scan && scan.onDate === 0 && (
          <p className="rounded border border-warning bg-warning/15 p-2 text-xs font-bold">
            ⚠ No rows in that file are dated {short(date)}. Check the date — if the file uses a different date column or order, every ongoing DT will look missing.
          </p>
        )}
        {scan && scan.onDate > 0 && scan.withDt === 0 && (
          <p className="rounded border border-warning bg-warning/15 p-2 text-xs font-bold">
            ⚠ Rows were found for {short(date)} but none carried a DT ID (a <b>DT ID</b> column, or one starting with <b>dss_</b>), so nothing can be matched.
          </p>
        )}

        {missing.length > 0 && !working && (
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
              <span className="text-sm font-bold">{chosen.length} selected — only these will be completed</span>
              <Button disabled={busy || !chosen.length} onClick={() => onComplete(chosen.map((x) => x.dt))}>
                {busy ? "Saving…" : `✓ Mark ${chosen.length || ""} as complete`}
              </Button>
            </div>
          </>
        )}
        {scan && !working && scan.onDate > 0 && scan.withDt > 0 && !missing.length && (
          <p className="rounded border bg-muted/50 p-3 text-sm">Every ongoing DT on {feederName} appears in the file on {short(date)}, so none needs completing.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
