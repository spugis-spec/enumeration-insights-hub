import { mergeWorkers, readRow, type CaptureRow } from "./captureEngine";
import type { DT, DtWorker, Model } from "./data";

/**
 * "Appeared in a file" check (DT Allocation → 📍 Find unassigned DTs in a file).
 *
 * A capture file (Customer Enumeration or LT Pole) is scanned for every DT that appears in it even once.
 * DTs that are still Unassigned on the chosen feeder are listed with EVERYONE who captured on them —
 * a DT can have five, six or more capturers, and all of their names are attached to the DT for reference
 * (its `workers` record). A self-assigned allocation is created for each capturer who is on staff,
 * never just one person. Nothing here writes to the database: `buildAppearedWrites` only prepares the
 * rows, and the dialog saves them after an explicit in-dialog confirmation.
 */

export type AppearedCapturer = { username: string; count: number; first: string | null; last: string | null };
export type AppearedDt = { dtId: string; total: number; capturers: AppearedCapturer[] };

type AppearedEntry = { dtId: string; total: number; byUser: Map<string, AppearedCapturer> };
/** Accumulator keyed by normalised DT ID (the same keying the capture checks use). */
export type AppearedAcc = Map<string, AppearedEntry>;

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
const keyOf = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

export function createAppearedAcc(): AppearedAcc {
  return new Map();
}

/** Folds parsed capture rows into the accumulator. Rows with no DT ID are skipped. */
export function addAppearedRows(acc: AppearedAcc, rows: CaptureRow[]): void {
  for (const r of rows) {
    const f = readRow(r);
    if (!f.dt) continue;
    const key = keyOf(f.dt);
    let e = acc.get(key);
    if (!e) acc.set(key, (e = { dtId: f.dt, total: 0, byUser: new Map() }));
    e.total++;
    // A row with a DT but no username still counts toward the DT total, under the "" capturer.
    const uKey = norm(f.username);
    let c = e.byUser.get(uKey);
    if (!c) e.byUser.set(uKey, (c = { username: (f.username ?? "").trim(), count: 0, first: null, last: null }));
    c.count++;
    if (f.at && (!c.first || f.at < c.first)) c.first = f.at;
    if (f.at && (!c.last || f.at > c.last)) c.last = f.at;
  }
}

/** The accumulated DTs as a plain list (capturers busiest first). */
export function appearedList(acc: AppearedAcc): AppearedDt[] {
  return [...acc.values()].map((e) => ({
    dtId: e.dtId,
    total: e.total,
    capturers: [...e.byUser.values()].sort((a, b) => b.count - a.count || a.username.localeCompare(b.username)),
  }));
}

export type AppearedMatchCapturer = { username: string; fullName: string | null; enumeratorId: string | null; count: number; first: string | null; last: string | null };
export type AppearedMatch = { dt: DT; total: number; capturers: AppearedMatchCapturer[] };

/**
 * Matches the accumulated DTs against the model for one feeder.
 * - `matches`: DTs on this feeder that are still Unassigned (the ones the dialog lists).
 * - `appearedOnFeeder`: accumulated DTs that exist in the lookup on this feeder, any status.
 * - `appearedElsewhere`: accumulated DTs whose DT is on another feeder, or not in the lookup at all.
 */
export function matchAppeared(m: Model, feederId: string, acc: AppearedAcc): { matches: AppearedMatch[]; appearedOnFeeder: number; appearedElsewhere: number } {
  const byNorm = new Map<string, DT>();
  for (const d of m.dts) if (!byNorm.has(keyOf(d.dt_id))) byNorm.set(keyOf(d.dt_id), d);
  const matches: AppearedMatch[] = [];
  let appearedOnFeeder = 0, appearedElsewhere = 0;
  for (const [key, e] of acc) {
    const dt = byNorm.get(key);
    if (!dt || dt.feeder_id !== feederId) { appearedElsewhere++; continue; }
    appearedOnFeeder++;
    if (dt.status !== "unassigned") continue;
    matches.push({
      dt,
      total: e.total,
      capturers: [...e.byUser.values()]
        .sort((a, b) => b.count - a.count || a.username.localeCompare(b.username))
        .map((c) => {
          const en = m.enumByUser.get(norm(c.username));
          return { username: c.username, fullName: en?.full_name ?? null, enumeratorId: en?.id ?? null, count: c.count, first: c.first, last: c.last };
        }),
    });
  }
  matches.sort((a, b) => (a.dt.dt_name ?? a.dt.dt_id).localeCompare(b.dt.dt_name ?? b.dt.dt_id));
  return { matches, appearedOnFeeder, appearedElsewhere };
}

const NOTE_AWAITING = "Self-assigned: captured on this DT before it was assigned on the app. Awaiting authorization.";
const NOTE_AUTHORIZED = "Self-assigned: captured on this DT before it was assigned on the app. Authorized.";

/**
 * Prepares (but does not save) the writes for the ticked DTs, mirroring the capture check's self-assign save:
 * - one self-assigned allocation per capturer who is on staff and does not already hold a live allocation on that DT;
 * - every capturer's name (except the "" no-name rows) merged into the DT's `workers`, never dropping existing names;
 * - the DT flips to "assigned" only when at least one allocation was created for it;
 * - `workerOnlyDts` counts ticked DTs where no allocation could be created (names attached for reference only).
 */
export function buildAppearedWrites(
  m: Model,
  chosen: AppearedMatch[],
  opts: { authorize: boolean; uid: string | null; today: string },
): { allocations: Record<string, any>[]; dtPatches: { id: string; patch: Record<string, any> }[]; allocCount: number; workerOnlyDts: number } {
  const allocations: Record<string, any>[] = [];
  const dtPatches: { id: string; patch: Record<string, any> }[] = [];
  let workerOnlyDts = 0;
  for (const x of chosen) {
    const dt = x.dt;
    let created = 0;
    for (const c of x.capturers) {
      if (!c.enumeratorId) continue; // not on staff: name is attached for reference, no allocation
      const live = (m.allocsByDt.get(dt.dt_id) ?? []).some((a) => a.status !== "cancelled" && a.enumerator_id === c.enumeratorId);
      if (live) continue;
      allocations.push({
        dt_id: dt.dt_id, enumerator_id: c.enumeratorId, allocated_on: (c.first ?? opts.today).slice(0, 10), due_date: null,
        notes: opts.authorize ? NOTE_AUTHORIZED : NOTE_AWAITING,
        allocated_by: opts.uid, status: "active", completed_on: null, self_assigned: true, authorized: opts.authorize,
        last_worked_on: (c.last ?? opts.today).slice(0, 10),
      });
      created++;
    }
    const found: DtWorker[] = x.capturers.filter((c) => c.username !== "").map((c) => ({ username: c.username, first: c.first, last: c.last, source: null }));
    const merged = mergeWorkers(dt.workers, found);
    const workersChanged = JSON.stringify(merged) !== JSON.stringify(dt.workers ?? []);
    if (!created) workerOnlyDts++;
    if (workersChanged || created) {
      dtPatches.push({
        id: dt.id,
        patch: { workers: merged, updated_at: new Date().toISOString(), ...(created ? { status: "assigned", status_note: null } : {}) },
      });
    }
  }
  return { allocations, dtPatches, allocCount: allocations.length, workerOnlyDts };
}
