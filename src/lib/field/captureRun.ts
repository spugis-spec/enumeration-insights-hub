import { auth } from "./firebase";
import { addMany, patchMany, removeMany, upsertMany } from "./db";
import { logUpload } from "./dataTools";
import { analyzeCaptures, mergeWorkers, type Analysis, type CaptureInput } from "./captureEngine";
import { buildPairTeams } from "./pairings";
import { fetchPairingsRaw } from "./pairingsApi";
import type { Model } from "./data";

export type CheckChoice = { feeders: string[]; from: string | null; to: string | null; lock: boolean; restore: boolean };
type Progress = (label: string, done: number, total: number) => void;

/**
 * Runs the capture check and saves what it found: captures, flagged captures (with FID, structure no. and so on),
 * self-assigned DTs, who worked on each DT, and who worked on their own assigned DT. Shared by the Data Uploads tab and
 * the Dashboard's "push to Field Manager" button.
 */
export async function applyCaptureCheck(opts: { m: Model; inputs: CaptureInput[]; choice: CheckChoice; p?: Progress }): Promise<Analysis> {
  const { m, inputs, choice } = opts;
  const p: Progress = opts.p ?? (() => {});
  const label = inputs.map((i) => i.label).join(" + ");

  p("Checking captures…", 0, 0);
  let pairs: ReturnType<typeof buildPairTeams> = [];
  try { pairs = buildPairTeams(await fetchPairingsRaw(), m.enumerators); } catch { /* partner notes are optional */ }
  const a = analyzeCaptures({ inputs, m, scope: { feeders: choice.feeders, from: choice.from, to: choice.to }, pairs });
  if (!a.stats.inScope && !a.issues.length)
    throw new Error(`Nothing to import: none of the ${a.stats.rowsRead.toLocaleString()} rows were on the chosen feeders and dates${a.stats.ignoredNotInLookup ? ` (${a.stats.ignoredNotInLookup.toLocaleString()} are on feeders that are not in your lookup)` : ""}.`);

  const legacy = m.submissions.filter((x) => x.day == null).map((x) => x.id);
  if (legacy.length) await removeMany("submissions", legacy, (d, t) => p("Removing old-format captures", d, t));
  if (a.groups.length) await upsertMany("submissions", a.groups, (g) => g.id, (d, t) => p("Saving captures", d, t));
  if (a.issues.length)
    await upsertMany("capture_issues", a.issues.map(({ key, ...v }) => ({ ...v, _key: key })), (g) => g._key, (d, t) => p("Saving flagged captures", d, t));

  // Self-assign: a DT nobody was assigned on the app, but a staff member captured on it.
  const uid = auth().currentUser?.uid ?? null;
  const today = new Date().toISOString().slice(0, 10);
  if (a.selfAssign.length)
    await addMany(
      "allocations",
      a.selfAssign.map((s) => ({
        dt_id: s.dt.dt_id, enumerator_id: s.enumerator.id, allocated_on: (s.first ?? today).slice(0, 10), due_date: null,
        notes: "Self-assigned: captured on this DT before it was assigned on the app. Awaiting authorization.",
        allocated_by: uid, status: "active", completed_on: null, self_assigned: true, authorized: false, last_worked_on: (s.last ?? today).slice(0, 10),
      })),
      (d, t) => p("Self-assigning DTs", d, t),
    );

  // Confirm who worked: the assigned person's allocation remembers the latest day they worked on it.
  const worked = a.worked.filter((w) => {
    const alloc = m.allocations.find((x) => x.id === w.allocId);
    return alloc && (alloc.last_worked_on ?? "") < w.last;
  });
  if (worked.length) await patchMany("allocations", worked.map((w) => ({ id: w.allocId, patch: { last_worked_on: w.last } })));

  // Remember every username on every DT it was captured on, and move self-assigned DTs to "assigned".
  const selfDts = new Set(a.selfAssign.map((s) => s.dt.dt_id));
  const patches: { id: string; patch: Record<string, any> }[] = [];
  for (const [dtId, found] of a.workers) {
    const dt = m.dtById.get(dtId);
    if (!dt) continue;
    const merged = mergeWorkers(dt.workers, found);
    const changed = JSON.stringify(merged) !== JSON.stringify(dt.workers ?? []);
    const assign = selfDts.has(dtId) && dt.status === "unassigned";
    if (!changed && !assign) continue;
    patches.push({ id: dt.id, patch: { workers: merged, ...(assign ? { status: "assigned", status_note: null, updated_at: new Date().toISOString() } : {}) } });
  }
  if (patches.length) await patchMany("dts", patches);
  if (choice.lock)
    await patchMany("feeders", choice.feeders.map((f) => m.feederById.get(f)).filter((f) => f && !f.locked).map((f) => ({ id: f!.id, patch: { locked: true } })));

  await logUpload({
    kind: "captures", filename: label, rows_read: a.stats.rowsRead, rows_with_dt: a.stats.withDt, saved: a.groups.length,
    users: new Set(a.groups.map((g) => (g.username ?? "").toLowerCase())).size, dts: new Set(a.groups.filter((g) => g.dt_id).map((g) => g.dt_id)).size,
    feeders: choice.feeders.length, date_from: choice.from ?? a.stats.dayMin, date_to: choice.to ?? a.stats.dayMax,
    note: [a.issues.length && `${a.issues.length} flagged`, a.selfAssign.length && `${selfDts.size} DT(s) self-assigned`, a.confirmed.length && `${a.confirmed.length} DT(s) confirmed`].filter(Boolean).join(" · ") || null,
  });
  return a;
}

export function checkSummary(a: Analysis): string {
  const s = a.stats;
  const self = new Set(a.selfAssign.map((x) => x.dt.dt_id)).size;
  return `Checked ${s.rowsRead.toLocaleString()} rows: ${s.inScope.toLocaleString()} on the chosen feeders, ${a.confirmed.length} DT${a.confirmed.length === 1 ? "" : "s"} confirmed, ${s.flagged.toLocaleString()} flagged, ${self} DT${self === 1 ? "" : "s"} self-assigned. ${(s.ignoredNotFocused + s.ignoredNotInLookup).toLocaleString()} rows on other feeders were left out.`;
}
