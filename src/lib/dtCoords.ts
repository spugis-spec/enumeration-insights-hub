import { rowsToPoints } from "./gis";

/**
 * DT coordinates for the GIS Map, uploaded from the "DT file with coordinates"
 * (an Excel/CSV with a DT ID column — or a dss_* column — plus latitude/longitude, X/Y or lat/lon columns).
 * They are kept on this device (IndexedDB) and matched to Field Manager DTs by normalised DT ID,
 * so the map can show where the unassigned DTs are and export them to Excel / KML.
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
