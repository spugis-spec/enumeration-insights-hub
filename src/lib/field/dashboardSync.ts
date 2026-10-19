import { get, ref } from "firebase/database";
import { getDb } from "../firebase";

export type DashboardCustomerRows = { rows: Record<string, string | null>[]; savedAt: number | null };

const toText = (v: unknown): string | null => {
  if (v == null) return null;
  if (typeof v === "number") return Number.isInteger(v) ? v.toFixed(0) : String(v);
  if (typeof v === "object") return null; // dates that were saved as empty objects carry no value
  const s = String(v).trim();
  return s === "" ? null : s;
};

/**
 * Reads the Customer Enumeration rows the Dashboard last saved to the cloud (Dashboard > Upload Data Files >
 * Customer Enumeration, then Save to Cloud). The Field Manager runs its own checks on them, so there is no
 * second upload.
 */
export async function fetchDashboardCustomerRows(): Promise<DashboardCustomerRows> {
  const db = getDb();
  const [cust, ts] = await Promise.all([
    get(ref(db, "dashboardData/currentData/uploadedData/cust")),
    get(ref(db, "dashboardData/currentData/timestamp")),
  ]);
  const raw = cust.val();
  const list: unknown[] = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? Object.values(raw as object) : [];
  const rows = list
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, toText(v)])) as Record<string, string | null>);
  const t = ts.val();
  return { rows, savedAt: typeof t === "number" ? t : null };
}
