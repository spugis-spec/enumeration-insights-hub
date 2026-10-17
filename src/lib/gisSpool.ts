import { ref, get } from "firebase/database";
import { getDb } from "./firebase";
import type { AssetType, GisPoint } from "./gis";

/** Compact point saved by the dashboard: [lat, lng, user, feeder, date, fid]. */
type Compact = [number, number, string, string, string, string];
export type SpoolPayload = { points: Partial<Record<AssetType, Compact[]>>; count: number; savedAt: number };

function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const q = indexedDB.open("eih-gis", 1);
    q.onupgradeneeded = () => q.result.createObjectStore("points");
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
}

async function localKeys(): Promise<string[]> {
  try {
    const db = await idb();
    return await new Promise((res) => {
      const r = db.transaction("points").objectStore("points").getAllKeys();
      r.onsuccess = () => res((r.result as string[]) ?? []);
      r.onerror = () => res([]);
    });
  } catch {
    return [];
  }
}

async function localGet(key: string): Promise<SpoolPayload | null> {
  try {
    const db = await idb();
    return await new Promise((res) => {
      const r = db.transaction("points").objectStore("points").get(key);
      r.onsuccess = () => res((r.result as SpoolPayload) ?? null);
      r.onerror = () => res(null);
    });
  } catch {
    return null;
  }
}

/** Dates with dashboard points available — on this device and in the cloud. */
export async function listSpoolDates(): Promise<{ date: string; count: number; where: "device" | "cloud" | "both" }[]> {
  const out = new Map<string, { date: string; count: number; where: "device" | "cloud" | "both" }>();
  for (const k of await localKeys()) out.set(k, { date: k, count: 0, where: "device" });
  try {
    const s = await get(ref(getDb(), "gisPointsIndex"));
    const v = (s.val() ?? {}) as Record<string, { count?: number }>;
    for (const [k, meta] of Object.entries(v)) {
      const cur = out.get(k);
      out.set(k, { date: k, count: meta?.count ?? 0, where: cur ? "both" : "cloud" });
    }
  } catch {
    /* cloud index unavailable — device copies still work */
  }
  return [...out.values()].sort((a, b) => b.date.localeCompare(a.date));
}

export async function loadSpool(date: string): Promise<Record<AssetType, GisPoint[]> | null> {
  let p = await localGet(date);
  if (!p) {
    try {
      const s = await get(ref(getDb(), `gisPoints/${date}`));
      p = s.val();
    } catch {
      p = null;
    }
  }
  if (!p?.points) return null;
  const conv = (t: AssetType): GisPoint[] =>
    (p!.points[t] ?? []).map(([lat, lng, user, feeder, d, fid]) => ({ type: t, lat, lng, user, feeder, date: d, fid, raw: {} }));
  return { dss: conv("dss"), ht: conv("ht"), lt: conv("lt"), cust: conv("cust") };
}
