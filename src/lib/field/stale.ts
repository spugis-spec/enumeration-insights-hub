import type { DT, Model } from "./data";

/** How many of the most recent capture dates a DT must be missing from before we suggest completing it. */
export const STALE_DATES = 3;
/** The capture dates counted must be within this many days of the newest one (so old uploads can't stretch the window). */
const HORIZON_DAYS = 7;

export type StaleDt = {
  dt: DT; feeder_id: string; holders: string[]; allocatedOn: string | null; lastCapture: string | null;
};
export type StaleResult = {
  /** The most recent capture dates looked at, oldest first. */
  days: string[];
  newest: string | null;
  today: string;
  /** False when the data has fewer than STALE_DATES recent capture dates, so nothing can be judged. */
  enough: boolean;
  note: string | null;
  stale: StaleDt[];
};

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const dayNum = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return Math.round(Date.UTC(y!, m! - 1, d!) / 86400000);
};

/**
 * Ongoing DTs that have not shown up in captures on any of the most recent capture dates (default 3).
 * A DT captured on the current date, or on either of the other recent dates, stays ongoing. Customer and LT Pole captures both count,
 * and so does a capture by someone other than the assigned person (the DT is still being worked).
 * Looks at saved captures plus `extra` (what is being uploaded right now).
 */
export function findStaleDts(opts: {
  m: Model; extra?: { dt_id: string | null; day: string | null }[]; feeders?: string[] | null; today?: string; size?: number;
}): StaleResult {
  const { m } = opts;
  const size = opts.size ?? STALE_DATES;
  const today = opts.today ?? localToday();
  const focus = opts.feeders?.length ? new Set(opts.feeders) : null;
  const inFocus = (dtId: string) => {
    const d = m.dtById.get(dtId);
    return !!d && (!focus || focus.has(d.feeder_id));
  };

  // every (DT, date) that had a capture, up to and including today
  const byDt = new Map<string, Set<string>>();
  const note = (dtId: string | null, day: string | null) => {
    if (!dtId || !day || day > today || !inFocus(dtId)) return;
    const set = byDt.get(dtId) ?? new Set<string>();
    set.add(day);
    byDt.set(dtId, set);
  };
  for (const s of m.submissions) note(s.dt_id, s.day ?? s.captured_at?.slice(0, 10) ?? null);
  for (const e of opts.extra ?? []) note(e.dt_id, e.day);

  const all = new Set<string>();
  for (const set of byDt.values()) for (const d of set) all.add(d);
  const sorted = [...all].sort().reverse();
  const newest = sorted[0] ?? null;
  const recent = newest ? sorted.filter((d) => dayNum(newest) - dayNum(d) <= HORIZON_DAYS).slice(0, size) : [];
  const base = { newest, today };
  if (recent.length < size) {
    return {
      ...base, days: [...recent].reverse(), enough: false, stale: [],
      note: `The data has ${recent.length} recent capture date${recent.length === 1 ? "" : "s"}; ${size} are needed to tell which DTs have stopped showing up.`,
    };
  }
  const windowStart = recent[recent.length - 1]!;
  const seen = new Set<string>();
  for (const [dtId, days] of byDt) if (recent.some((d) => days.has(d))) seen.add(dtId);

  const stale: StaleDt[] = [];
  for (const d of m.dts) {
    if (d.status !== "assigned" || !inFocus(d.dt_id) || seen.has(d.dt_id)) continue;
    // only ongoing, properly assigned work: not still waiting for authorization, and assigned before the window began
    const live = (m.allocsByDt.get(d.dt_id) ?? []).filter((a) => a.status === "active" && !(a.self_assigned && a.authorized !== true));
    if (!live.length || live.some((a) => (a.allocated_on ?? "") > windowStart)) continue;
    const days = [...(byDt.get(d.dt_id) ?? [])].sort();
    stale.push({
      dt: d, feeder_id: d.feeder_id,
      holders: live.map((a) => m.enumById.get(a.enumerator_id)).filter((e): e is NonNullable<typeof e> => !!e).map((e) => e.full_name || e.username),
      allocatedOn: live.map((a) => a.allocated_on).sort()[0] ?? null,
      lastCapture: days[days.length - 1] ?? null,
    });
  }
  stale.sort((a, b) => (a.lastCapture ?? "").localeCompare(b.lastCapture ?? "") || (a.dt.dt_name ?? a.dt.dt_id).localeCompare(b.dt.dt_name ?? b.dt.dt_id));
  return { ...base, days: [...recent].reverse(), enough: true, note: null, stale };
}
