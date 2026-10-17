import * as XLSX from "xlsx";
import { addRow, clearCollection, deleteWhere, listWhere, nullField, removeRow, setMany, listAll, type Progress } from "./db";
import { currentUser } from "./firebase";
import type { Model } from "./data";

/** Every collection a restore point captures (user accounts are never touched). */
export const DATA_COLLECTIONS = ["feeders", "dts", "enumerators", "allocations", "submissions", "vehicles", "trips", "capture_issues"] as const;
/** What counts as "uploaded" data. Allocations, vehicles and trips are created inside the app. */
export const UPLOADED_COLLECTIONS = ["feeders", "dts", "enumerators", "submissions", "capture_issues"] as const;
const MAX_SNAPSHOTS = 12;
const CHUNK_CHARS = 350_000; // stay well under Firestore's 1 MB document limit

export type SnapshotMeta = { id: string; label: string; created_at: string; created_by: string | null; counts: Record<string, number>; chunks: number };

/* ---------- downloads ---------- */

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");

export function downloadSheet(name: string, rows: Record<string, any>[], headers: string[]) {
  // IDs are written as text so Excel never turns 12-digit DT IDs into 5.01E+11.
  const ws = XLSX.utils.json_to_sheet(rows, { header: headers });
  ws["!cols"] = headers.map((h) => ({ wch: Math.min(48, Math.max(h.length + 2, ...rows.slice(0, 200).map((r) => String(r[h] ?? "").length + 2))) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  XLSX.writeFile(wb, `${name}_${stamp()}.xlsx`);
}

/** Same columns as the upload, so a downloaded file can be uploaded again. */
export function downloadLookup(m: Model) {
  const headers = ["FEEDER NAME", "FEEDER_ID", "AREA", "FEEDER_TYPE", "DT_NAME", "DT_ID", "DT_TYPE", "STATUS"];
  const rows: Record<string, any>[] = [];
  const byFeeder = new Map<string, typeof m.dts>();
  for (const d of m.dts) byFeeder.set(d.feeder_id, [...(byFeeder.get(d.feeder_id) ?? []), d]);
  for (const f of m.feeders) {
    const list = byFeeder.get(f.feeder_id) ?? [];
    const base = { "FEEDER NAME": f.feeder_name, FEEDER_ID: f.feeder_id, AREA: f.area ?? "", FEEDER_TYPE: f.feeder_type ?? "" };
    if (!list.length) rows.push({ ...base, DT_NAME: "", DT_ID: "", DT_TYPE: "", STATUS: "" });
    for (const d of list) rows.push({ ...base, DT_NAME: d.dt_name ?? "", DT_ID: d.dt_id, DT_TYPE: d.dt_type ?? "", STATUS: d.status });
  }
  for (const d of m.dts) if (!m.feederById.has(d.feeder_id)) rows.push({ "FEEDER NAME": "", FEEDER_ID: d.feeder_id, AREA: "", FEEDER_TYPE: "", DT_NAME: d.dt_name ?? "", DT_ID: d.dt_id, DT_TYPE: d.dt_type ?? "", STATUS: d.status });
  downloadSheet("feeder_dt_lookup", rows, headers);
  return rows.length;
}

export function downloadStaff(m: Model) {
  const rows = m.enumerators.map((e) => ({ USERNAME: e.username, FULL_NAME: e.full_name ?? "", PHONE: e.phone ?? "", SUPERVISOR: e.supervisor ?? "" }));
  downloadSheet("enumerators", rows, ["USERNAME", "FULL_NAME", "PHONE", "SUPERVISOR"]);
  return rows.length;
}

/** Captures are stored rolled up (one row per enumerator, DT and day), so the download is the same summary. */
export function downloadCaptures(m: Model) {
  const rows = m.submissions.map((s) => ({
    username: s.username ?? "", feeder: s.feeder_id ?? "", dt_id: s.dt_id ?? "", date: s.day ?? (s.captured_at ?? "").slice(0, 10),
    captures: s.count, last_capture_time: s.captured_at ?? "",
  }));
  downloadSheet("enumeration_captures_summary", rows, ["username", "feeder", "dt_id", "date", "captures", "last_capture_time"]);
  return rows.length;
}

export function downloadPoints(m: Model) {
  const rows = m.feeders.map((f) => ({ FEEDER_ID: f.feeder_id, "FEEDER NAME": f.feeder_name, EST_CUSTOMER_POINTS: f.est_customer_points ?? "" }));
  downloadSheet("estimated_customer_points", rows, ["FEEDER_ID", "FEEDER NAME", "EST_CUSTOMER_POINTS"]);
  return rows.length;
}

function collect(m: Model) {
  return { feeders: m.feeders, dts: m.dts, enumerators: m.enumerators, allocations: m.allocations, submissions: m.submissions, vehicles: m.vehicles, trips: m.trips } as Record<string, any[]>;
}

export function downloadFullBackup(m: Model) {
  const payload = { app: "dt-field-manager", version: 1, created_at: new Date().toISOString(), collections: collect(m) };
  saveBlob(new Blob([JSON.stringify(payload)], { type: "application/json" }), `dt-hub-backup_${stamp()}.json`);
}

/* ---------- restore points (stored in Firestore: snapshots + snapshot_chunks) ---------- */

export async function createSnapshot(label: string, m: Model): Promise<string> {
  const data = collect(m);
  const u = await currentUser();
  const counts: Record<string, number> = {};
  const chunks: { collection: string; index: number; rows: string }[] = [];
  for (const col of DATA_COLLECTIONS) {
    const rows = data[col] ?? [];
    counts[col] = rows.length;
    let cur: any[] = []; let size = 0; let idx = 0;
    for (const r of rows) {
      const s = JSON.stringify(r);
      if (cur.length && size + s.length > CHUNK_CHARS) { chunks.push({ collection: col, index: idx++, rows: JSON.stringify(cur) }); cur = []; size = 0; }
      cur.push(r); size += s.length;
    }
    chunks.push({ collection: col, index: idx, rows: JSON.stringify(cur) });
  }
  const id = await addRow("snapshots", { label, created_by: u?.email ?? null, counts, chunks: chunks.length });
  for (const c of chunks) await addRow("snapshot_chunks", { snapshot_id: id, ...c });
  await pruneSnapshots();
  return id;
}

export async function listSnapshots(): Promise<SnapshotMeta[]> {
  const all = await listAll<SnapshotMeta>("snapshots");
  return all.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
}

export async function deleteSnapshot(id: string) {
  await deleteWhere("snapshot_chunks", "snapshot_id", id);
  await removeRow("snapshots", id);
}

async function pruneSnapshots() {
  const all = await listSnapshots();
  for (const s of all.slice(MAX_SNAPSHOTS)) await deleteSnapshot(s.id);
}

export async function restoreSnapshot(id: string, p?: Prog) {
  const chunks = await listWhere<{ collection: string; index: number; rows: string }>("snapshot_chunks", "snapshot_id", id);
  const data: Record<string, any[]> = {};
  for (const c of chunks.sort((a, b) => a.index - b.index)) (data[c.collection] ??= []).push(...JSON.parse(c.rows));
  return restoreData(data, p);
}

export async function restoreData(data: Record<string, any[]>, p?: Prog) {
  let total = 0;
  for (const col of DATA_COLLECTIONS) {
    if (!Array.isArray(data[col])) continue;
    await wipe(col, p);
    total += await setMany(col, data[col], (d, t) => p?.(`Restoring ${NAMES[col] ?? col}`, d, t));
  }
  return total;
}

export async function readBackupFile(file: File): Promise<Record<string, any[]>> {
  const j = JSON.parse(await file.text());
  if (!j?.collections || typeof j.collections !== "object") throw new Error("This isn't a DT Hub backup file.");
  return j.collections;
}

/* ---------- clearing (each reports progress so the screen can show it) ---------- */

export type Prog = (label: string, done: number, total: number) => void;
const NAMES: Record<string, string> = { feeders: "feeders", dts: "DTs", enumerators: "enumerators", submissions: "captures", allocations: "allocations", vehicles: "vehicles", trips: "trips" };
const wipe = (col: string, p?: Prog) => clearCollection(col, (d, t) => p?.(`Deleting ${NAMES[col] ?? col}`, d, t));

export async function clearLookup(p?: Prog) { return (await wipe("dts", p)) + (await wipe("feeders", p)); }
export const clearStaff = (p?: Prog) => wipe("enumerators", p);
export const clearCaptures = async (p?: Prog) => (await wipe("submissions", p)) + (await wipe("capture_issues", p));
export const clearPoints = (_p?: Prog) => nullField("feeders", "est_customer_points");
export async function clearCollections(cols: readonly string[], p?: Prog) { let n = 0; for (const c of cols) n += await wipe(c, p); return n; }

/* ---------- upload history ---------- */

export type UploadLog = {
  id: string; kind: string; filename: string; created_at: string; uploaded_by: string | null;
  rows_read: number; rows_with_dt: number; saved: number; users: number; dts: number; feeders: number; date_from: string | null; date_to: string | null; note: string | null;
};
export async function logUpload(entry: Omit<UploadLog, "id" | "created_at" | "uploaded_by">) {
  const u = await currentUser();
  try { await addRow("uploads", { ...entry, uploaded_by: u?.email ?? null }); } catch { /* history is best-effort */ }
}
export async function listUploads(): Promise<UploadLog[]> {
  const all = await listAll<UploadLog>("uploads");
  return all.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? "")).slice(0, 30);
}
