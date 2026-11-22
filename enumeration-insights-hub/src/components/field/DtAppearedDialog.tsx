import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { CaptureRow } from "@/lib/field/captureEngine";
import { addAppearedRows, buildAppearedWrites, createAppearedAcc, matchAppeared, type AppearedAcc, type AppearedMatch } from "@/lib/field/appeared";
import type { Model } from "@/lib/field/data";
import { addMany, patchMany } from "@/lib/field/db";
import { auth } from "@/lib/field/firebase";
import { localToday } from "@/lib/field/stale";
import { selectCls } from "./common";
import { cellText } from "./UploadsTab";

const tick = () => new Promise<void>((r) => setTimeout(r, 0));
const fmtDay = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : null);
const dayRange = (first: string | null, last: string | null) => {
  const a = fmtDay(first), b = fmtDay(last);
  if (!a) return "no dates in file";
  return a === b ? a : `${a} – ${b}`;
};

type Progress = { label: string; pct: number };

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
      const id = "dt-appeared-check";
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

type Saved = { dts: number; allocs: number; workerOnly: number };

/**
 * Find unassigned DTs in a file picked from this device: pick a Customer Enumeration or LT Pole file and the feeder.
 * Every DT that appears in the file even once but is still Unassigned on that feeder is listed, with everyone who
 * captured on it. Nothing is saved until the in-dialog confirmation, and only the ticked DTs are saved: all capturers'
 * names are attached to each DT for reference (its workers record), and a self-assigned allocation is created for each
 * capturer who is on staff — never just one person when several captured. Reading and checking run in chunks with a
 * progress bar, so the page never sits frozen.
 */
export function DtAppearedDialog({ m, feederId, open, onOpenChange, onSaved }: {
  m: Model; feederId: string; open: boolean; onOpenChange: (v: boolean) => void; onSaved: () => void;
}) {
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<CaptureRow[] | null>(null);
  const [parseErr, setParseErr] = useState("");
  const [progress, setProgress] = useState<Progress | null>(null);
  const [acc, setAcc] = useState<AppearedAcc | null>(null);
  const [feeder, setFeeder] = useState(feederId || m.feeders[0]?.feeder_id || "");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [authorize, setAuthorize] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState<Progress | null>(null);
  const [saveErr, setSaveErr] = useState("");
  const [saved, setSaved] = useState<Saved | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const runRef = useRef(0);

  // Each time the dialog opens, start from the feeder selected on the Allocation tab.
  useEffect(() => {
    if (open && feederId) { setFeeder(feederId); setPicked(new Set()); setConfirming(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open ]);

  const handleOpenChange = (v: boolean) => {
    if (!v) { setSaved(null); setConfirming(false); setSaveErr(""); }
    onOpenChange(v);
  };

  async function onFile(file: File | undefined) {
    if (!file) return;
    const run = ++runRef.current;
    setParseErr(""); setPicked(new Set()); setAcc(null); setRows(null); setSaved(null); setSaveErr(""); setConfirming(false);
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

  // Chunked scan of the parsed rows (every row counts — no date filter), with progress.
  useEffect(() => {
    if (!rows || !open) return;
    const run = ++runRef.current;
    setAcc(null); setPicked(new Set()); setConfirming(false);
    (async () => {
      const a = createAppearedAcc();
      const CHUNK = 2000;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const end = Math.min(rows.length, i + CHUNK);
        addAppearedRows(a, rows.slice(i, end));
        if (runRef.current !== run) return;
        setProgress({ label: `Checking rows — ${end.toLocaleString()} of ${rows.length.toLocaleString()} rows`, pct: 40 + Math.round((end / Math.max(1, rows.length)) * 60) });
        await tick();
      }
      if (runRef.current !== run) return;
      setAcc(a);
      setProgress(null);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, open]);

  const result = useMemo(() => (acc && feeder ? matchAppeared(m, feeder, acc) : null), [m, feeder, acc]);
  const matches: AppearedMatch[] = result?.matches ?? [];
  const chosen = matches.filter((x) => picked.has(x.dt.dt_id));
  const preview = useMemo(
    () => (chosen.length ? buildAppearedWrites(m, chosen, { authorize, uid: null, today: localToday() }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [m, picked, matches, authorize],
  );
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const feederName = m.feederById.get(feeder)?.feeder_name ?? feeder;
  const working = progress !== null || saving;
  const bar = saveProgress ?? progress;

  async function save() {
    const writes = buildAppearedWrites(m, chosen, { authorize, uid: auth().currentUser?.uid ?? null, today: localToday() });
    setSaving(true); setSaveErr("");
    try {
      if (writes.allocations.length)
        await addMany("allocations", writes.allocations, (d, t) => setSaveProgress({ label: `Saving allocations — ${d.toLocaleString()} of ${t.toLocaleString()}`, pct: t ? Math.round((d / t) * 90) : 90 }));
      if (writes.dtPatches.length) {
        setSaveProgress({ label: "Updating the DTs…", pct: 95 });
        await patchMany("dts", writes.dtPatches);
      }
      setSaved({ dts: chosen.length, allocs: writes.allocCount, workerOnly: writes.workerOnlyDts });
      setConfirming(false);
      setPicked(new Set());
      onSaved();
    } catch (e: any) {
      setSaveErr("Could not save: " + (e?.message ?? e) + " Nothing was changed by this attempt — check your connection and try again.");
    } finally {
      setSaving(false);
      setSaveProgress(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[92vh] w-[calc(100vw-1rem)] flex-col gap-3 overflow-hidden p-4 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Find unassigned DTs in a file</DialogTitle>
          <p className="text-xs text-muted-foreground">
            Pick a Customer Enumeration or LT Pole file from this device and the feeder. Every DT that appears in the file
            even once but is still <b>Unassigned</b> on that feeder is listed below, with <b>everyone who captured on it</b>.
            <b> Nothing is saved until you confirm</b>, and only the DTs you tick are saved. All capturers&apos; names are attached
            to each DT for reference (the DT&apos;s workers record), and a <b>self-assigned allocation</b> is created for each capturer
            who is on staff — never just one person when several captured. You can also authorize the self-assigned DTs in the same step.
          </p>
        </DialogHeader>

        {saved ? (
          <div className="space-y-3">
            <p className="rounded border border-success bg-success/10 p-3 text-sm">
              ✓ Saved <b>{saved.dts}</b> DT{saved.dts === 1 ? "" : "s"}: <b>{saved.allocs}</b> self-assigned allocation{saved.allocs === 1 ? "" : "s"} created
              {authorize ? " and authorized" : " (awaiting authorization — authorize them any time from DT Allocation)"}.
              {saved.workerOnly > 0 && <> For <b>{saved.workerOnly}</b> DT{saved.workerOnly === 1 ? "" : "s"} no allocation could be created — the capturers&apos; names were attached for reference only.</>}
              {" "}Saved DTs are now Assigned and will not be offered here again.
            </p>
            <div className="flex justify-end">
              <Button className="h-10" onClick={() => handleOpenChange(false)}>Close</Button>
            </div>
          </div>
        ) : (
          <>
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
              {bar && (
                <div className="space-y-1" role="status" aria-live="polite">
                  <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary transition-all duration-200" style={{ width: `${Math.min(100, Math.max(0, bar.pct))}%` }} />
                  </div>
                  <p className="text-xs font-semibold">{bar.label} — {bar.pct}%</p>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">2 · Feeder to check</div>
              <select className={selectCls + " h-10 w-full"} value={feeder} disabled={working} onChange={(e) => { setFeeder(e.target.value); setPicked(new Set()); setConfirming(false); }}>
                {m.feeders.map((f) => (
                  <option key={f.feeder_id} value={f.feeder_id}>{f.feeder_name} ({f.feeder_id})</option>
                ))}
              </select>
            </div>

            {saveErr && <p className="rounded border border-destructive bg-destructive/10 p-2 text-xs font-bold">{saveErr}</p>}

            {result && !working && rows && (
              <p className="text-sm">
                <b>{rows.length.toLocaleString()}</b> rows read from <b>{fileName}</b>; <b>{acc!.size.toLocaleString()}</b> DT{acc!.size === 1 ? "" : "s"} appear in the file.
                On <b>{feederName}</b>: <b>{result.appearedOnFeeder}</b> appeared, of which <b>{matches.length}</b> {matches.length === 1 ? "is" : "are"} still unassigned (listed below)
                and <b>{result.appearedOnFeeder - matches.length}</b> already assigned or completed.
                <b> {result.appearedElsewhere}</b> appeared DT{result.appearedElsewhere === 1 ? "" : "s"} belong{result.appearedElsewhere === 1 ? "s" : ""} to other feeders or are not in the lookup.
              </p>
            )}
            {result && !working && acc && acc.size === 0 && (
              <p className="rounded border border-warning bg-warning/15 p-2 text-xs font-bold">
                ⚠ No DT IDs were found in that file (a <b>DT ID</b> column, or one starting with <b>dss_</b>), so nothing can be matched.
              </p>
            )}

            {matches.length > 0 && !working && (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" className="h-10" onClick={() => setPicked(new Set(matches.map((x) => x.dt.dt_id)))}>Select all {matches.length}</Button>
                  <Button variant="ghost" className="h-10" disabled={!picked.size} onClick={() => setPicked(new Set())}>Clear</Button>
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <input type="checkbox" className="h-5 w-5" checked={authorize} onChange={(e) => { setAuthorize(e.target.checked); setConfirming(false); }} />
                    Also authorize these self-assigned DTs
                  </label>
                </div>
                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                  {matches.map((x) => {
                    const anyStaff = x.capturers.some((c) => c.enumeratorId);
                    return (
                      <label key={x.dt.dt_id} className={"flex cursor-pointer items-start gap-3 rounded-lg border p-3 " + (picked.has(x.dt.dt_id) ? "border-success bg-success/10" : "bg-card")}>
                        <input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={picked.has(x.dt.dt_id)} onChange={() => toggle(x.dt.dt_id)} />
                        <div className="min-w-0 flex-1">
                          <div className="font-extrabold">{x.dt.dt_name || "(no name)"} <span className="ml-1 rounded-full border border-destructive px-2 py-0.5 align-middle text-[10px] font-bold text-destructive">Unassigned</span></div>
                          <div className="text-xs text-muted-foreground">{x.dt.dt_id} · {x.dt.feeder_id} · {x.total.toLocaleString()} capture{x.total === 1 ? "" : "s"} in the file</div>
                          <div className="mt-1 space-y-0.5">
                            {x.capturers.map((c) => (
                              <div key={c.username} className="text-xs">
                                <span className="font-semibold">{c.fullName || c.username || "(no name in file)"}</span>
                                {c.fullName && c.username && <span className="text-muted-foreground"> (@{c.username})</span>}
                                {" "}· {c.count.toLocaleString()} capture{c.count === 1 ? "" : "s"} · {dayRange(c.first, c.last)}{" "}
                                <span className={"rounded px-1.5 py-0.5 text-[10px] font-bold " + (c.enumeratorId ? "bg-success/20 text-success" : "bg-muted text-muted-foreground")}>{c.enumeratorId ? "On staff" : "Not on staff"}</span>
                              </div>
                            ))}
                          </div>
                          {!anyStaff && (
                            <div className="mt-1 text-xs font-semibold text-warning-foreground">Names will be attached for reference — no allocation can be created for this DT.</div>
                          )}
                        </div>
                      </label>
                    );
                  })}
                </div>
                {confirming ? (
                  <div className="space-y-2 rounded-lg border border-warning bg-warning/15 p-3">
                    <p className="text-sm">
                      Save <b>{chosen.length}</b> DT{chosen.length === 1 ? "" : "s"}? <b>{preview?.allocCount ?? 0}</b> self-assigned allocation{(preview?.allocCount ?? 0) === 1 ? "" : "s"} will be created across them
                      (one per capturer on staff), every capturer&apos;s name is attached to its DT for reference, and the DTs become <b>Assigned</b>.
                      Authorization is <b>{authorize ? "ON — the self-assigned DTs are authorized" : "OFF — they will wait for authorization"}</b>.
                      {(preview?.workerOnlyDts ?? 0) > 0 && <> For <b>{preview!.workerOnlyDts}</b> of them no allocation can be created, so only the names are attached.</>}
                    </p>
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button variant="ghost" className="h-10" disabled={saving} onClick={() => setConfirming(false)}>Back</Button>
                      <Button className="h-10" disabled={saving || !chosen.length} onClick={() => void save()}>
                        {saving ? "Saving…" : `Yes, save ${chosen.length}`}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-2 border-t pt-3">
                    <span className="text-sm font-bold">{chosen.length} selected — only these will be saved{preview ? ` · ${preview.allocCount} allocation${preview.allocCount === 1 ? "" : "s"} to create` : ""}</span>
                    <Button disabled={saving || !chosen.length} onClick={() => setConfirming(true)}>
                      {saving ? "Saving…" : `✓ Save ${chosen.length || ""} DT${chosen.length === 1 ? "" : "s"}`}
                    </Button>
                  </div>
                )}
              </>
            )}
            {result && !working && acc && acc.size > 0 && !matches.length && (
              <p className="rounded border bg-muted/50 p-3 text-sm">No DT that appears in the file is still unassigned on {feederName} — everything that appeared is already assigned or completed there.</p>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
