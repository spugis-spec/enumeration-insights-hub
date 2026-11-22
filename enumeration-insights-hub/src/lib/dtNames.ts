import { get, ref } from "firebase/database";
import { getDb } from "./firebase";

/** DT ID (lower case) to DT name, from the DT lookup uploaded on the Dashboard (cloud copy first, then this device's copy). */
export type DtNames = Record<string, string>;

export const dtNameOf = (id: string | undefined, names: DtNames): string => {
  const k = (id ?? "").trim();
  if (!k) return "";
  return names[k.toLowerCase()] || "";
};

export async function loadDtNames(): Promise<DtNames> {
  const out: DtNames = {};
  const add = (o: unknown) => {
    if (!o || typeof o !== "object") return;
    for (const v of Object.values(o as Record<string, { id?: string; name?: string }>)) {
      if (v && v.id && v.name) out[String(v.id).trim().toLowerCase()] = String(v.name).trim();
    }
  };
  try { add(JSON.parse(window.localStorage.getItem("eih_dtLookup") || "{}")); } catch { /* none on this device */ }
  try { add((await get(ref(getDb(), "dtLookup"))).val()); } catch { /* cloud copy unavailable: the device copy still works */ }
  return out;
}
