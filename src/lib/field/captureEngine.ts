import {
  LEFT_ONGOING_REASON, SELF_ASSIGNED_REASON, STAFF_REASON, WRONG_FEEDER_REASON,
  type Allocation, type DT, type DtWorker, type Enumerator, type Model,
} from "./data";
import { parseCaptureTime } from "./dates";
import type { PairTeam } from "./pairings";

/**
 * Checks capture rows (Customer Enumeration and LT Pole files both carry a DT ID) against the feeder/DT lookup
 * and the allocations. Pure: it reads the model and returns what to save; the Uploads tab does the writing.
 *
 * Rules
 *  - Only feeders chosen in `scope.feeders` (feeders from the lookup) are worked on. Rows from other feeders are ignored,
 *    EXCEPT a person who works on the chosen feeders but captured on a feeder that is not in the lookup: that is flagged.
 *  - Inside the chosen feeders every capture must be on a DT allocated to that person (partners included).
 *  - A staff member capturing on a DT nobody has been assigned gets it self-assigned: allocation + status "assigned",
 *    marked as awaiting authorization.
 *  - Every username that captured on a DT is remembered against that DT, whether or not they are still on the project.
 */

export type CaptureSource = "customer" | "lt";
export type CaptureRow = Record<string, string | null>;
export type CaptureInput = { source: CaptureSource; label: string; rows: CaptureRow[] };
export type Scope = { feeders: string[]; from: string | null; to: string | null };

export type Group = { id: string; username: string | null; feeder_id: string | null; dt_id: string | null; day: string | null; count: number; captured_at: string | null; first_at: string | null; source: CaptureSource };
export type IssueRec = {
  key: string; username: string | null; feeder_id: string | null; dt_id: string | null; captured_at: string | null; reason: string;
  fid: string | null; structure_no: string | null; building_code: string | null; customer_no: string | null; call_back_form_no: string | null; source: CaptureSource; upload: string;
  /** The DT(s) the person should be working on (their ongoing allocations), as DT IDs. */
  correct_dt: string | null;
};
export type SelfAssign = { dt: DT; enumerator: Enumerator; count: number; first: string | null; last: string | null };
export type ReportKind = "left_ongoing" | "self_assigned" | "other_holder" | "not_on_staff" | "wrong_feeder" | "dt_not_in_lookup" | "feeder_mismatch" | "after_completed" | "not_allocated";
export type ReportRow = { kind: ReportKind; dt_id: string | null; dt_name: string | null; feeder_id: string | null; users: string[]; count: number; holders: string[]; partner: boolean };
export type ConfirmedRow = { dt_id: string; dt_name: string | null; feeder_id: string | null; users: string[]; days: string[]; count: number };
export type FeederFound = { feeder_id: string; inLookup: boolean; rows: number };
export type Analysis = {
  groups: Group[]; issues: IssueRec[]; selfAssign: SelfAssign[]; workers: Map<string, DtWorker[]>; report: ReportRow[]; feeders: FeederFound[];
  /** Assigned staff who captured on their own DT (per date): confirms who worked. */
  confirmed: ConfirmedRow[];
  /** Allocation id -> latest day the assigned person worked on it. */
  worked: { allocId: string; last: string }[];
  stats: { rowsRead: number; inScope: number; withDt: number; ignoredNotFocused: number; ignoredNotInLookup: number; ignoredDates: number; flagged: number; dayMin: string | null; dayMax: string | null };
};

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
const keyOf = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
function pick(row: Record<string, any>, ...names: string[]) {
  const want = names.map(keyOf);
  for (const k of Object.keys(row))
    if (want.includes(keyOf(k))) {
      const v = row[k];
      if (v != null && String(v).trim() !== "") return String(v).trim();
    }
  return null;
}
function pickTime(row: Record<string, any>) {
  const direct = pick(row, "time", "captured_at", "datetime", "date_time", "capture_time", "created_at", "date");
  if (direct) return direct;
  const k = Object.keys(row).find((c) => /time|date/i.test(c) && row[c] != null && String(row[c]).trim() !== "");
  return k ? String(row[k]).trim() : null;
}
function pickUser(row: Record<string, any>) {
  const direct = pick(row, "username", "USER NAME", "USER");
  if (direct) return direct;
  const k = Object.keys(row).find((c) => /username/i.test(c) && row[c] != null && String(row[c]).trim() !== "");
  return k ? String(row[k]).trim() : null;
}
function pickDt(row: Record<string, any>) {
  let dt = pick(row, "DT_ID", "DT ID", "DTID");
  if (!dt) {
    const keys = Object.keys(row).filter((k) => k.toLowerCase().startsWith("dss_"));
    keys.sort((a, b) => Number(b.toLowerCase().startsWith("dss_fdr")) - Number(a.toLowerCase().startsWith("dss_fdr")));
    for (const k of keys) {
      const v = row[k];
      if (v != null && String(v).trim()) { dt = String(v).trim(); break; }
    }
  }
  return dt ? dt.replace(/\.0+$/, "") : null;
}

type Fields = {
  username: string | null; feeder: string | null; dt: string | null; at: string | null; day: string | null;
  fid: string | null; structure: string | null; building: string | null; customer: string | null; callback: string | null;
};
export function readRow(r: CaptureRow): Fields {
  const at = parseCaptureTime(pickTime(r));
  return {
    username: pickUser(r), feeder: pick(r, "feeder", "FEEDER_ID", "FEEDER ID"), dt: pickDt(r), at, day: at ? at.slice(0, 10) : null,
    fid: pick(r, "fid"), structure: pick(r, "structure_no", "structure_number", "structure no", "structure number"),
    building: pick(r, "building_code", "BUILDING CODE", "BUILDING_CODE"), customer: pick(r, "customer_no", "CUSTOMER NO", "CUSTOMER_NUMBER", "customer_number"),
    callback: pick(r, "call_back_form_no", "CALL BACK FORM NO", "CALLBACK_FORM_NO", "call_back_form_number"),
  };
}

/** Feeders present in the rows, and whether each is in the uploaded lookup (used to build the "which feeders?" choice). */
const SCI = /^\d+(\.\d+)?e\+?\d+$/i;
/** Why a scan cannot be used (no rows, no DT IDs, DT IDs ruined by scientific notation, no lookup), or null when it is fine. */
export function validateCaptureScan(scan: ReturnType<typeof scanFeeders>, m: Model): string | null {
  if (!scan.rows) return "No capture rows found.";
  if (!scan.withDt)
    return `No DT IDs found, so nothing was imported. Columns in your file: ${scan.columns.slice(0, 14).join(", ")}${scan.columns.length > 14 ? "…" : ""}. Add a column named DT_ID (or DT ID), or one starting with dss_.`;
  if (scan.sci)
    return `DT ID "${scan.sci}" is in scientific notation, so the real digits are lost and nothing was imported. Re-export the file with the DT ID column kept as text (or as ="501101202901") and upload again.`;
  if (!m.feeders.length) return "Upload the feeder & DT lookup first: captures are checked against it.";
  return null;
}

export function scanFeeders(inputs: CaptureInput[], m: Model): { feeders: FeederFound[]; dayMin: string | null; dayMax: string | null; rows: number; withDt: number; sci: string | null; columns: string[] } {
  const tally = new Map<string, number>();
  let dayMin: string | null = null, dayMax: string | null = null, rows = 0, withDt = 0, sci: string | null = null;
  const columns = inputs[0]?.rows[0] ? Object.keys(inputs[0].rows[0]) : [];
  for (const inp of inputs) for (const r of inp.rows) {
    const f = readRow(r);
    if (!f.username && !f.feeder && !f.dt) continue;
    rows++;
    if (f.dt) { withDt++; if (!sci && SCI.test(f.dt)) sci = f.dt; }
    if (f.day) { if (!dayMin || f.day < dayMin) dayMin = f.day; if (!dayMax || f.day > dayMax) dayMax = f.day; }
    const eff = (f.dt && m.dtById.get(f.dt)?.feeder_id) || f.feeder;
    if (eff) tally.set(eff, (tally.get(eff) ?? 0) + 1);
  }
  const feeders = [...tally.entries()].map(([feeder_id, n]) => ({ feeder_id, inLookup: m.feederById.has(feeder_id), rows: n })).sort((a, b) => Number(b.inLookup) - Number(a.inLookup) || b.rows - a.rows);
  return { feeders, dayMin, dayMax, rows, withDt, sci, columns };
}

export function analyzeCaptures(opts: { inputs: CaptureInput[]; m: Model; scope: Scope; pairs?: PairTeam[] }): Analysis {
  const { inputs, m, scope } = opts;
  const focus = new Set(scope.feeders);
  const groups = new Map<string, Group>();
  const issues = new Map<string, IssueRec>();
  const workers = new Map<string, Map<string, DtWorker>>();
  const selfMap = new Map<string, SelfAssign>();
  const reportMap = new Map<string, ReportRow & { _u: Set<string>; _h: Set<string> }>();
  const stats = { rowsRead: 0, inScope: 0, withDt: 0, ignoredNotFocused: 0, ignoredNotInLookup: 0, ignoredDates: 0, flagged: 0, dayMin: null as string | null, dayMax: null as string | null };
  const effFeeder = (f: Fields) => (f.dt && m.dtById.get(f.dt)?.feeder_id) || f.feeder;

  // People who work on the chosen feeders: anyone allocated there, plus anyone captured there in this upload.
  const working = new Set<string>();
  for (const d of m.dts) if (focus.has(d.feeder_id)) for (const a of m.allocsByDt.get(d.dt_id) ?? []) if (a.status !== "cancelled") working.add(a.enumerator_id);
  const parsed: { f: Fields; inp: CaptureInput }[] = [];
  for (const inp of inputs) for (const r of inp.rows) {
    const f = readRow(r);
    if (!f.username && !f.feeder && !f.dt) continue;
    parsed.push({ f, inp });
    const eff = effFeeder(f);
    const en = m.enumByUser.get(norm(f.username));
    if (en && eff && focus.has(eff)) working.add(en.id);
  }

  // DTs each person is working on right now (allocation still active, DT not completed)
  const ongoing = new Map<string, DT[]>();
  for (const d of m.dts) {
    if (d.status === "completed") continue;
    for (const a of m.allocsByDt.get(d.dt_id) ?? []) if (a.status === "active") ongoing.set(a.enumerator_id, [...(ongoing.get(a.enumerator_id) ?? []), d]);
  }
  const confirmedMap = new Map<string, { dt: DT; users: Set<string>; days: Set<string>; count: number }>();
  const workedMap = new Map<string, string>();

  // team partners (usernames) by username, from the Dashboard pairings
  const partnersOf = (u: string): Set<string> => {
    const out = new Set<string>();
    for (const t of opts.pairs ?? []) {
      const names = t.members.map((x) => norm(x.username));
      if (names.includes(norm(u))) names.forEach((n) => n !== norm(u) && out.add(n));
    }
    return out;
  };
  const addReport = (kind: ReportKind, dt: DT | undefined, dtId: string | null, feeder: string | null, user: string | null, count: number, holders: string[] = [], partner = false) => {
    const k = `${kind}|${dtId ?? ""}|${dt ? "" : feeder ?? ""}`;
    const cur = reportMap.get(k) ?? { kind, dt_id: dtId, dt_name: dt?.dt_name ?? null, feeder_id: dt?.feeder_id ?? feeder, users: [], count: 0, holders: [], partner: false, _u: new Set<string>(), _h: new Set<string>() };
    cur.count += count;
    if (user) cur._u.add(user);
    holders.forEach((h) => cur._h.add(h));
    cur.partner = cur.partner || partner;
    reportMap.set(k, cur);
  };

  for (const { f, inp } of parsed) {
    stats.rowsRead++;
    if (f.day) {
      if (!stats.dayMin || f.day < stats.dayMin) stats.dayMin = f.day;
      if (!stats.dayMax || f.day > stats.dayMax) stats.dayMax = f.day;
    }
    if (f.day && ((scope.from && f.day < scope.from) || (scope.to && f.day > scope.to))) { stats.ignoredDates++; continue; }

    const eff = effFeeder(f);
    const dt = f.dt ? m.dtById.get(f.dt) : undefined;
    const en = m.enumByUser.get(norm(f.username));
    const base = { fid: f.fid, structure_no: f.structure, building_code: f.building, customer_no: f.customer, call_back_form_no: f.callback, source: inp.source, upload: inp.label };
    const flag = (reason: string, kind: ReportKind, holders: string[] = [], partner = false, correct: string | null = null) => {
      const key = [norm(f.username), f.dt ?? "", f.callback ?? "", f.customer ?? "", f.building ?? "", f.structure ?? "", f.fid ?? "", f.at ?? "", inp.source, reason].join("|");
      issues.set(key, { key, username: f.username, feeder_id: f.feeder ?? dt?.feeder_id ?? null, dt_id: f.dt, captured_at: f.at, reason, ...base, correct_dt: correct });
      addReport(kind, dt, f.dt, f.feeder, f.username, 1, holders, partner);
    };

    if (!eff || !focus.has(eff)) {
      if (eff && m.feederById.has(eff)) { stats.ignoredNotFocused++; continue; } // a lookup feeder that was not chosen
      // A feeder that is not in the lookup: only a person working on the chosen feeders can have picked it by mistake.
      if (en && working.has(en.id)) { flag(WRONG_FEEDER_REASON, "wrong_feeder"); continue; }
      stats.ignoredNotInLookup++;
      continue;
    }

    stats.inScope++;
    if (f.dt) stats.withDt++;
    const gid = [norm(f.username), f.feeder ?? "", f.dt ?? "", f.day ?? ""].join("|") + (inp.source === "lt" ? "|lt" : "");
    let g = groups.get(gid);
    if (!g) groups.set(gid, (g = { id: gid, username: f.username, feeder_id: f.feeder, dt_id: f.dt, day: f.day, count: 0, captured_at: null, first_at: null, source: inp.source }));
    g.count++;
    if (f.at && (!g.captured_at || f.at > g.captured_at)) g.captured_at = f.at;
    if (f.at && (!g.first_at || f.at < g.first_at)) g.first_at = f.at;

    if (f.dt && f.username) {
      const per = workers.get(f.dt) ?? new Map<string, DtWorker>();
      const w = per.get(norm(f.username)) ?? { username: f.username, first: f.at, last: f.at, source: inp.source };
      if (f.at && (!w.first || f.at < w.first)) w.first = f.at;
      if (f.at && (!w.last || f.at > w.last)) w.last = f.at;
      per.set(norm(f.username), w);
      workers.set(f.dt, per);
    }
    if (!f.dt) continue; // counted, but nothing to check against

    if (!dt) { flag("DT not in lookup", "dt_not_in_lookup"); continue; }
    if (f.feeder && dt.feeder_id !== f.feeder) { flag(`Feeder mismatch (captured on ${f.feeder}, DT belongs to ${dt.feeder_id})`, "feeder_mismatch"); continue; }
    if (!en) {
      const k = m.kindOf(f.username ?? "");
      if (k.kind === "unknown") flag(STAFF_REASON, "not_on_staff"); // supervisors and people already resolved are not flagged, but stay on the DT
      continue;
    }

    const live = (m.allocsByDt.get(dt.dt_id) ?? []).filter((a) => a.status !== "cancelled");
    const mine = live.filter((a) => a.enumerator_id === en.id);
    const elsewhere = (ongoing.get(en.id) ?? []).filter((d) => d.dt_id !== dt.dt_id);
    const correct = elsewhere.map((d) => d.dt_id).join(", ") || null;
    if (mine.length) {
      for (const a of mine) if (f.day && (!workedMap.get(a.id) || f.day > workedMap.get(a.id)!)) workedMap.set(a.id, f.day);
      if (mine.every((a) => a.self_assigned && a.authorized !== true)) { flag(SELF_ASSIGNED_REASON, "self_assigned"); continue; }
      if (f.day && mine.every((a) => a.status === "completed" && a.completed_on && f.day! > a.completed_on)) { flag("Captured after DT was completed", "after_completed"); continue; }
      // the assigned person worked on their own DT: confirmed
      const c = confirmedMap.get(dt.dt_id) ?? { dt, users: new Set<string>(), days: new Set<string>(), count: 0 };
      if (f.username) c.users.add(f.username);
      if (f.day) c.days.add(f.day);
      c.count++;
      confirmedMap.set(dt.dt_id, c);
      continue;
    }
    if (live.length) {
      const holders = live.map((a) => m.enumById.get(a.enumerator_id)).filter((e): e is Enumerator => !!e);
      const partner = holders.some((h) => partnersOf(f.username ?? "").has(norm(h.username)));
      flag("DT allocated to someone else", "other_holder", holders.map((h) => h.full_name || h.username), partner, correct);
      continue;
    }
    if (dt.status === "unassigned" || dt.status === "assigned") {
      const cur = selfMap.get(`${dt.dt_id}|${en.id}`) ?? { dt, enumerator: en, count: 0, first: null, last: null };
      cur.count++;
      if (f.at && (!cur.first || f.at < cur.first)) cur.first = f.at;
      if (f.at && (!cur.last || f.at > cur.last)) cur.last = f.at;
      selfMap.set(`${dt.dt_id}|${en.id}`, cur);
      // still working on another DT? that is the more useful thing to flag
      if (elsewhere.length) flag(LEFT_ONGOING_REASON, "left_ongoing", [], false, correct);
      else flag(SELF_ASSIGNED_REASON, "self_assigned");
      continue;
    }
    flag("DT not allocated to anyone", "not_allocated", [], false, correct);
  }

  const tally = scanFeeders(inputs, m).feeders;
  return {
    groups: [...groups.values()],
    issues: [...issues.values()],
    selfAssign: [...selfMap.values()],
    workers: new Map([...workers].map(([dt, per]) => [dt, [...per.values()]])),
    report: [...reportMap.values()].map(({ _u, _h, ...r }) => ({ ...r, users: [..._u], holders: [..._h] })).sort((a, b) => b.count - a.count),
    feeders: tally,
    confirmed: [...confirmedMap.values()].map((c) => ({ dt_id: c.dt.dt_id, dt_name: c.dt.dt_name, feeder_id: c.dt.feeder_id, users: [...c.users], days: [...c.days].sort(), count: c.count })).sort((a, b) => b.count - a.count),
    worked: [...workedMap].map(([allocId, last]) => ({ allocId, last })),
    stats: { ...stats, flagged: issues.size },
  };
}

/** Merges the usernames found in this upload into what a DT already remembers (names are never dropped). */
export function mergeWorkers(existing: DtWorker[] | null | undefined, found: DtWorker[]): DtWorker[] {
  const by = new Map<string, DtWorker>();
  for (const w of [...(existing ?? []), ...found]) {
    const k = norm(w.username);
    const cur = by.get(k);
    if (!cur) { by.set(k, { ...w }); continue; }
    if (w.first && (!cur.first || w.first < cur.first)) cur.first = w.first;
    if (w.last && (!cur.last || w.last > cur.last)) cur.last = w.last;
    if (!cur.source && w.source) cur.source = w.source;
  }
  return [...by.values()];
}

export type { Allocation };
