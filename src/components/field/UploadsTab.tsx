import { useEffect, useState } from "react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { CheckCircle2, Download, History, Loader2, Save, Trash2, X, XCircle } from "lucide-react";
import { addMany, patchMany, removeMany, updateRow, upsertMany, safeId } from "@/lib/field/db";
import { auth } from "@/lib/field/firebase";
import { useRefresh, type Model } from "@/lib/field/data";
import { analyzeCaptures, mergeWorkers, scanFeeders, type Analysis, type CaptureInput, type ReportKind } from "@/lib/field/captureEngine";
import { buildPairTeams } from "@/lib/field/pairings";
import { fetchPairingsRaw } from "@/lib/field/pairingsApi";
import { parseCaptureTime } from "@/lib/field/dates";
import { fetchDashboardCaptureRows } from "@/lib/field/dashboardSync";
import {
  UPLOADED_COLLECTIONS,
  DATA_COLLECTIONS,
  clearCaptures,
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
  downloadSheet,
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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

export function UploadsTab({ m, goTo }: { m: Model; goTo?: (tab: string) => void }) {
  const refresh = useRefresh();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmReq, setConfirmReq] = useState<ConfirmReq | null>(null);
  const KINDS: Record<string, string> = {
    lookup: "Feeder & DT lookup",
    staff: "Enumerators",
    captures: "Captures",
    points: "Customer points",
  };
  const totalCaptures = m.customerSubmissions.reduce((n, x) => n + x.count, 0);
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
    enum: "Uploading enumeration captures",
    points: "Uploading customer points",
    baseline: "Assigning DTs",
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

  /* ---------- Captures: Customer Enumeration + LT Pole (both carry the DT ID) ---------- */
  const [capFiles, setCapFiles] = useState<{ customer?: File; lt?: File }>({});
  const [scopeReq, setScopeReq] = useState<{ inputs: CaptureInput[]; scan: ReturnType<typeof scanFeeders> } | null>(null);
  const [checkReport, setCheckReport] = useState<{ a: Analysis; label: string; feeders: string[]; from: string | null; to: string | null } | null>(null);

  /** First look at the rows: sanity checks, then ask which feeders and dates to work on. */
  function startCheck(inputs: CaptureInput[]) {
    const scan = scanFeeders(inputs, m);
    if (!scan.rows) return void toast.error("No capture rows found.");
    if (!scan.withDt) {
      return void toast.error(
        `No DT IDs found, so nothing was imported. Columns in your file: ${scan.columns.slice(0, 14).join(", ")}${scan.columns.length > 14 ? "…" : ""}. Add a column named DT_ID (or DT ID), or one starting with dss_.`,
      );
    }
    if (scan.sci)
      return void toast.error(
        `DT ID "${scan.sci}" is in scientific notation, so the real digits are lost and nothing was imported. Re-export the file with the DT ID column kept as text (or as ="501101202901") and upload again.`,
      );
    if (!m.feeders.length) return void toast.error("Upload the feeder & DT lookup first: captures are checked against it.");
    setScopeReq({ inputs, scan });
  }

  async function checkFiles() {
    setBusy("enum");
    try {
      const inputs: CaptureInput[] = [];
      if (capFiles.customer) inputs.push({ source: "customer", label: capFiles.customer.name, rows: await readSheet(capFiles.customer) });
      if (capFiles.lt) inputs.push({ source: "lt", label: capFiles.lt.name, rows: await readSheet(capFiles.lt) });
      if (!inputs.length) return void toast.error("Choose a Customer Enumeration file, an LT Pole file, or both.");
      startCheck(inputs);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't read the file");
    } finally {
      setBusy(null);
    }
  }

  async function useDashboardUpload() {
    setBusy("dash");
    try {
      const got = await fetchDashboardCaptureRows();
      if (!got.customer.length && !got.lt.length) {
        toast.error("The Dashboard has no Customer Enumeration or LT Pole rows saved in the cloud yet. Upload them there under Upload Data Files and click Save to Cloud.");
        return;
      }
      const when = got.savedAt ? new Date(got.savedAt).toLocaleString() : "unknown time";
      const inputs: CaptureInput[] = [];
      if (got.customer.length) inputs.push({ source: "customer", label: `Dashboard Customer Enumeration (${when})`, rows: got.customer });
      if (got.lt.length) inputs.push({ source: "lt", label: `Dashboard LT Pole (${when})`, rows: got.lt });
      startCheck(inputs);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't read the Dashboard upload");
    } finally {
      setBusy(null);
    }
  }

  /** Runs the check with the chosen feeders and dates, then saves what it found. */
  async function applyCheck(inputs: CaptureInput[], choice: { feeders: string[]; from: string | null; to: string | null; lock: boolean; restore: boolean }) {
    setScopeReq(null);
    const label = inputs.map((i) => i.label).join(" + ");
    let result: Analysis | null = null;
    await run(
      "enum",
      async (p) => {
        p("Checking captures…", 0, 0);
        let pairs: ReturnType<typeof buildPairTeams> = [];
        try { pairs = buildPairTeams(await fetchPairingsRaw(), m.enumerators); } catch { /* partner notes are optional */ }
        const a = analyzeCaptures({ inputs, m, scope: { feeders: choice.feeders, from: choice.from, to: choice.to }, pairs });
        if (!a.stats.inScope && !a.issues.length)
          throw new Error(`Nothing to import: none of the ${a.stats.rowsRead.toLocaleString()} rows were on the chosen feeders and dates${a.stats.ignoredNotInLookup ? ` (${a.stats.ignoredNotInLookup.toLocaleString()} are on feeders that are not in your lookup)` : ""}.`);

        const legacy = m.submissions.filter((x) => x.day == null).map((x) => x.id);
        if (legacy.length) await removeMany("submissions", legacy, (d, t) => p("Removing old-format captures", d, t));
        if (a.groups.length)
          await upsertMany("submissions", a.groups, (g) => g.id, (d, t) => p("Saving captures", d, t));
        if (a.issues.length)
          await upsertMany(
            "capture_issues",
            a.issues.map(({ key, ...v }) => ({ ...v, upload: v.upload, _key: key })),
            (g) => g._key,
            (d, t) => p("Saving flagged captures", d, t),
          );

        // Self-assign: a DT nobody was assigned on the app, but a staff member captured on it.
        const uid = auth().currentUser?.uid ?? null;
        const today = new Date().toISOString().slice(0, 10);
        if (a.selfAssign.length)
          await addMany(
            "allocations",
            a.selfAssign.map((s) => ({
              dt_id: s.dt.dt_id, enumerator_id: s.enumerator.id, allocated_on: (s.first ?? today).slice(0, 10), due_date: null,
              notes: "Self-assigned: captured on this DT before it was assigned on the app. Awaiting authorization.",
              allocated_by: uid, status: "active", completed_on: null, self_assigned: true, authorized: false,
            })),
            (d, t) => p("Self-assigning DTs", d, t),
          );

        // Remember every username on every DT it was captured on, and move self-assigned DTs to "assigned".
        const selfDts = new Set(a.selfAssign.map((s) => s.dt.dt_id));
        const patches: { id: string; patch: Record<string, any> }[] = [];
        for (const [dtId, found] of a.workers) {
          const dt = m.dtById.get(dtId);
          if (!dt) continue;
          const merged = mergeWorkers(dt.workers, found);
          const changed = JSON.stringify(merged) !== JSON.stringify(dt.workers ?? []);
          const assign = selfDts.has(dtId) && dt.status === "unassigned";
          if (!changed && !assign) continue;
          patches.push({ id: dt.id, patch: { workers: merged, ...(assign ? { status: "assigned", status_note: null, updated_at: new Date().toISOString() } : {}) } });
        }
        if (patches.length) await patchMany("dts", patches);
        if (choice.lock)
          await patchMany("feeders", choice.feeders.map((f) => m.feederById.get(f)).filter((f) => f && !f.locked).map((f) => ({ id: f!.id, patch: { locked: true } })));

        await logUpload({
          kind: "captures", filename: label, rows_read: a.stats.rowsRead, rows_with_dt: a.stats.withDt, saved: a.groups.length,
          users: new Set(a.groups.map((g) => (g.username ?? "").toLowerCase())).size, dts: new Set(a.groups.filter((g) => g.dt_id).map((g) => g.dt_id)).size,
          feeders: choice.feeders.length, date_from: choice.from ?? a.stats.dayMin, date_to: choice.to ?? a.stats.dayMax,
          note: [a.issues.length && `${a.issues.length} flagged`, a.selfAssign.length && `${selfDts.size} DT(s) self-assigned`].filter(Boolean).join(" · ") || null,
        });
        result = a;
        const s = a.stats;
        return `Checked ${s.rowsRead.toLocaleString()} rows: ${s.inScope.toLocaleString()} on the chosen feeders, ${s.flagged.toLocaleString()} flagged, ${selfDts.size} DT${selfDts.size === 1 ? "" : "s"} self-assigned. ${(s.ignoredNotFocused + s.ignoredNotInLookup).toLocaleString()} rows on other feeders were left out.`;
      },
      choice.restore ? `Before captures check (${label})` : undefined,
    );
    if (result) setCheckReport({ a: result, label, feeders: choice.feeders, from: choice.from, to: choice.to });
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
      This deletes all <b>{totalCaptures.toLocaleString()}</b> uploaded captures (
      {m.submissions.length.toLocaleString()} saved rows). Allocations stay.
    </p>,
    clearCaptures,
    "Before clearing captures",
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

  const counts = `${m.feeders.length} feeders · ${m.dts.length} DTs · ${m.enumerators.length} enumerators · ${totalCaptures.toLocaleString()} captures · ${m.allocations.length} allocations · ${m.vehicles.length} vehicles · ${m.trips.length} trips`;

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
      <Section title="3. Enumeration captures: Customer Enumeration + LT Pole">
        <div className="text-sm text-muted-foreground mb-3">
          Upload either or both. They work together: both carry the DT ID, so an LT Pole capture shows who worked on a DT just like a customer capture. Only the feeders you choose next are checked. Staff capturing on a DT that is not theirs are flagged with the FID, DT ID, feeder, building code, structure no. and customer no.
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {([["customer", "Customer Enumeration file"], ["lt", "LT Pole file"]] as const).map(([k, label]) => (
            <label key={k} className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-input p-5 text-center text-sm font-bold hover:border-accent">
              <span>{label}</span>
              <span className={"max-w-full truncate text-xs " + (capFiles[k] ? "text-success" : "font-normal text-muted-foreground")}>{capFiles[k]?.name ?? "Choose Excel / CSV file"}</span>
              <input type="file" accept=".xlsx,.xls,.csv" className="hidden" disabled={!!busy}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) setCapFiles((p) => ({ ...p, [k]: f })); e.target.value = ""; }} />
            </label>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button disabled={!!busy || (!capFiles.customer && !capFiles.lt)} onClick={checkFiles}>{busy === "enum" ? "Working…" : "Check & import"}</Button>
          {(capFiles.customer || capFiles.lt) && <Button variant="ghost" size="sm" disabled={!!busy} onClick={() => setCapFiles({})}>Clear choice</Button>}
          <Button variant="outline" size="sm" disabled={!m.submissions.length || !!busy} onClick={() => download(() => downloadCaptures(m), "captures")}><Download /> Download current data</Button>
          <Button variant="ghost" size="sm" className="text-destructive" disabled={!m.submissions.length || !!busy} onClick={clearCapturesAsk}><Trash2 /> Clear</Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{totalCaptures.toLocaleString()} customer captures ({m.submissions.length.toLocaleString()} saved rows incl. LT Pole). Re-uploading the same file updates, not duplicates.</p>
      </Section>
      <div className="md:col-span-2">
        <Section title="3b. Or use the Dashboard's upload">
          <p className="mb-3 text-sm text-muted-foreground">
            No need to upload the same files twice. In the Dashboard, upload the Customer Enumeration and LT Pole files under <b>Upload Data Files</b> and click <b>Save to Cloud</b>, then press the button here. You choose which feeders and dates to check; everything on other feeders is left out.
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
      {scopeReq && (
        <CaptureScopeDialog
          req={scopeReq} m={m} hasData={hasData} legacyCount={m.submissions.filter((x) => x.day == null).length}
          onCancel={() => setScopeReq(null)} onRun={(choice) => void applyCheck(scopeReq.inputs, choice)}
        />
      )}
      {checkReport && <CaptureReportDialog rep={checkReport} onClose={() => setCheckReport(null)} goTo={goTo} />}
    </div>
  );
}

/* ---------- Which feeders and dates to check ---------- */
function CaptureScopeDialog({
  req, m, hasData, legacyCount, onCancel, onRun,
}: {
  req: { inputs: CaptureInput[]; scan: ReturnType<typeof scanFeeders> };
  m: Model; hasData: boolean; legacyCount: number; onCancel: () => void;
  onRun: (c: { feeders: string[]; from: string | null; to: string | null; lock: boolean; restore: boolean }) => void;
}) {
  const { scan } = req;
  const inLookup = scan.feeders.filter((f) => f.inLookup);
  const notIn = scan.feeders.filter((f) => !f.inLookup);
  const locked = inLookup.filter((f) => m.feederById.get(f.feeder_id)?.locked).map((f) => f.feeder_id);
  const [sel, setSel] = useState<Set<string>>(new Set(locked.length ? locked : inLookup.map((f) => f.feeder_id)));
  const [mode, setMode] = useState<"all" | "range">("all");
  const [from, setFrom] = useState(scan.dayMin ?? "");
  const [to, setTo] = useState(scan.dayMax ?? "");
  const [lock, setLock] = useState(false);
  const [restore, setRestore] = useState(hasData);
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
            {hasData && <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={restore} onChange={(e) => setRestore(e.target.checked)} /><span>Keep a restore point first (lets you undo this upload, uses extra space)</span></label>}
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
  { kinds: ["other_holder"], title: "Captured on a DT assigned to someone else", hint: "Includes team partners who picked a DT that is not assigned to them." },
  { kinds: ["wrong_feeder"], title: "Captured on a feeder that is not in the lookup", hint: "By people who work on the chosen feeders." },
  { kinds: ["not_on_staff"], title: "Usernames not on the staff list", hint: "Resolve them in Capture Alerts. Their username stays on the DT either way." },
  { kinds: ["after_completed", "not_allocated", "dt_not_in_lookup", "feeder_mismatch"], title: "Other problems", hint: "" },
];
const KIND_LABEL: Record<ReportKind, string> = {
  self_assigned: "Self-assigned", other_holder: "Someone else's DT", not_on_staff: "Not on staff list", wrong_feeder: "Wrong feeder",
  dt_not_in_lookup: "DT not in lookup", feeder_mismatch: "Feeder mismatch", after_completed: "After completed", not_allocated: "Not allocated",
};

function CaptureReportDialog({ rep, onClose, goTo }: { rep: { a: Analysis; label: string; feeders: string[]; from: string | null; to: string | null }; onClose: () => void; goTo: ((t: string) => void) | undefined }) {
  const { a } = rep;
  const s = a.stats;
  const exportFlagged = () =>
    downloadSheet(
      "flagged_captures",
      a.issues.map((i) => ({
        FID: i.fid ?? "", "DT ID": i.dt_id ?? "", "Feeder ID": i.feeder_id ?? "", "Building code": i.building_code ?? "", "Structure no": i.structure_no ?? "",
        "Customer no": i.customer_no ?? "", "Call back form no": i.call_back_form_no ?? "", Username: i.username ?? "", Reason: i.reason, "Captured at": i.captured_at ?? "",
        Source: i.source === "lt" ? "LT Pole" : "Customer Enumeration",
      })),
      ["FID", "DT ID", "Feeder ID", "Building code", "Structure no", "Customer no", "Call back form no", "Username", "Reason", "Captured at", "Source"],
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