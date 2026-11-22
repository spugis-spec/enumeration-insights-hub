import { get, ref } from "firebase/database";
import { getDb } from "../firebase";

export type DashboardCaptureRows = { customer: Record<string, string | null>[]; lt: Record<string, string | null>[]; savedAt: number | null };

const toText = (v: unknown): string | null => {
  if (v == null) return null;
  if (typeof v === "number") return Number.isInteger(v) ? v.toFixed(0) : String(v);
  if (typeof v === "object") return null; // dates that were saved as empty objects carry no value
  const s = String(v).trim();
  return s === "" ? null : s;
};

/** Turns rows from the cloud (or sent by the Dashboard) into plain text values. */
export function toRows(raw: unknown): Record<string, string | null>[] {
  const list: unknown[] = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? Object.values(raw as object) : [];
  return list
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, toText(v)])) as Record<string, string | null>);
}

/**
 * Reads the Customer Enumeration and LT Pole rows the Dashboard last saved to the cloud (Dashboard > Upload Data
 * Files, then Save to Cloud). The Field Manager runs its own checks on them, so there is no second upload.
 */
export async function fetchDashboardCaptureRows(): Promise<DashboardCaptureRows> {
  const db = getDb();
  const base = "dashboardData/currentData";
  const [cust, lt, ts] = await Promise.all([
    get(ref(db, `${base}/uploadedData/cust`)),
    get(ref(db, `${base}/uploadedData/lt`)),
    get(ref(db, `${base}/timestamp`)),
  ]);
  const t = ts.val();
  return { customer: toRows(cust.val()), lt: toRows(lt.val()), savedAt: typeof t === "number" ? t : null };
}
