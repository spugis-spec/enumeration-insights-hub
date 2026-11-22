import { get, ref } from "firebase/database";
import { getDb } from "./firebase";
import { rowsToPoints } from "./gis";

/**
 * DT coordinates for the GIS Map. A DT record can carry its own coordinates: the Field Manager's
 * Feeder & DT lookup upload keeps the file's LONGITUDE/LATITUDE columns on each DT (see
 * withLookupCoords), and the map / KML exports prefer those. The DT Lookup uploaded on the
 * Dashboard (Upload Data Files → DT Lookup) is another source: when that file carries
 * latitude/longitude columns, the coordinates are saved with the lookup (this device + the
 * cloud dtLookup copy) and read here. A separate coordinates file can also be uploaded on the
 * map page itself as a top-up; those are kept on this device (IndexedDB). Coordinates are
 * matched to Field Manager DTs by normalised DT ID, so the map can show where the unassigned
 * DTs are and export them.
 */

export type DtCoord = { lat: number; lng: number };
/** Map key: normalised DT ID (uppercase, letters/digits only) — the same matching the capture checks use. */
export type DtCoordMap = Map<string, DtCoord>;

export const dtKey = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Builds the coordinate map from parsed spreadsheet rows. Returns how many rows were skipped (no DT ID). */
export function coordsFromRows(rows: Record<string, unknown>[]): { coords: DtCoordMap; skipped: number } {
  const pts = rowsToPoints(rows, "dss");
  const coords: DtCoordMap = new Map();
  for (const p of pts) if (p.dtId) coords.set(dtKey(p.dtId), { lat: p.lat, lng: p.lng });
  const withId = pts.filter((p) => p.dtId).length;
  return { coords, skipped: rows.length - withId };
}

/**
 * Attaches coordinates to records (e.g. the DTs built by the Field Manager lookup import) from a
 * coordinate map, matched by normalised DT ID. Records with no match are returned untouched — no
 * lat/lng keys are added — so a merge-save preserves whatever coordinates are already stored.
 */
export function withLookupCoords<T extends { dt_id: string }>(records: T[], coords: DtCoordMap): { rows: (T & { lat?: number; lng?: number })[]; attached: number } {
  let attached = 0;
  const rows = records.map((r) => {
    const c = coords.get(dtKey(r.dt_id));
    if (!c) return r;
    attached++;
    return { ...r, lat: c.lat, lng: c.lng };
  });
  return { rows, attached };
}

/** A record's own coordinates, when they are present and plausible; null otherwise. */
export function ownCoords(rec: { lat?: unknown; lng?: unknown }): DtCoord | null {
  const lat = Number(rec.lat), lng = Number(rec.lng);
  return isFinite(lat) && isFinite(lng) && lat !== 0 && lng !== 0 && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

/** Extracts the coordinates from a saved DT Lookup object (entries without valid lat/lng are skipped). */
export function coordsFromLookup(o: unknown): DtCoordMap {
  const out: DtCoordMap = new Map();
  if (!o || typeof o !== "object") return out;
  for (const v of Object.values(o as Record<string, { id?: string; lat?: unknown; lng?: unknown }>)) {
    if (!v || !v.id) continue;
    const lat = Number(v.lat), lng = Number(v.lng);
    if (isFinite(lat) && isFinite(lng) && lat !== 0 && lng !== 0 && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) out.set(dtKey(String(v.id)), { lat, lng });
  }
  return out;
}

/** Coordinates saved inside the DT Lookup (device localStorage copy first, then the cloud copy — the cloud wins). */
export async function loadLookupCoords(): Promise<DtCoordMap> {
  const out: DtCoordMap = new Map();
  const add = (o: unknown) => coordsFromLookup(o).forEach((v, k) => out.set(k, v));
  try { add(JSON.parse(window.localStorage.getItem("eih_dtLookup") || "{}")); } catch { /* none on this device */ }
  try { add((await get(ref(getDb(), "dtLookup"))).val()); } catch { /* cloud copy unavailable: the device copy still works */ }
  return out;
}

const DB_NAME = "eih-dt-coords";
const STORE = "coords";

function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const q = indexedDB.open(DB_NAME, 1);
    q.onupgradeneeded = () => q.result.createObjectStore(STORE);
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
}

export async function loadDtCoords(): Promise<DtCoordMap> {
  try {
    const db = await idb();
    const raw = await new Promise<Record<string, [number, number]> | null>((res) => {
      const r = db.transaction(STORE).objectStore(STORE).get("all");
      r.onsuccess = () => res((r.result as Record<string, [number, number]>) ?? null);
      r.onerror = () => res(null);
    });
    const out: DtCoordMap = new Map();
    if (raw) for (const [k, v] of Object.entries(raw)) if (Array.isArray(v)) out.set(k, { lat: v[0], lng: v[1] });
    return out;
  } catch {
    return new Map();
  }
}

export async function saveDtCoords(coords: DtCoordMap): Promise<void> {
  const raw: Record<string, [number, number]> = {};
  for (const [k, v] of coords) raw[k] = [v.lat, v.lng];
  const db = await idb();
  await new Promise<void>((res, rej) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(raw, "all");
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

export type DtMapMarker = { lat: number; lng: number; dtId: string; dtName: string; feederName: string };
export type UnassignedRow = { dt_id: string; dt_name: string; feeder_id: string; feeder_name: string; lat: number | null; lng: number | null };

const xmlEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** KML for the unassigned DTs that have coordinates (Google Earth / QGIS / ArcGIS). */
export function buildKml(rows: UnassignedRow[]): string {
  const marks = rows
    .filter((r) => r.lat != null && r.lng != null)
    .map((r) => {
      const name = xmlEsc(r.dt_name || r.dt_id);
      const desc = xmlEsc(`DT ID: ${r.dt_id}\nFeeder: ${r.feeder_name || r.feeder_id}\nStatus: Unassigned`);
      return `    <Placemark>\n      <name>${name}</name>\n      <description>${desc}</description>\n      <Point><coordinates>${r.lng},${r.lat},0</coordinates></Point>\n    </Placemark>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n  <Document>\n    <name>Unassigned DTs</name>\n${marks}\n  </Document>\n</kml>\n`;
}
