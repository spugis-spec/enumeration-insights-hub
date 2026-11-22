import { DT_STATUSES } from "./data";

/**
 * STATUS import for the Feeder & DT lookup upload (Data Uploads → 1. Feeder & DT lookup).
 *
 * A lookup file can carry a STATUS column (completed / assigned / unassigned / problematic).
 * Those values are only ever used to fill in DTs the app knows nothing about yet: a DT that is
 * new, or whose recorded status is still "unassigned". A status the app itself has recorded —
 * assigned, completed, problematic, access denied — is NEVER overwritten by the lookup file,
 * so re-uploading a lookup can never undo allocations or completions made in the app.
 */

const KNOWN = new Set<string>(DT_STATUSES.map((s) => s.value));

/** Normalises a raw file STATUS cell to an app DT status, or null when it carries nothing usable. */
export function normaliseLookupStatus(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let s = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (s === "complete") s = "completed";
  return KNOWN.has(s) ? s : null;
}

/**
 * The status to write for one DT on a lookup upload, or null to write nothing.
 * `current` is the DT's status in the app right now (null/undefined = new DT, or no status
 * recorded yet). `raw` is the file row's raw STATUS value.
 */
export function lookupStatusFor(current: string | null | undefined, raw: unknown): string | null {
  const fromFile = normaliseLookupStatus(raw);
  if (!fromFile) return null;
  // A recorded in-app status (anything but "unassigned") always wins over the file.
  if (current != null && current !== "" && current !== "unassigned") return null;
  return fromFile;
}
