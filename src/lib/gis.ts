export type AssetType = "dss" | "ht" | "lt" | "cust";

export const ASSET_LABELS: Record<AssetType, string> = {
  dss: "DSS",
  ht: "HT Poles",
  lt: "LT Poles",
  cust: "Customer Meters",
};

export type GisPoint = {
  type: AssetType;
  lat: number;
  lng: number;
  user: string;
  feeder: string;
  date: string; // YYYY-MM-DD or ""
  fid: string;
  raw: Record<string, unknown>;
};

const find = (keys: string[], tests: RegExp[]) => {
  for (const t of tests) {
    const k = keys.find((key) => t.test(key.trim()));
    if (k) return k;
  }
  return undefined;
};

function toDateKey(v: unknown): string {
  if (!v) return "";
  if (v instanceof Date && !isNaN(v.getTime())) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  }
  const d = new Date(String(v));
  if (!isNaN(d.getTime())) return toDateKey(d);
  return "";
}

export function rowsToPoints(rows: Record<string, unknown>[], type: AssetType): GisPoint[] {
  if (!rows.length) return [];
  const keys = Object.keys(rows[0]);
  const latK = find(keys, [/^lat(itude)?$/i, /latitude/i, /^y$/i, /^_?y$/i, /gps.*lat/i, /lat/i]);
  const lngK = find(keys, [/^(lng|lon|long|longitude)$/i, /longitude/i, /^x$/i, /^_?x$/i, /gps.*lon/i, /lon/i]);
  const userK = find(keys, [/^username$/i, /creator/i, /created_?user/i, /enumerator/i, /user/i, /editor/i]);
  const feederK = find(keys, [/^feeder$/i, /feeder.?name/i, /feeder/i]);
  const dateK = find(keys, [/creation.?date/i, /created.?date/i, /^date$/i, /date/i, /time/i]);
  const fidK = find(keys, [/^fid$/i, /objectid/i, /globalid/i, /fid/i, /^id$/i]);
  if (!latK || !lngK) return [];
  const out: GisPoint[] = [];
  for (const r of rows) {
    const lat = Number(r[latK]);
    const lng = Number(r[lngK]);
    if (!isFinite(lat) || !isFinite(lng) || lat === 0 || lng === 0) continue;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    out.push({
      type,
      lat,
      lng,
      user: userK ? String(r[userK]).trim() : "",
      feeder: feederK ? String(r[feederK]).trim() : "",
      date: dateK ? toDateKey(r[dateK]) : "",
      fid: fidK ? String(r[fidK]) : "",
      raw: r,
    });
  }
  return out;
}

// Monotone chain convex hull, used to draw approximate feeder boundaries.
export function convexHull(pts: [number, number][]): [number, number][] {
  if (pts.length < 3) return pts;
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: number[], a: number[], b: number[]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: [number, number][] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}
