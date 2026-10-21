import { useEffect, useState } from "react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { CheckCircle2, Download, History, Loader2, Save, Trash2, X, XCircle } from "lucide-react";
import { addMany, patchMany, removeMany, updateRow, upsertMany, safeId } from "@/lib/field/db";
import { auth } from "@/lib/field/firebase";
import { captureIssueReason, useRefresh, type Model } from "@/lib/field/data";
import { parseCaptureTime } from "@/lib/field/dates";
import { fetchDashboardRows, type DashboardRows } from "@/lib/field/dashboardSync";
import { getScope, inDateRange, scopeFeederIds, setScope, useScope } from "@/lib/field/scope";
import { planSelfAssign } from "@/lib/field/fieldwork";
import { DtWorkTable } from "./DtWorkTable";
import {
  UPLOADED_COLLECTIONS,
  DATA_COLLECTIONS,
  clearCaptures,
  clearLtPoles,
  clearCollections,
  clearLookup,
  clearPoints,
  clearStaff,
  createSnapshot,
  deleteSnapshot,
  downloadCaptures,
  downloadFullBackup,
  downloadLookup,
  downloadPoints,
  downloadStaff,
  listSnapshots,
  listUploads,
  logUpload,
  type Prog,
  type UploadLog,
  readBackupFile,
  restoreData,
  restoreSnapshot,
  type SnapshotMeta,
} from "@/lib/field/dataTools";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Section } from "./common";
import { ConfirmDialog, type ConfirmReq } from "./ConfirmDialog";

/**
 * Reads the first sheet. Values come back RAW (not Excel's display text) and are turned into clean strings here.
 * Display text turned 12-digit DT IDs into "5.01101E+11", which made every DT look like the same one.
 */
async function readSheet(file: File): Promise<Record<string, string | null>[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { cellDates: true });
  const raw = XLSX.utils.sheet_to_json<Record<string, any>>(wb.Sheets[wb.SheetNames[0]!]!, {
    defval: null,
    raw: true,
  });
  return raw.map((r) => {
    const o: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(r)) o[k] = cellText(v);
    return o;
  });
}
export function cellText(v: any): string | null {
  if (v == null) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString();
  if (typeof v === "number") return Number.isInteger(v) ? v.toFixed(0) : String(v);
  let s = String(v).trim();
  // Excel's text-forcing wrappers: ="501101202901"  /  '501101202901  /  stray quotes
  const wrapped = s.match(/^=\s*"(.*)"$/s);
  if (wrapped) s = wrapped[1]!.trim();
  else
    s = s
      .replace(/^'+/, "")
      .replace(/^"+|"+$/g, "")
      .trim();
  return s === "" ? null : s;
}
const SCI = /^\d+(\.\d+)?e\+?\d+$/i;
const key = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
function pick(row: Record<string, any>, ...names: string[]) {
  const want = names.map(key);
  for (const k of Object.keys(row))
    if (want.includes(key(k))) {
      const v = row[k];
      if (v != null && String(v).trim() !== "") return String(v).trim();
    }
  return null;
}
/** The capture time column: a known name, otherwise any column with "time" or "date" in its name (as the Dashboard does). */
function pickTime(row: Record<string, any>) {
  const direct = pick(row, "time", "captured_at", "datetime", "date_time", "capture_time", "created_at", "date");
  if (direct) return direct;
  const k = Object.keys(row).find((c) => /time|date/i.test(c) && row[c] != null && String(row[c]).trim() !== "");
  return k ? String(row[k]).trim() : null;
}
function pickUser(row: Record<string, any>) {
  const direct = pick(row, "username", "USER NAME", "USER");
  if (direct) return direct;
  const k = Object.keys(row).find((c) => /username/i.test(c) && row[c] != null && String(row[c]).trim() !== "");
  return k ? String(row[k]).trim() : null;
}
const compact = <T extends Record<string, any>>(o: T) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v != null)) as T;

/** The DT ID on a capture row: a DT_ID / DT ID / DSS ID column, otherwise the first filled column starting with dss_ (LT pole files carry it as the DSS ID). */
function rowDt(r: Record<string, any>): string | null {
  let dt = pick(r, "DT_ID", "DT ID", "DTID", "DSS_ID", "DSS ID", "DSSID");
  if (!dt) {
    const keys = Object.keys(r).filter((k) => k.toLowerCase().startsWith("dss_"));
    keys.sort((a, b) => Number(b.toLowerCase().startsWith("dss_fdr")) - Number(a.toLowerCase().startsWith("dss_fdr")));
    for (const k of keys) {
      const v = r[k];
      if (v != null && String(v).trim()) { dt = String(v).trim(); break; }
    }
  }
  return dt ? dt.replace(/\.0+$/, "") : null;
}
const rowFeeder = (r: Record<string, any>) => pick(r, "feeder", "FEEDER_ID", "FEEDER ID");

type CaptureType = "customer" | "ltpole";
const TYPE_LABEL: Record<CaptureType, string> = { customer: "customer enumeration", ltpole: "LT pole" };
type CheckReport = {
  label: string; type: CaptureType; rows: number; inScope: number; ignoredFeeders: [string, number][]; ignoredDate: number;
  flagged: [string, number][]; dtIds: string[]; from: string | null; to: string | null;
};

/** What a file holds before anything is saved: which feeders and which dates, and which of those are in the lookup. */
function scanRows(rows: Record<string, string | null>[], m: Model) {
  const feeders = new Map<string, number>();
  let from: string | null = null, to: string | null = null;
  for (const r of rows) {
    const dt = rowDt(r);
    const f = rowFeeder(r) ?? (dt ? m.dtById.get(dt)?.feeder_id : null) ?? "(no feeder)";
    feeders.set(f, (feeders.get(f) ?? 0) + 1);
    const at = parseCaptureTime(pickTime(r));
    const day = at?.slice(0, 10);
    if (day) { if (!from || day < from) from = day; if (!to || day > to) to = day; }
  }
  return { feeders: [...feeders.entries()].sort((a, b) => b[1] - a[1]), from, to };
}

/** Pick the feeders being worked on and, optionally, the dates. Everything uploaded for any other feeder is ignored. */
function ScopePanel({ m, compact = false }: { m: Model; compact?: boolean }) {
  const scope = useScope();
  const [q, setQ] = useState("");
  const ids = m.feeders.map((f) => f.feeder_id);
  const active = scopeFeederIds(scope, ids);
  const toggle = (id: string) => {
    const next = scope.feeders === null ? new Set([id]) : new Set(scope.feeders.filter((f) => ids.includes(f)));
    if (scope.feeders !== null) { if (next.has(id)) next.delete(id); else next.add(id); }
    setScope({ feeders: next.size === 0 || next.size === ids.length ? null : [...next] });
  };
  const list = m.feeders.filter((f) => !q || `${f.feeder_name} ${f.feeder_id}`.toLowerCase().includes(q.toLowerCase()));
  if (!ids.length) return <p className="text-sm text-destructive">Upload the Feeder &amp; DT lookup first. Only the feeders in it are worked on.</p>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <b>{scope.feeders === null ? `All ${ids.length} feeders in the lookup` : `${active.size} of ${ids.length} feeders`}</b>
        <Button size="sm" variant="outline" onClick={() => setScope({ feeders: null })} disabled={scope.feeders === null}>Use all</Button>
        <Input className="ml-auto w-48" placeholder="Find a feeder" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className={"flex flex-wrap gap-1 overflow-auto " + (compact ? "max-h-28" : "max-h-40")}>
        {list.map((f) => {
          const on = active.has(f.feeder_id) && scope.feeders !== null;
          return (
            <button key={f.feeder_id} onClick={() => toggle(f.feeder_id)} title={f.feeder_id}
              className={"rounded-full border px-2.5 py-1 text-xs font-bold " + (on ? "bg-foreground text-background" : scope.feeders === null ? "bg-muted" : "opacity-60 hover:opacity-100")}>
              {f.feeder_name} <span className="font-normal opacity-70">{f.feeder_id}</span>
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-bold">Dates</span>
        <Input type="date" className="w-40" value={scope.from} onChange={(e) => setScope({ from: e.target.value })} />
        <span>to</span>
        <Input type="date" className="w-40" value={scope.to} onChange={(e) => setScope({ to: e.target.value })} />
        <Button size="sm" variant="ghost" disabled={!scope.from && !scope.to} onClick={() => setScope({ from: "", to: "" })}>All dates</Button>
      </div>
    </div>
  );
}

/** Shown in the confirm box for the Dashboard check: what the saved data holds, and the same scope controls. */
function DashboardCheckBody({ m, got }: { m: Model; got: DashboardRows }) {
  const scope = useScope();
  const scans = (["customer", "ltpole"] as CaptureType[]).map((t) => ({ t, rows: got[t], scan: scanRows(got[t], m) })).filter((x) => x.rows.length);
  const lookup = new Set(m.feeders.map((f) => f.feeder_id));
  const focus = scopeFeederIds(scope, [...lookup]);
  return (
    <>
      {scans.map(({ t, rows, scan }) => (
        <div key={t} className="rounded-md border p-2">
          <div className="font-bold">{rows.length.toLocaleString()} {TYPE_LABEL[t]} rows{scan.from ? ` · ${scan.from === scan.to ? scan.from : `${scan.from} → ${scan.to}`}` : ""}</div>
          <div className="mt-1 flex flex-wrap gap-1 text-xs">
            {scan.feeders.slice(0, 24).map(([f, n]) => {
              const inLookup = lookup.has(f);
              const used = inLookup && focus.has(f);
              return <span key={f} className={"rounded border px-1.5 py-0.5 " + (used ? "border-success bg-success/15 font-bold" : "text-muted-foreground line-through")}>{m.feederById.get(f)?.feeder_name ?? f} · {n.toLocaleString()}{!inLookup ? " (not in lookup)" : ""}</span>;
            })}
          </div>
        </div>
      ))}
      <p className="text-xs text-muted-foreground">Feeders in green are checked. Rows on any other feeder are ignored, except where a DT from your feeders was captured under a wrong feeder, which is flagged.</p>
      <ScopePanel m={m} compact />
    </>
  );
}

export function UploadsTab({ m, goTo }: { m: Model; goTo?: (tab: string) => void }) {
  const refresh = useRefresh();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmReq, setConfirmReq] = useState<ConfirmReq | null>(null);
  const KINDS: Record<string, string> = {
    lookup: "Feeder & DT lookup",
    staff: "Enumerators",
    captures: "Customer captures",
    ltpole: "LT pole captures",
    points: "Customer points",
  };
  const totalCaptures = m.submissions.reduce((n, x) => n + x.count, 0);
  const totalPoles = m.ltSubmissions.reduce((n, x) => n + x.count, 0);
  const [reports, setReports] = useState<CheckReport[]>([]);
  const [snaps, setSnaps] = useState<SnapshotMeta[] | null>(null);
  const [snapErr, setSnapErr] = useState<string | null>(null);
  const [uploads, setUploads] = useState<UploadLog[]>([]);
  const [activity, setActivity] = useState<{
    state: "running" | "done" | "error";
    title: string;
    label: string;
    done: number;
    total: number;
  } | null>(null);
  const loadUploads = () =>
    listUploads()
      .then(setUploads)
      .catch(() => setUploads([]));

  const loadSnaps = () =>
    listSnapshots()
      .then((s) => {
        setSnaps(s);
        setSnapErr(null);
      })
      .catch((e) => {
        setSnaps([]);
        setSnapErr(e?.message ?? "Couldn't load restore points");
      });
  useEffect(() => {
    loadSnaps();
    loadUploads();
  }, []);

  const hasData = DATA_COLLECTIONS.some((c) => ((m as any)[c] as any[]).length > 0);

  /** Saves a restore point of everything currently in the app. Returns false if the person cancels. */
  async function restorePoint(label: string): Promise<boolean> {
    if (!hasData) return true;
    try {
      await createSnapshot(label, m);
      loadSnaps();
      return true;
    } catch (e: any) {
      return window.confirm(
        `Couldn't save a restore point (${e?.message ?? "unknown error"}).\n\nThis usually means the updated Firestore rules haven't been deployed yet.\n\nContinue WITHOUT a restore point?`,
      );
    }
  }

  const TITLES: Record<string, string> = {
    lookup: "Uploading feeder & DT lookup",
    staff: "Uploading enumerator list",
    enum: "Checking uploaded captures",
    points: "Uploading customer points",
    baseline: "Assigning DTs found in the upload",
    restore: "Restoring data",
    "clear-lookup": "Clearing feeder & DT lookup",
    "clear-staff": "Clearing enumerators",
    "clear-subs": "Clearing captures",
    "clear-points": "Clearing customer points",
    "clear-uploaded": "Clearing all uploaded data",
    "reset-all": "Resetting everything",
  };

  /** Runs a long task with a live progress banner, a toast and a result message that stays on screen. */
  async function run(name: string, fn: (p: Prog) => Promise<string>, snapLabel?: string) {
    const title = TITLES[name] ?? "Working";
    const prog: Prog = (label, done, total) =>
      setActivity({ state: "running", title, label, done, total });
    setBusy(name);
    setActivity({
      state: "running",
      title,
      label: snapLabel ? "Saving a restore point first…" : "Starting…",
      done: 0,
      total: 0,
    });
    try {
      if (snapLabel && !(await restorePoint(snapLabel))) {
        setActivity(null);
        return;
      }
      const msg = await fn(prog);
      toast.success(msg);
      setActivity({ state: "done", title, label: msg, done: 1, total: 1 });
      refresh();
      loadUploads();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
      setActivity({ state: "error", title, label: e?.message ?? "Failed", done: 0, total: 0 });
    } finally {
      setBusy(null);
    }
  }

  const ask = (req: ConfirmReq) => setConfirmReq(req);
  const download = (fn: () => number, what: string) => {
    try {
      toast.success(`Downloaded ${fn().toLocaleString()} ${what}`);
    } catch (e: any) {
      toast.error(e?.message ?? "Download failed");
    }
  };

  /* ---------- uploads ---------- */

  const lookup = (file: File) =>
    run(
      "lookup",
      async (p) => {
        p("Reading file…", 0, 0);
        const rows = await readSheet(file);
        const feeders = new Map<string, any>();
        const dts = new Map<string, any>();
        let cur: {
          id: string | null;
          name: string | null;
          area: string | null;
          type: string | null;
        } = { id: null, name: null, area: null, type: null };
        let dup = 0,
          noFeeder = 0,
          noDtId = 0;

        for (const r of rows) {
          const fid = pick(r, "FEEDER_ID", "FEEDER ID");
          const fname = pick(r, "FEEDER NAME", "FEEDER_NAME");
          const dtid = pick(r, "DT_ID", "DT ID");
          const dtname = pick(r, "DT_NAME", "DT NAME");
          if (!fid && !fname && !dtid && !dtname) continue; // blank formatted row

          // A feeder only has to be written once: later rows with the cells left blank (or merged) belong to the same feeder.
          if (fid) {
            if (fid !== cur.id)
              cur = {
                id: fid,
                name: fname,
                area: pick(r, "AREA"),
                type: pick(r, "FEEDER_TYPE", "FEEDER TYPE"),
              };
            else
              cur = {
                ...cur,
                name: fname ?? cur.name,
                area: pick(r, "AREA") ?? cur.area,
                type: pick(r, "FEEDER_TYPE", "FEEDER TYPE") ?? cur.type,
              };
          } else if (fname && fname !== cur.name) {
            const known = [...feeders.values()].find((f) => f.feeder_name === fname);
            cur = known
              ? {
                  id: known.feeder_id,
                  name: known.feeder_name,
                  area: known.area,
                  type: known.feeder_type,
                }
              : { id: null, name: fname, area: null, type: null };
          } else if (!cur.id) {
            noFeeder++;
            continue;
          }
          if (!cur.id) {
            noFeeder++;
            continue;
          }

          feeders.set(
            cur.id,
            compact({
              feeder_id: cur.id,
              feeder_name: cur.name ?? cur.id,
              area: cur.area,
              feeder_type: cur.type,
            }),
          );
          if (!dtid) {
            if (dtname) noDtId++;
            continue;
          }
          if (SCI.test(dtid))
            throw new Error(
              `DT_ID "${dtid}" is in scientific notation, so the real digits are lost. In Excel, format the DT_ID column as Number (0 decimals) or Text and save again.`,
            );
          if (dts.has(dtid)) dup++;
          dts.set(
            dtid,
            compact({
              dt_id: dtid,
              feeder_id: cur.id,
              dt_name: dtname,
              dt_type: pick(r, "DT_TYPE", "DT TYPE"),
            }),
          );
        }
        if (!feeders.size)
          throw new Error(
            "No feeders found. Check that the file has FEEDER_ID (or FEEDER NAME) and DT_ID columns.",
          );

        await upsertMany(
          "feeders",
          [...feeders.values()],
          (r) => r.feeder_id,
          (d, t) => p("Saving feeders", d, t),
        );
        await upsertMany(
          "dts",
          [...dts.values()],
          (r) => r.dt_id,
          (d, t) => p("Saving DTs", d, t),
        );
        await logUpload({
          kind: "lookup",
          filename: file.name,
          rows_read: rows.length,
          rows_with_dt: dts.size,
          saved: feeders.size + dts.size,
          users: 0,
          dts: dts.size,
          feeders: feeders.size,
          date_from: null,
          date_to: null,
          note: null,
        });
        const notes = [
          dup && `${dup} duplicate DT ID row${dup > 1 ? "s" : ""} merged`,
          noDtId && `${noDtId} row${noDtId > 1 ? "s" : ""} skipped (no DT_ID)`,
          noFeeder && `${noFeeder} row${noFeeder > 1 ? "s" : ""} skipped (no feeder)`,
        ].filter(Boolean);
        return `Loaded ${feeders.size} feeder${feeders.size > 1 ? "s" : ""} and ${dts.size} DTs${notes.length ? " · " + notes.join(" · ") : ""}`;
      },
      `Before lookup upload (${file.name})`,
    );

  /**
   * After a check: every DT on your feeders that has captures but nobody assigned on the app is assigned to the staff who
   * captured it and flagged "self-assigned" until a supervisor authorises it. Its status becomes Assigned, ready for
   * Completed etc. Every username that worked on a DT is saved on it, including supervisors and people who have left.
   * DTs already allocated are never changed, and locked feeders are only flagged.
   */
  const autoAssign = async (groups: any[]) => {
    const plan = planSelfAssign(m, groups, auth().currentUser?.uid ?? null);
    if (!plan.allocs.length && !plan.dtPatches.length) return;
    await run("baseline", async (p) => {
      if (plan.allocs.length) await addMany("allocations", plan.allocs, (d, t) => p("Assigning DTs to the staff who captured them", d, t));
      await patchMany("dts", plan.dtPatches);
      const bits = [
        `${plan.selfDts.length} DT${plan.selfDts.length === 1 ? "" : "s"} self-assigned (not assigned on the app, awaiting authorisation)`,
        plan.lockedSkipped.length && `${plan.lockedSkipped.length} on locked feeders only flagged`,
      ].filter(Boolean);
      return bits.join(" · ") || "Saved who worked on each DT";
    });
  };

  /** Asks whether to keep a restore point before the captures upload changes anything. */
  const askRestore = (file: File, legacyIds: string[], type: CaptureType) => {
    const go = (keep: boolean) => void doCaptures(file, legacyIds, keep, undefined, type).then((g) => g && autoAssign(g));
    if (!hasData) return go(false);
    ask({
      title: "Keep a restore point?",
      body: (
        <>
          <p>A restore point lets you undo this upload later, but it uses extra space on the database.</p>
          <p>Only the counts per feeder / DT and the captures with a problem are saved. All other rows in the file are discarded after checking.</p>
        </>
      ),
      confirmLabel: "Yes, keep restore point",
      alt: { label: "No, skip it", onClick: () => go(false) },
      onConfirm: () => go(true),
    });
  };

  const enumeration = (file: File) => {
    const legacy = m.submissions.filter((x) => x.day == null);
    if (!legacy.length) return void askRestore(file, [], "customer");
    ask({
      title: "Replace old-format captures?",
      body: (
        <>
          <p>Captures are now saved rolled up per enumerator, DT and day, so large files load quickly instead of saving one record per capture.</p>
          <p><b>{legacy.length.toLocaleString()}</b> old per-capture records are still saved. They will be deleted when this file is imported, so nothing is counted twice.</p>
        </>
      ),
      confirmLabel: "Continue with upload",
      onConfirm: () => askRestore(file, legacy.map((l) => l.id), "customer"),
    });
  };
  const ltPole = (file: File) => askRestore(file, [], "ltpole");

  /**
   * Checks one file (customer enumeration or LT pole). Only rows for the feeders chosen in Check scope (default: every feeder in the
   * lookup) are used; rows for any other feeder are ignored and counted. A DT from your feeders captured under the wrong feeder is flagged.
   * Returns the capture groups so the caller can assign DTs once every file is checked.
   */
  const doCaptures = async (
    file: File | null, legacyIds: string[], keepRestore: boolean,
    source?: { rows: Record<string, string | null>[]; label: string }, type: CaptureType = "customer",
  ): Promise<any[] | null> => {
    let groupsOut: any[] | null = null;
    const label = source?.label ?? file!.name;
    await run(
      "enum",
      async (p) => {
        p("Reading file…", 0, 0);
        const rows = source ? source.rows : await readSheet(file!);
        p(`Processing ${rows.length.toLocaleString()} rows…`, 0, 0);
        const lookupIds = m.feeders.map((f) => f.feeder_id);
        if (!lookupIds.length) throw new Error("Upload the Feeder & DT lookup first. Only the feeders in it are worked on.");
        const sc = getScope();
        const focus = scopeFeederIds(sc, lookupIds);
        if (!focus.size) throw new Error("None of the feeders chosen in Check scope are in the lookup. Choose feeders again.");
        const headers = rows[0] ? Object.keys(rows[0]) : [];
        const groups = new Map<string, any>();
        const issues = new Map<string, any>();
        const perKey = new Map<string, number>();
        const flagged = new Map<string, number>();
        const ignoredFeeders = new Map<string, number>();
        let rowsRead = 0, inScope = 0, ignoredDate = 0, withDt = 0;
        let dayMin: string | null = null, dayMax: string | null = null;
        let foundMin: string | null = null, foundMax: string | null = null;

        for (const r of rows) {
          const username = pickUser(r);
          const feeder = rowFeeder(r);
          const dt = rowDt(r);
          if (!username && !feeder && !dt) continue; // blank row
          rowsRead++;
          const at = parseCaptureTime(pickTime(r));
          const day = at ? at.slice(0, 10) : null;
          if (day) {
            if (!foundMin || day < foundMin) foundMin = day;
            if (!foundMax || day > foundMax) foundMax = day;
          }
          // Only the feeders being worked on: the row's own feeder, or the feeder its DT belongs to in the lookup.
          const dtRec = dt ? m.dtById.get(dt) : undefined;
          if (!((feeder && focus.has(feeder)) || (dtRec && focus.has(dtRec.feeder_id)))) {
            const f = feeder ?? dtRec?.feeder_id ?? "(no feeder or DT in the lookup)";
            ignoredFeeders.set(f, (ignoredFeeders.get(f) ?? 0) + 1);
            continue;
          }
          if (!inDateRange(day, sc)) { ignoredDate++; continue; }
          inScope++;
          if (dt) withDt++;
          if (day) {
            if (!dayMin || day < dayMin) dayMin = day;
            if (!dayMax || day > dayMax) dayMax = day;
          }
          const id = [(username ?? "").toLowerCase(), feeder ?? "", dt ?? "", day ?? ""].join("|");
          const gid = type === "ltpole" ? `lt|${id}` : id;
          let g = groups.get(gid);
          if (!g) groups.set(gid, (g = { id: gid, username, feeder_id: feeder, dt_id: dt, day, count: 0, captured_at: null, first_at: null, source: type }));
          g.count++;
          // Keep the row only when something is wrong with it, with the fields staff need to find it again.
          const reason = captureIssueReason(m, username, feeder, dt, day);
          if (reason) {
            flagged.set(reason, (flagged.get(reason) ?? 0) + 1);
            const cb = pick(r, "call_back_form_no", "CALL BACK FORM NO", "CALLBACK_FORM_NO", "call_back_form_number");
            const cust = pick(r, "customer_no", "CUSTOMER NO", "CUSTOMER_NUMBER", "customer_number");
            const bld = pick(r, "building_code", "BUILDING CODE", "BUILDING_CODE");
            const fid = pick(r, "FID");
            const structure = pick(r, "structure_", "structure", "structure_code", "structure_id");
            const ck = `${(username ?? "").toLowerCase()}|${dt ?? ""}|${reason}`;
            const seen = (perKey.get(ck) ?? 0) + 1;
            perKey.set(ck, seen);
            // At most 50 detailed rows per person, DT and problem; every row is still counted above.
            if (seen <= 50) {
              const iid = [type, (username ?? "").toLowerCase(), dt ?? "", fid ?? "", cb ?? "", cust ?? "", bld ?? "", structure ?? "", at ?? "", fid || cb || cust || bld || structure || at ? "" : String(issues.size)].join("|");
              issues.set(iid, { username, feeder_id: feeder, dt_id: dt, captured_at: at, reason, call_back_form_no: cb, customer_no: cust, building_code: bld, fid, structure, source: type, upload: label });
            }
          }
          if (at && (!g.captured_at || at > g.captured_at)) g.captured_at = at;
          if (at && (!g.first_at || at < g.first_at)) g.first_at = at;
        }

        const ign = [...ignoredFeeders.entries()].sort((a, b) => b[1] - a[1]);
        const ignTotal = ign.reduce((n, [, c]) => n + c, 0);
        if (!rowsRead) throw new Error("No capture rows found in that file.");
        if (!inScope)
          throw new Error(
            `None of the ${rowsRead.toLocaleString()} rows are on the feeders you are working on.${ign.length ? ` The file has rows for: ${ign.slice(0, 6).map(([f, c]) => `${f} (${c})`).join(", ")}${ign.length > 6 ? "…" : ""}.` : ""}${ignoredDate ? ` ${ignoredDate.toLocaleString()} row(s) were outside the dates chosen.` : ""} Change the feeders or dates in Check scope.`,
          );
        if (!withDt)
          throw new Error(
            `No DT IDs found, so nothing was imported. Columns in your file: ${headers.slice(0, 14).join(", ")}${headers.length > 14 ? "…" : ""}. Add a column named DT_ID (or DT ID / DSS_ID), or one starting with dss_.`,
          );
        const list = [...groups.values()];
        const sci = list.find((g) => g.dt_id && SCI.test(g.dt_id));
        if (sci)
          throw new Error(
            `DT ID "${sci.dt_id}" is in scientific notation, so the real digits are lost and nothing was imported. Re-export the file with the DT ID column kept as text (or as ="501101202901") and upload again.`,
          );

        if (legacyIds.length) await removeMany("submissions", legacyIds, (d, t) => p("Removing old-format captures", d, t));
        await upsertMany("submissions", list, (g) => g.id, (d, t) => p("Saving captures", d, t));
        if (issues.size)
          await upsertMany("capture_issues", [...issues.entries()].map(([id, v]) => ({ ...v, _key: id })), (g) => g._key, (d, t) => p("Saving captures with problems", d, t));
        const flaggedTotal = [...flagged.values()].reduce((n, c) => n + c, 0);
        await logUpload({
          kind: type === "ltpole" ? "ltpole" : "captures",
          filename: label,
          rows_read: rowsRead,
          rows_with_dt: withDt,
          saved: list.length,
          users: new Set(list.map((g) => (g.username ?? "").toLowerCase())).size,
          dts: new Set(list.filter((g) => g.dt_id).map((g) => g.dt_id)).size,
          feeders: new Set(list.filter((g) => g.feeder_id).map((g) => g.feeder_id)).size,
          date_from: dayMin,
          date_to: dayMax,
          note: [flaggedTotal && `${flaggedTotal} flagged`, ignTotal && `${ignTotal} on other feeders ignored`, ignoredDate && `${ignoredDate} outside dates ignored`].filter(Boolean).join(" · ") || null,
        });
        setReports((prev) => [
          { label, type, rows: rowsRead, inScope, ignoredFeeders: ign, ignoredDate, flagged: [...flagged.entries()].sort((a, b) => b[1] - a[1]), dtIds: [...new Set(list.map((g) => g.dt_id).filter(Boolean))] as string[], from: foundMin, to: foundMax },
          ...prev.filter((x) => x.type !== type),
        ]);
        groupsOut = list.map((g) => ({ ...g, captured_at: g.first_at }));
        return `Checked ${inScope.toLocaleString()} ${TYPE_LABEL[type]} row${inScope === 1 ? "" : "s"} on your feeders, ${flaggedTotal.toLocaleString()} flagged${ignTotal ? ` · ${ignTotal.toLocaleString()} on other feeders ignored` : ""}${ignoredDate ? ` · ${ignoredDate.toLocaleString()} outside the dates ignored` : ""}. Re-uploading the same file updates, not duplicates.`;
      },
      keepRestore ? `Before ${TYPE_LABEL[type]} upload (${label})` : undefined,
    );
    return groupsOut;
  };

  async function useDashboardUpload() {
    setBusy("dash");
    try {
      const got = await fetchDashboardRows();
      if (!got.customer.length && !got.ltpole.length) {
        toast.error("The Dashboard has no Customer Enumeration or LT Pole rows saved in the cloud yet. Upload the files there under Upload Data Files and click Save to Cloud.");
        return;
      }
      const when = got.savedAt ? new Date(got.savedAt).toLocaleString() : "unknown time";
      ask({
        title: "Check the Dashboard's uploaded data?",
        body: (
          <>
            <p>Saved from the Dashboard ({when}). Choose the feeders and dates to check below. Captures are matched to who is assigned on the app; anyone else is flagged and DTs nobody had assigned are assigned to the person who captured them, awaiting your authorisation.</p>
            <DashboardCheckBody m={m} got={got} />
          </>
        ),
        confirmLabel: "Check and import",
        onConfirm: async () => {
          const all: any[] = [];
          for (const [rows, type, name] of [[got.customer, "customer", "Dashboard customer enumeration"], [got.ltpole, "ltpole", "Dashboard LT pole"]] as const) {
            if (!rows.length) continue;
            const g = await doCaptures(null, [], false, { rows, label: `${name} (${when})` }, type);
            if (g) all.push(...g);
          }
          if (all.length) await autoAssign(all);
        },
      });
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't read the Dashboard upload");
    } finally {
      setBusy(null);
    }
  }

  const staff = (file: File) =>
    run(
      "staff",
      async (p) => {
        p("Reading file…", 0, 0);
        const rows = await readSheet(file);
        const list = rows
          .map((r) => ({
            username: pick(r, "USERNAME", "USER NAME", "USER"),
            full_name: pick(r, "FULL_NAME", "NAME", "FULL NAME"),
            phone: pick(r, "PHONE", "PHONE NUMBER", "MOBILE"),
            supervisor: pick(r, "SUPERVISOR"),
          }))
          .filter((x) => x.username);
        await upsertMany(
          "enumerators",
          list.map((x) => ({ ...x, username: x.username!.trim(), active: true })),
          (r) => r.username.toLowerCase(),
          (d, t) => p("Saving enumerators", d, t),
        );
        await logUpload({
          kind: "staff",
          filename: file.name,
          rows_read: rows.length,
          rows_with_dt: 0,
          saved: list.length,
          users: list.length,
          dts: 0,
          feeders: 0,
          date_from: null,
          date_to: null,
          note: null,
        });
        return `Loaded ${list.length} enumerators`;
      },
      `Before enumerator upload (${file.name})`,
    );

  const points = (file: File) =>
    run(
      "points",
      async (p) => {
        p("Reading file…", 0, 0);
        const rows = await readSheet(file);
        let n = 0;
        for (const r of rows) {
          const fid = pick(r, "FEEDER_ID", "FEEDER");
          const pts = pick(
            r,
            "EST_CUSTOMER_POINTS",
            "CUSTOMER_POINTS",
            "ESTIMATED_CUSTOMERS",
            "COUNT",
            "TOTAL",
            "POINTS",
          );
          if (!fid || !pts) continue;
          if (!m.feederById.has(fid)) continue;
          await updateRow("feeders", safeId(fid), {
            est_customer_points: Math.round(Number(pts.replace(/,/g, ""))),
          });
          n++;
        }
        await logUpload({
          kind: "points",
          filename: file.name,
          rows_read: rows.length,
          rows_with_dt: 0,
          saved: n,
          users: 0,
          dts: 0,
          feeders: n,
          date_from: null,
          date_to: null,
          note: null,
        });
        return `Updated estimated customer points for ${n} feeders`;
      },
      `Before customer points upload (${file.name})`,
    );

  /* ---------- clears (each asks first and saves a restore point) ---------- */

  const undoNote = (
    <p className="text-muted-foreground">
      A restore point is saved first, so you can undo this under <b>Data management</b> below.
    </p>
  );
  const clearer =
    (
      id: string,
      title: string,
      body: React.ReactNode,
      fn: (p: Prog) => Promise<number>,
      label: string,
      typed?: string,
    ) =>
    () =>
      ask({
        title,
        body: (
          <>
            {body}
            {undoNote}
          </>
        ),
        confirmLabel: "Clear",
        danger: true,
        ...(typed ? { typeToConfirm: typed } : {}),
        onConfirm: () =>
          run(id, async (p) => `Cleared ${(await fn(p)).toLocaleString()} record(s)`, label),
      });

  const clearLookupAsk = clearer(
    "clear-lookup",
    "Clear feeder & DT lookup?",
    <p>
      This deletes all <b>{m.feeders.length}</b> feeders and <b>{m.dts.length}</b> DTs. DT statuses
      are lost. Allocations are kept and re-link if you upload a lookup with the same DT IDs.
    </p>,
    clearLookup,
    "Before clearing lookup",
  );
  const clearStaffAsk = clearer(
    "clear-staff",
    "Clear enumerator list?",
    <p>
      This deletes all <b>{m.enumerators.length}</b> enumerators. Login accounts are not affected.
    </p>,
    clearStaff,
    "Before clearing enumerators",
  );
  const clearCapturesAsk = clearer(
    "clear-subs",
    "Clear all captures?",
    <p>
      This deletes all <b>{totalCaptures.toLocaleString()}</b> customer captures and <b>{totalPoles.toLocaleString()}</b> LT pole captures, and the flagged rows. Allocations stay.
    </p>,
    clearCaptures,
    "Before clearing captures",
  );
  const clearLtAsk = clearer(
    "clear-subs",
    "Clear LT pole captures?",
    <p>This deletes the <b>{totalPoles.toLocaleString()}</b> LT pole captures and their flagged rows. Customer captures stay.</p>,
    clearLtPoles,
    "Before clearing LT poles",
  );
  const clearPointsAsk = clearer(
    "clear-points",
    "Clear estimated customer points?",
    <p>This removes the estimated customer points from all feeders.</p>,
    clearPoints,
    "Before clearing customer points",
  );

  const clearUploadedAsk = clearer(
    "clear-uploaded",
    "Clear ALL uploaded data?",
    <p>
      This deletes the lookup (feeders &amp; DTs), enumerator list and captures. Allocations,
      vehicles and trips are kept.
    </p>,
    (p) => clearCollections(UPLOADED_COLLECTIONS, p),
    "Before clearing all uploaded data",
    "CLEAR",
  );
  const resetAllAsk = clearer(
    "reset-all",
    "Reset the whole app data?",
    <p>
      This deletes <b>everything</b>: lookup, enumerators, captures, allocations, vehicles and
      trips. User accounts and logins are kept.
    </p>,
    (p) => clearCollections(DATA_COLLECTIONS, p),
    "Before full reset",
    "RESET",
  );

  async function saveNow() {
    setBusy("snap");
    try {
      await createSnapshot(`Manual restore point`, m);
      toast.success("Restore point saved");
      loadSnaps();
    } catch (e: any) {
      toast.error(
        `Couldn't save: ${e?.message ?? "error"}. Deploy the updated firestore.rules and try again.`,
      );
    } finally {
      setBusy(null);
    }
  }

  const restoreAsk = (s: SnapshotMeta) =>
    ask({
      title: "Go back to this restore point?",
      body: (
        <>
          <p>
            <b>{s.label}</b> · {new Date(s.created_at).toLocaleString()}
          </p>
          <p>
            It holds{" "}
            {Object.entries(s.counts)
              .filter(([, n]) => n)
              .map(([k, n]) => `${n.toLocaleString()} ${k}`)
              .join(", ") || "no data"}
            .
          </p>
          <p className="text-destructive font-bold">
            Everything currently in the app is replaced by this version.
          </p>
          {undoNote}
        </>
      ),
      confirmLabel: "Restore",
      danger: true,
      onConfirm: () =>
        run(
          "restore",
          async (p) => {
            const n = await restoreSnapshot(s.id, p);
            return `Restored ${n.toLocaleString()} records`;
          },
          "Before restoring a restore point",
        ),
    });

  const deleteSnapAsk = (s: SnapshotMeta) =>
    ask({
      title: "Delete this restore point?",
      body: (
        <p>
          {s.label} · {new Date(s.created_at).toLocaleString()}
        </p>
      ),
      confirmLabel: "Delete",
      danger: true,
      onConfirm: async () => {
        try {
          await deleteSnapshot(s.id);
          toast.success("Restore point deleted");
          loadSnaps();
        } catch (e: any) {
          toast.error(e?.message ?? "Failed");
        }
      },
    });

  async function restoreFromFile(file: File) {
    try {
      const data = await readBackupFile(file);
      ask({
        title: "Restore from backup file?",
        body: (
          <>
            <p>{file.name}</p>
            <p className="text-destructive font-bold">
              Everything currently in the app is replaced by the contents of this file.
            </p>
            {undoNote}
          </>
        ),
        confirmLabel: "Restore",
        danger: true,
        onConfirm: () =>
          run(
            "restore",
            async (p) => `Restored ${(await restoreData(data, p)).toLocaleString()} records`,
            "Before restoring from file",
          ),
      });
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't read that file");
    }
  }

  /* ---------- layout ---------- */

  const card = (
    id: string,
    title: string,
    desc: React.ReactNode,
    onFile: (f: File) => void,
    count: number,
    onDownload: () => void,
    onClear: () => void,
  ) => (
    <Section title={title}>
      <div className="text-sm text-muted-foreground mb-3">{desc}</div>
      <label className="flex cursor-pointer items-center justify-center rounded-md border-2 border-dashed border-input p-6 text-sm font-bold hover:border-accent">
        {busy === id ? "Working…" : "Choose Excel / CSV file"}
        <input
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          disabled={!!busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            e.target.value = "";
          }}
        />
      </label>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={!count || !!busy} onClick={onDownload}>
          <Download /> Download current data
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive"
          disabled={!count || !!busy}
          onClick={onClear}
        >
          <Trash2 /> Clear
        </Button>
      </div>
    </Section>
  );

  const counts = `${m.feeders.length} feeders · ${m.dts.length} DTs · ${m.enumerators.length} enumerators · ${totalCaptures.toLocaleString()} customer captures · ${totalPoles.toLocaleString()} LT pole captures · ${m.allocations.length} allocations · ${m.vehicles.length} vehicles · ${m.trips.length} trips`;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {activity && (
        <div
          className={
            "md:col-span-2 rounded-md border p-3 text-sm " +
            (activity.state === "error"
              ? "border-destructive bg-destructive/10"
              : activity.state === "done"
                ? "border-success bg-success/10"
                : "border-accent bg-accent/10")
          }
        >
          <div className="flex items-start gap-2">
            {activity.state === "running" && <Loader2 className="mt-0.5 h-4 w-4 animate-spin" />}
            {activity.state === "done" && <CheckCircle2 className="mt-0.5 h-4 w-4 text-success" />}
            {activity.state === "error" && <XCircle className="mt-0.5 h-4 w-4 text-destructive" />}
            <div className="flex-1">
              <div className="font-bold">
                {activity.state === "running"
                  ? activity.title + "…"
                  : activity.state === "done"
                    ? "Finished: " + activity.title
                    : "Failed: " + activity.title}
              </div>
              <div className="text-muted-foreground">
                {activity.label}
                {activity.state === "running" && activity.total > 0 && (
                  <>
                    {" "}
                    · {activity.done.toLocaleString()} / {activity.total.toLocaleString()} (
                    {Math.round((activity.done / activity.total) * 100)}%)
                  </>
                )}
              </div>
              {activity.state === "running" && (
                <div className="mt-2 h-2 overflow-hidden rounded bg-muted">
                  <div
                    className={
                      "h-full bg-accent transition-all " +
                      (activity.total ? "" : "w-1/3 animate-pulse")
                    }
                    style={
                      activity.total
                        ? { width: `${Math.max(3, (activity.done / activity.total) * 100)}%` }
                        : undefined
                    }
                  />
                </div>
              )}
            </div>
            {activity.state !== "running" && (
              <button onClick={() => setActivity(null)} aria-label="Dismiss">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      )}
      <div className="md:col-span-2">
        <Section title="Check scope: feeders & dates being worked on">
          <p className="mb-3 text-sm text-muted-foreground">
            Only the feeders in the uploaded lookup are worked on, and you choose which of them are current. Every upload and every Dashboard check below ignores rows for any other feeder, and a DT from these feeders captured under a wrong feeder is flagged. Leave the dates empty to check every date in the file.
          </p>
          <ScopePanel m={m} />
        </Section>
      </div>
      {card(
        "lookup",
        "1. Feeder & DT lookup",
        <>
          Columns: <b>FEEDER NAME, FEEDER_ID, AREA, FEEDER_TYPE, DT_NAME, DT_ID, DT_TYPE</b>. A
          feeder can be written once with its DTs listed under it (blank feeder cells are filled
          down). Existing allocations and statuses are kept. Now: {m.feeders.length} feeders,{" "}
          {m.dts.length} DTs.
        </>,
        lookup,
        m.feeders.length + m.dts.length,
        () => download(() => downloadLookup(m), "rows"),
        clearLookupAsk,
      )}
      {card(
        "staff",
        "2. Enumerator list",
        <>
          Columns: <b>USERNAME</b> (must match the capture app username),{" "}
          <b>FULL_NAME, PHONE, SUPERVISOR</b>. Now: {m.enumerators.length} enumerators.
        </>,
        staff,
        m.enumerators.length,
        () => download(() => downloadStaff(m), "enumerators"),
        clearStaffAsk,
      )}
      {card(
        "enum",
        "3. Customer enumeration",
        <>
          The field export. Uses <b>username, feeder, time</b> and the DT ID from a column named <b>DT_ID</b> / <b>DT ID</b> (or the first filled column starting with <b>dss_</b>). Also reads <b>FID, building_code, structure_, customer_no</b> when present, to return them for anything flagged. Now: {totalCaptures.toLocaleString()} customers ({m.submissions.length.toLocaleString()} saved rows).
        </>,
        enumeration,
        m.submissions.length,
        () => download(() => downloadCaptures(m), "captures"),
        clearCapturesAsk,
      )}
      {card(
        "ltpole",
        "3a. LT Pole",
        <>
          Upload it with the customer file: both carry the DT ID (<b>DSS_ID / DT_ID</b>), so the same checks apply and the person who captured each pole is matched to who is assigned that DT. LT poles are kept apart and never counted as customers. Now: {totalPoles.toLocaleString()} LT pole captures.
        </>,
        ltPole,
        m.ltSubmissions.length,
        () => download(() => downloadCaptures(m), "captures"),
        clearLtAsk,
      )}
      <div className="md:col-span-2">
        <Section title="3b. Or use the Dashboard's upload">
          <p className="mb-3 text-sm text-muted-foreground">
            No need to upload the same files twice. In the Dashboard, upload <b>Customer Enumeration</b> and <b>LT Pole</b> under <b>Upload Data Files</b> and click <b>Save to Cloud</b>, then press the button here. You pick the feeders and dates to check, only those feeders are worked on, and every DT found is listed below with who worked on it and whether it was assigned on the app.
          </p>
          <Button onClick={useDashboardUpload} disabled={!!busy}>
            {busy === "dash" ? "Reading the Dashboard upload…" : "Check the Dashboard's Customer Enumeration + LT Pole upload"}
          </Button>
        </Section>
      </div>
      {card(
        "points",
        "4. Estimated customer points",
        <>
          Columns: <b>FEEDER_ID</b> and <b>EST_CUSTOMER_POINTS</b> (or COUNT / TOTAL). Used for
          completion projections. You can also edit these in Projections.
        </>,
        points,
        m.feeders.filter((f) => f.est_customer_points != null).length,
        () => download(() => downloadPoints(m), "feeders"),
        clearPointsAsk,
      )}

      {reports.length > 0 && (
        <div className="md:col-span-2">
          <Section title="Last check: DTs found" actions={goTo && <Button size="sm" variant="outline" onClick={() => goTo("alerts")}>Open Capture Alerts →</Button>}>
            <div className="mb-3 grid gap-2 md:grid-cols-2">
              {reports.map((r) => (
                <div key={r.type} className="rounded-md border p-3 text-sm">
                  <div className="font-bold">{TYPE_LABEL[r.type]} · {r.label}</div>
                  <div className="text-muted-foreground">
                    {r.inScope.toLocaleString()} of {r.rows.toLocaleString()} rows were on your feeders{r.from ? ` · dates in file ${r.from === r.to ? r.from : `${r.from} → ${r.to}`}` : ""}
                  </div>
                  {r.ignoredFeeders.length > 0 && (
                    <div className="mt-1 text-xs"><b>Ignored (other feeders):</b> {r.ignoredFeeders.slice(0, 8).map(([f, n]) => `${f} (${n.toLocaleString()})`).join(", ")}{r.ignoredFeeders.length > 8 ? "…" : ""}</div>
                  )}
                  {r.ignoredDate > 0 && <div className="mt-1 text-xs"><b>Ignored (outside dates):</b> {r.ignoredDate.toLocaleString()}</div>}
                  {r.flagged.length > 0 ? (
                    <div className="mt-1 text-xs text-destructive"><b>Flagged:</b> {r.flagged.map(([why, n]) => `${why} (${n.toLocaleString()})`).join(" · ")}</div>
                  ) : <div className="mt-1 text-xs text-success">Nothing flagged.</div>}
                </div>
              ))}
            </div>
            <DtWorkTable m={m} onlyDts={new Set(reports.flatMap((r) => r.dtIds))} defaultFilter="all" />
          </Section>
        </div>
      )}

      <div className="md:col-span-2">
        <Section
          title="Upload history"
          actions={
            <span className="text-xs text-muted-foreground">
              Only a summary of each upload is kept here
            </span>
          }
        >
          {uploads.length === 0 ? (
            <p className="text-sm text-muted-foreground">No uploads logged yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="p-2">When</th>
                    <th>Type</th>
                    <th>File</th>
                    <th>Rows read</th>
                    <th>With DT ID</th>
                    <th>Saved as</th>
                    <th>Staff</th>
                    <th>DTs</th>
                    <th>Dates</th>
                    <th>By</th>
                  </tr>
                </thead>
                <tbody>
                  {uploads.map((u) => (
                    <tr key={u.id} className="border-t">
                      <td className="p-2 whitespace-nowrap">
                        {new Date(u.created_at).toLocaleString()}
                      </td>
                      <td className="font-bold">{KINDS[u.kind] ?? u.kind}</td>
                      <td className="max-w-48 truncate" title={u.filename}>
                        {u.filename}
                      </td>
                      <td>{u.rows_read.toLocaleString()}</td>
                      <td>{u.kind === "captures" ? u.rows_with_dt.toLocaleString() : "—"}</td>
                      <td>{u.saved.toLocaleString()}</td>
                      <td>{u.users || "—"}</td>
                      <td>{u.dts || "—"}</td>
                      <td className="whitespace-nowrap text-xs">
                        {u.date_from
                          ? u.date_from === u.date_to
                            ? u.date_from
                            : `${u.date_from} → ${u.date_to}`
                          : "—"}
                      </td>
                      <td className="text-xs">{u.uploaded_by ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>

      <div className="md:col-span-2">
        <Section
          title="Data management"
          actions={<span className="text-xs text-muted-foreground">{counts}</span>}
        >
          <p className="mb-3 text-sm text-muted-foreground">
            A restore point is saved automatically before every upload, clear or restore. Use the
            list below to go back to how things were before any of them.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" disabled={!!busy || !hasData} onClick={saveNow}>
              <Save /> Save restore point now
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!hasData}
              onClick={() => {
                downloadFullBackup(m);
                toast.success("Backup downloaded");
              }}
            >
              <Download /> Download full backup (.json)
            </Button>
            <label
              className={`inline-flex h-8 cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-muted ${busy ? "pointer-events-none opacity-50" : ""}`}
            >
              <History className="h-4 w-4" /> Restore from backup file
              <input
                type="file"
                accept=".json,application/json"
                className="hidden"
                disabled={!!busy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) restoreFromFile(f);
                  e.target.value = "";
                }}
              />
            </label>
            <Button
              variant="destructive"
              size="sm"
              disabled={!!busy || !hasData}
              onClick={clearUploadedAsk}
            >
              <Trash2 /> Clear all uploaded data
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={!!busy || !hasData}
              onClick={resetAllAsk}
            >
              <Trash2 /> Reset everything
            </Button>
          </div>
          <ul className="mt-2 text-xs text-muted-foreground">
            <li>
              <b>Clear all uploaded data</b>: lookup, enumerators and captures. Keeps allocations,
              vehicles, trips.
            </li>
            <li>
              <b>Reset everything</b>: all of the above plus allocations, vehicles and trips. Logins
              are never touched.
            </li>
          </ul>

          <h3 className="mt-5 mb-2 font-display text-sm font-bold uppercase tracking-wide">
            Restore points
          </h3>
          {snapErr && (
            <p className="mb-2 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
              Restore points unavailable: {snapErr}. Deploy the updated <code>firestore.rules</code>{" "}
              (firebase deploy --only firestore:rules).
            </p>
          )}
          {snaps === null ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : snaps.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              None yet. One is created automatically the next time you upload or clear something.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="p-2">When</th>
                    <th>What</th>
                    <th>Contents</th>
                    <th>By</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {snaps.map((s) => (
                    <tr key={s.id} className="border-t">
                      <td className="p-2 whitespace-nowrap">
                        {new Date(s.created_at).toLocaleString()}
                      </td>
                      <td className="font-bold">{s.label}</td>
                      <td className="text-xs text-muted-foreground">
                        {s.counts["feeders"] ?? 0} feeders · {s.counts["dts"] ?? 0} DTs ·{" "}
                        {(s.counts["submissions"] ?? 0).toLocaleString()} captures ·{" "}
                        {s.counts["allocations"] ?? 0} allocations
                      </td>
                      <td className="text-xs">{s.created_by ?? ""}</td>
                      <td className="whitespace-nowrap text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!!busy}
                          onClick={() => restoreAsk(s)}
                        >
                          <History /> Restore
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive"
                          disabled={!!busy}
                          onClick={() => deleteSnapAsk(s)}
                        >
                          <Trash2 />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>
      <ConfirmDialog req={confirmReq} onClose={() => setConfirmReq(null)} />
    </div>
  );
}
