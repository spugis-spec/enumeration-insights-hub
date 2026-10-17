import { useEffect, useState } from "react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { CheckCircle2, Download, History, Loader2, Save, Trash2, X, XCircle } from "lucide-react";
import { addMany, patchMany, removeMany, updateRow, upsertMany, safeId } from "@/lib/field/db";
import { auth } from "@/lib/field/firebase";
import { captureIssueReason, useRefresh, type Model } from "@/lib/field/data";
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
function cellText(v: any): string | null {
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
function parseTime(v: string | null) {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}
const compact = <T extends Record<string, any>>(o: T) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v != null)) as T;

export function UploadsTab({ m }: { m: Model }) {
  const refresh = useRefresh();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmReq, setConfirmReq] = useState<ConfirmReq | null>(null);
  const KINDS: Record<string, string> = {
    lookup: "Feeder & DT lookup",
    staff: "Enumerators",
    captures: "Captures",
    points: "Customer points",
  };
  const totalCaptures = m.submissions.reduce((n, x) => n + x.count, 0);
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

  /** After a captures upload: offer to mark DTs that already have work as assigned to the enumerators who captured them. */
  function offerBaseline(out: any[]) {
    const lockedIds = new Set(m.feeders.filter((f) => f.locked).map((f) => f.feeder_id));
    const byDt = new Map<string, { users: Set<string>; first: string | null }>();
    const unknownUsers = new Map<string, number>();
    let notInLookup = 0;
    for (const o of out) {
      if (!o.dt_id || !o.username) continue;
      const dt = m.dtById.get(o.dt_id);
      if (!dt) {
        notInLookup++;
        continue;
      }
      if (lockedIds.has(dt.feeder_id)) continue; // locked feeders are flagged in Capture Alerts, not auto-assigned
      if ((m.allocsByDt.get(dt.dt_id) ?? []).some((a) => a.status === "active")) continue; // never override a manual allocation
      const en = m.enumByUser.get(String(o.username).trim().toLowerCase());
      if (!en) {
        unknownUsers.set(o.username, (unknownUsers.get(o.username) ?? 0) + 1);
        continue;
      }
      const cur = byDt.get(dt.dt_id) ?? { users: new Set<string>(), first: null };
      cur.users.add(en.id);
      if (o.captured_at && (!cur.first || o.captured_at < cur.first)) cur.first = o.captured_at;
      byDt.set(dt.dt_id, cur);
    }
    if (!byDt.size) return;
    const feederIds = new Set([...byDt.keys()].map((id) => m.dtById.get(id)!.feeder_id));
    const people = new Set([...byDt.values()].flatMap((v) => [...v.users]));
    const apply = (lock: boolean) =>
      run(
        "baseline",
        async (p) => {
          const uid = auth().currentUser?.uid ?? null;
          const today = new Date().toISOString().slice(0, 10);
          const allocs: any[] = [];
          const dtPatches: { id: string; patch: Record<string, any> }[] = [];
          for (const [dtId, v] of byDt) {
            const dt = m.dtById.get(dtId)!;
            for (const eid of v.users)
              allocs.push({
                dt_id: dtId,
                enumerator_id: eid,
                allocated_on: v.first?.slice(0, 10) ?? today,
                due_date: null,
                notes: "Auto-assigned from uploaded captures",
                allocated_by: uid,
                status: "active",
                completed_on: null,
              });
            if (dt.status === "unassigned")
              dtPatches.push({
                id: dt.id,
                patch: {
                  status: "assigned",
                  status_note: null,
                  updated_at: new Date().toISOString(),
                },
              });
          }
          await addMany("allocations", allocs, (d, t) => p("Creating allocations", d, t));
          await patchMany("dts", dtPatches);
          if (lock)
            await patchMany(
              "feeders",
              [...feederIds].map((f) => ({ id: m.feederById.get(f)!.id, patch: { locked: true } })),
            );
          return `Marked ${byDt.size} DTs as assigned${lock ? ` and locked ${feederIds.size} feeder(s)` : ""}`;
        },
        "Before auto-assigning from captures",
      );
    const unk = [...unknownUsers.entries()];
    ask({
      title: "Mark these DTs as assigned?",
      body: (
        <>
          <p>
            The captures you just uploaded show work already done on <b>{byDt.size} DTs</b> (
            {feederIds.size} feeder{feederIds.size > 1 ? "s" : ""}) by{" "}
            <b>
              {people.size} enumerator{people.size > 1 ? "s" : ""}
            </b>
            , and none of them are allocated yet.
          </p>
          <p>
            Choose <b>Mark as assigned</b> to allocate each DT to the enumerator(s) who captured it,
            so supervisors can then assign the remaining DTs.
          </p>
          <p>
            <b>Assign and lock feeders</b> does the same and also locks those feeders, so any later
            capture on an unallocated DT is flagged.
          </p>
          {unk.length > 0 && (
            <p className="text-destructive">
              Skipped: {unk.reduce((s, [, n]) => s + n, 0)} capture(s) by usernames not on the staff
              list (
              {unk
                .slice(0, 5)
                .map(([u]) => u)
                .join(", ")}
              {unk.length > 5 ? "…" : ""}).
            </p>
          )}
          {notInLookup > 0 && (
            <p className="text-destructive">
              Skipped: {notInLookup} capture(s) on DT IDs not in the lookup.
            </p>
          )}
          <p className="text-muted-foreground">
            DTs already allocated, and DTs on locked feeders, are left alone. A restore point is
            saved first.
          </p>
        </>
      ),
      confirmLabel: "Mark as assigned",
      cancelLabel: "No, leave them",
      alt: { label: "Assign and lock feeders", onClick: () => apply(true) },
      onConfirm: () => apply(false),
    });
  }

  /** Asks whether to keep a restore point before the captures upload changes anything. */
  const askRestore = (file: File, legacyIds: string[]) => {
    if (!hasData) return void doCaptures(file, legacyIds, false);
    ask({
      title: "Keep a restore point?",
      body: (
        <>
          <p>
            A restore point lets you undo this upload later, but it uses extra space on the database.
          </p>
          <p>
            Only the counts per feeder / DT and the captures with a problem are saved. All other rows in
            the file are discarded after checking.
          </p>
        </>
      ),
      confirmLabel: "Yes, keep restore point",
      alt: { label: "No, skip it", onClick: () => doCaptures(file, legacyIds, false) },
      onConfirm: () => doCaptures(file, legacyIds, true),
    });
  };

  const enumeration = (file: File) => {
    const legacy = m.submissions.filter((x) => x.day == null);
    if (!legacy.length) return void askRestore(file, []);
    ask({
      title: "Replace old-format captures?",
      body: (
        <>
          <p>
            Captures are now saved rolled up per enumerator, DT and day, so large files load quickly
            instead of saving one record per capture.
          </p>
          <p>
            <b>{legacy.length.toLocaleString()}</b> old per-capture records are still saved. They
            will be deleted when this file is imported, so nothing is counted twice.
          </p>
        </>
      ),
      confirmLabel: "Continue with upload",
      onConfirm: () =>
        askRestore(
          file,
          legacy.map((l) => l.id),
        ),
    });
  };

  const doCaptures = async (file: File, legacyIds: string[], keepRestore: boolean) => {
    let groupsOut: any[] | null = null;
    await run(
      "enum",
      async (p) => {
        p("Reading file…", 0, 0);
        const rows = await readSheet(file);
        p(`Processing ${rows.length.toLocaleString()} rows…`, 0, 0);
        const headers = rows[0] ? Object.keys(rows[0]) : [];
        const groups = new Map<string, any>();
        const issues = new Map<string, any>();
        let rowsRead = 0,
          withDt = 0,
          dayMin: string | null = null,
          dayMax: string | null = null;

        for (const r of rows) {
          const username = pick(r, "username", "USER NAME", "USER");
          const feeder = pick(r, "feeder", "FEEDER_ID", "FEEDER ID");
          // DT ID: a column called DT_ID / DT ID, otherwise the first filled column starting with dss_
          let dt = pick(r, "DT_ID", "DT ID", "DTID");
          if (!dt) {
            const keys = Object.keys(r).filter((k) => k.toLowerCase().startsWith("dss_"));
            keys.sort(
              (a, b) =>
                Number(b.toLowerCase().startsWith("dss_fdr")) -
                Number(a.toLowerCase().startsWith("dss_fdr")),
            );
            for (const k of keys) {
              const v = r[k];
              if (v != null && String(v).trim()) {
                dt = String(v).trim();
                break;
              }
            }
          }
          if (dt) dt = dt.replace(/\.0+$/, "");
          if (!username && !feeder && !dt) continue; // blank row
          rowsRead++;
          if (dt) withDt++;
          const at = parseTime(pick(r, "time", "captured_at"));
          const day = at ? at.slice(0, 10) : null;
          if (day) {
            if (!dayMin || day < dayMin) dayMin = day;
            if (!dayMax || day > dayMax) dayMax = day;
          }
          const id = [(username ?? "").toLowerCase(), feeder ?? "", dt ?? "", day ?? ""].join("|");
          let g = groups.get(id);
          if (!g)
            groups.set(
              id,
              (g = {
                id,
                username,
                feeder_id: feeder,
                dt_id: dt,
                day,
                count: 0,
                captured_at: null,
                first_at: null,
              }),
            );
          g.count++;
          // Keep the row only when something is wrong with it, with the fields staff need to find the submission again.
          const reason = captureIssueReason(m, username, feeder, dt);
          if (reason) {
            const cb = pick(r, "call_back_form_no", "CALL BACK FORM NO", "CALLBACK_FORM_NO", "call_back_form_number");
            const cust = pick(r, "customer_no", "CUSTOMER NO", "CUSTOMER_NUMBER", "customer_number");
            const bld = pick(r, "building_code", "BUILDING CODE", "BUILDING_CODE");
            const iid = [(username ?? "").toLowerCase(), dt ?? "", cb ?? "", cust ?? "", bld ?? "", at ?? "", cb || cust || bld || at ? "" : String(issues.size)].join("|");
            issues.set(iid, { username, feeder_id: feeder, dt_id: dt, captured_at: at, reason, call_back_form_no: cb, customer_no: cust, building_code: bld, upload: file.name });
          }
          if (at && (!g.captured_at || at > g.captured_at)) g.captured_at = at;
          if (at && (!g.first_at || at < g.first_at)) g.first_at = at;
        }

        if (!rowsRead) throw new Error("No capture rows found in that file.");
        if (!withDt)
          throw new Error(
            `No DT IDs found, so nothing was imported. Columns in your file: ${headers.slice(0, 14).join(", ")}${headers.length > 14 ? "…" : ""}. Add a column named DT_ID (or DT ID), or one starting with dss_.`,
          );
        const list = [...groups.values()];
        const sci = list.find((g) => g.dt_id && SCI.test(g.dt_id));
        if (sci)
          throw new Error(
            `DT ID "${sci.dt_id}" is in scientific notation, so the real digits are lost and nothing was imported. Re-export the file with the DT ID column kept as text (or as ="501101202901") and upload again.`,
          );

        if (legacyIds.length)
          await removeMany("submissions", legacyIds, (d, t) =>
            p("Removing old-format captures", d, t),
          );
        await upsertMany(
          "submissions",
          list,
          (g) => g.id,
          (d, t) => p("Saving captures", d, t),
        );
        if (issues.size)
          await upsertMany(
            "capture_issues",
            [...issues.entries()].map(([id, v]) => ({ ...v, _key: id })),
            (g) => g._key,
            (d, t) => p("Saving captures with problems", d, t),
          );
        await logUpload({
          kind: "captures",
          filename: file.name,
          rows_read: rowsRead,
          rows_with_dt: withDt,
          saved: list.length,
          users: new Set(list.map((g) => (g.username ?? "").toLowerCase())).size,
          dts: new Set(list.filter((g) => g.dt_id).map((g) => g.dt_id)).size,
          feeders: new Set(list.filter((g) => g.feeder_id).map((g) => g.feeder_id)).size,
          date_from: dayMin,
          date_to: dayMax,
          note: issues.size ? `${issues.size} capture(s) with problems kept for correction` : null,
        });
        groupsOut = list.map((g) => ({ ...g, captured_at: g.first_at }));
        return `Imported ${rowsRead.toLocaleString()} captures as ${list.length.toLocaleString()} summary rows (${withDt.toLocaleString()} with a DT ID). Re-uploading the same file updates, not duplicates. ${issues.size.toLocaleString()} capture(s) with problems kept for Capture Alerts; the rest were counted and discarded.`;
      },
      keepRestore ? `Before captures upload (${file.name})` : undefined,
    );
    if (groupsOut) offerBaseline(groupsOut);
  };

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
      {card(
        "enum",
        "3. Enumeration captures",
        <>
          The field export. Uses <b>username, feeder, time</b> and the DT ID from a column named{" "}
          <b>DT_ID</b> / <b>DT ID</b> (or the first filled column starting with <b>dss_</b>). Large
          files are saved rolled up per enumerator, DT and day, so they stay fast. Now:{" "}
          {totalCaptures.toLocaleString()} captures ({m.submissions.length.toLocaleString()} saved
          rows).
        </>,
        enumeration,
        m.submissions.length,
        () => download(() => downloadCaptures(m), "captures"),
        clearCapturesAsk,
      )}
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
    </div>
  );
}
