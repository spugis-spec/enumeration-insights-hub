import { get, ref } from "firebase/database";
import { getDb } from "../firebase";

export type DashboardCustomerRows = { rows: Record<string, string | null>[]; savedAt: number | null };
export type DashboardRows = { customer: Record<string, string | null>[]; ltpole: Record<string, string | null>[]; savedAt: number | null };

const toText = (v: unknown): string | null => {
  if (v == null) return null;
  if (typeof v === "number") return Number.isInteger(v) ? v.toFixed(0) : String(v);
  if (typeof v === "object") return null; // dates that were saved as empty objects carry no value
  const s = String(v).trim();
  return s === "" ? null : s;
};

const toRows = (raw: unknown) => {
  const list: unknown[] = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? Object.values(raw as object) : [];
  return list
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, toText(v)])) as Record<string, string | null>);
};

/**
 * Reads the Customer Enumeration AND LT Pole rows the Dashboard last saved to the cloud (Dashboard > Upload Data Files,
 * then Save to Cloud). The Field Manager runs its own checks on them, so there is no second upload.
 */
export async function fetchDashboardRows(): Promise<DashboardRows> {
  const db = getDb();
  const [cust, lt, ts] = await Promise.all([
    get(ref(db, "dashboardData/currentData/uploadedData/cust")),
    get(ref(db, "dashboardData/currentData/uploadedData/lt")),
    get(ref(db, "dashboardData/currentData/timestamp")),
  ]);
  const t = ts.val();
  return { customer: toRows(cust.val()), ltpole: toRows(lt.val()), savedAt: typeof t === "number" ? t : null };
}

export async function fetchDashboardCustomerRows(): Promise<DashboardCustomerRows> {
  const d = await fetchDashboardRows();
  return { rows: d.customer, savedAt: d.savedAt };
}
