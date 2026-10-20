import { get, ref } from "firebase/database";
import { getDb } from "../firebase";

export type PairingsRaw = { pairings: unknown; mappings: unknown };

/** Reads the Dashboard's saved pairings (Enumerator Mapping > Team Pairing Configuration) and the name mappings. */
export async function fetchPairingsRaw(): Promise<PairingsRaw> {
  const db = getDb();
  const [p, m] = await Promise.all([get(ref(db, "pairings")), get(ref(db, "mappings"))]);
  return { pairings: p.val(), mappings: m.val() };
}
