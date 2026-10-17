import { useQuery, useQueryClient } from "@tanstack/react-query";
import { doc, getDoc } from "firebase/firestore";
import { currentUser, db } from "./firebase";
import { listAll } from "./db";

export type Feeder = { id: string; feeder_id: string; feeder_name: string; area: string | null; feeder_type: string | null; est_customer_points: number | null; start_date: string | null; target_per_staff_day: number | null; working_days_per_week: number | null; notes?: string | null; locked?: boolean | null };
export type DT = { id: string; dt_id: string; feeder_id: string; dt_name: string | null; dt_type: string | null; status: string; status_note: string | null; updated_at?: string | null; updated_by?: string | null };
export type Enumerator = { id: string; username: string; full_name: string | null; phone: string | null; supervisor: string | null; active: boolean | null };
export type Allocation = { id: string; dt_id: string; enumerator_id: string; allocated_by: string | null; allocated_on: string; due_date: string | null; notes: string | null; status: string; completed_on: string | null };
/** One row = one enumerator on one DT on one day (many captures are rolled into `count`). Old per-capture rows have no `day` and count as 1. */
export type Submission = { id: string; username: string | null; feeder_id: string | null; dt_id: string | null; captured_at: string | null; day: string | null; count: number; fid?: string | null };
/** Only captures with a detected problem are kept row-by-row, so staff can find and fix the exact submission. Clean rows are only counted. */
export type CaptureIssue = { id: string; username: string | null; feeder_id: string | null; dt_id: string | null; captured_at: string | null; reason: string; call_back_form_no: string | null; customer_no: string | null; building_code: string | null; upload: string | null };
export type Vehicle = { id: string; name: string; driver: string | null; capacity: number | null; icon: string | null; status: string | null; status_note?: string | null };
export type Trip = { id: string; vehicle_id: string | null; trip_date: string; destination: string | null; feeder_id: string | null; notes: string | null; staff: string[] | null };

export const DT_STATUSES = [
  { value: "unassigned", label: "Not assigned" },
  { value: "assigned", label: "Assigned" },
  { value: "completed", label: "Completed" },
  { value: "problematic", label: "Problematic" },
  { value: "access_denied", label: "Access denied" },
] as const;

export function statusLabel(s: string) {
  return DT_STATUSES.find((x) => x.value === s)?.label ?? s;
}

export function useRole() {
  return useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const u = await currentUser();
      if (!u) return null;
      const snap = await getDoc(doc(db(), "users", u.uid));
      const p = snap.data() as { role?: string; full_name?: string } | undefined;
      const role = p?.role === "admin" ? "admin" : p?.role === "supervisor" ? "supervisor" : "none";
      return { id: u.uid, email: u.email ?? "", name: p?.full_name || u.email || "", role };
    },
  });
}

const withDefaults = <T,>(rows: any[], d: Partial<T>) => rows.map((r) => ({ ...d, ...r })) as T[];

export function useAppData() {
  return useQuery({
    queryKey: ["appdata"],
    queryFn: async () => {
      const [feeders, dts, enumerators, allocations, submissions, vehicles, trips, capture_issues] = await Promise.all([
        listAll<any>("feeders").then((r) => withDefaults<Feeder>(r, { area: null, feeder_type: null, est_customer_points: null, start_date: null, locked: false, target_per_staff_day: 40, working_days_per_week: 6 })),
        listAll<any>("dts").then((r) => withDefaults<DT>(r, { status: "unassigned", status_note: null, dt_name: null, dt_type: null })),
        listAll<any>("enumerators").then((r) => withDefaults<Enumerator>(r, { full_name: null, phone: null, supervisor: null, active: true })),
        listAll<any>("allocations").then((r) => withDefaults<Allocation>(r, { status: "active", due_date: null, notes: null, completed_on: null, allocated_by: null })),
        listAll<any>("submissions").then((r) => withDefaults<Submission>(r, { count: 1, day: null })),
        listAll<any>("vehicles").then((r) => withDefaults<Vehicle>(r, { status: "available", driver: null, capacity: 8, icon: "🚐" })),
        listAll<any>("trips").then((r) => withDefaults<Trip>(r, { staff: [], destination: null, feeder_id: null, notes: null })),
        listAll<any>("capture_issues").catch(() => []).then((r) => withDefaults<CaptureIssue>(r, { call_back_form_no: null, customer_no: null, building_code: null, feeder_id: null, captured_at: null, upload: null })),
      ]);
      return buildModel({ feeders, dts, enumerators, allocations, submissions, vehicles, trips, capture_issues });
    },
  });
}

export function useRefresh() {
  const qc = useQueryClient();
  // Waits until fresh data has loaded, so the screen updates right away instead of after switching tabs.
  return () => qc.refetchQueries({ queryKey: ["appdata"], type: "all" });
}

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

export type Alert = {
  key: string;
  username: string;
  enumerator?: Enumerator | undefined;
  dt_id: string;
  dt?: DT | undefined;
  feeder_id: string | null;
  reason: string;
  count: number;
  last: string | null;
};

export function buildModel(raw: {
  feeders: Feeder[]; dts: DT[]; enumerators: Enumerator[]; allocations: Allocation[];
  submissions: Submission[]; vehicles: Vehicle[]; trips: Trip[]; capture_issues?: CaptureIssue[];
}) {
  raw = { ...raw, capture_issues: raw.capture_issues ?? [] };
  const feederById = new Map(raw.feeders.map((f) => [f.feeder_id, f]));
  const dtById = new Map(raw.dts.map((d) => [d.dt_id, d]));
  const enumById = new Map(raw.enumerators.map((e) => [e.id, e]));
  const enumByUser = new Map(raw.enumerators.map((e) => [norm(e.username), e]));

  const subsByDt = new Map<string, number>();
  const subsByFeeder = new Map<string, number>();
  for (const s of raw.submissions) {
    if (s.dt_id) subsByDt.set(s.dt_id, (subsByDt.get(s.dt_id) ?? 0) + s.count);
    const fid = s.feeder_id ?? (s.dt_id ? dtById.get(s.dt_id)?.feeder_id : undefined);
    if (fid) subsByFeeder.set(fid, (subsByFeeder.get(fid) ?? 0) + s.count);
  }

  const allocsByDt = new Map<string, Allocation[]>();
  for (const a of raw.allocations) {
    const arr = allocsByDt.get(a.dt_id) ?? [];
    arr.push(a);
    allocsByDt.set(a.dt_id, arr);
  }

  // Unauthorized / suspicious capture detection.
  // "Not allocated" checks only apply to LOCKED feeders (work has begun afresh there); other feeders may hold baseline data.
  const lockedFeeders = new Set(raw.feeders.filter((f) => f.locked).map((f) => f.feeder_id));
  const alertMap = new Map<string, Alert>();
  for (const s of raw.submissions) {
    if (!s.dt_id) continue;
    const dt = dtById.get(s.dt_id);
    const en = enumByUser.get(norm(s.username));
    let reason = "";
    if (!dt) reason = "DT not in lookup";
    else if (s.feeder_id && dt.feeder_id !== s.feeder_id) reason = `Feeder mismatch (captured on ${s.feeder_id}, DT belongs to ${dt.feeder_id})`;
    else if (!en) reason = "Enumerator not on staff list";
    else if (lockedFeeders.has(dt.feeder_id)) {
      const allowed = (allocsByDt.get(dt.dt_id) ?? []).some((a) => a.enumerator_id === en.id && a.status !== "cancelled");
      if (!allowed) reason = (allocsByDt.get(dt.dt_id) ?? []).length ? "DT allocated to someone else" : "DT not allocated to anyone";
    }
    if (!reason) continue;
    const key = `${norm(s.username)}|${s.dt_id}|${reason}`;
    const cur = alertMap.get(key);
    if (cur) {
      cur.count += s.count;
      if (s.captured_at && (!cur.last || s.captured_at > cur.last)) cur.last = s.captured_at;
    } else {
      alertMap.set(key, { key, username: s.username ?? "unknown", enumerator: en, dt_id: s.dt_id, dt, feeder_id: s.feeder_id, reason, count: s.count, last: s.captured_at });
    }
  }
  const alerts = [...alertMap.values()].sort((a, b) => (b.last ?? "").localeCompare(a.last ?? ""));

  return { ...raw, capture_issues: raw.capture_issues ?? [], feederById, dtById, enumById, enumByUser, subsByDt, subsByFeeder, allocsByDt, alerts };
}

export type Model = ReturnType<typeof buildModel>;

export function activeAllocs(m: Model, dtId: string) {
  return (m.allocsByDt.get(dtId) ?? []).filter((a) => a.status === "active");
}

export function feederStats(m: Model, feederId?: string) {
  const dts = feederId ? m.dts.filter((d) => d.feeder_id === feederId) : m.dts;
  const c = { total: dts.length, unassigned: 0, assigned: 0, completed: 0, problematic: 0, access_denied: 0, noCapture: 0, captures: 0 };
  for (const d of dts) {
    (c as any)[d.status] = ((c as any)[d.status] ?? 0) + 1;
    const n = m.subsByDt.get(d.dt_id) ?? 0;
    c.captures += n;
    if (!n) c.noCapture++;
  }
  return c;
}

export function addWorkingDays(start: Date, days: number, perWeek: number) {
  const d = new Date(start);
  let left = Math.max(0, Math.ceil(days));
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    const wd = d.getDay(); // 0 Sun
    const off = perWeek >= 7 ? false : perWeek === 6 ? wd === 0 : wd === 0 || wd === 6;
    if (!off) left--;
  }
  return d;
}

export type ProjectionOpts = { dailyTarget?: number; bufferPct?: number; staffOverride?: number };

export function projectFeeder(m: Model, f: Feeder, opts: ProjectionOpts = {}) {
  const staffOverride = opts.staffOverride;
  const bufferPct = Math.max(-10, Math.min(10, opts.bufferPct ?? 0));
  const captured = m.subsByFeeder.get(f.feeder_id) ?? 0;
  const baseEst = f.est_customer_points ?? 0;
  // ±10% buffer for network expansion / unmapped discovery.
  const est = Math.round(baseEst * (1 + bufferPct / 100));
  const remaining = Math.max(est - captured, 0);
  const dts = m.dts.filter((d) => d.feeder_id === f.feeder_id);
  const staffSet = new Set<string>();
  for (const d of dts) for (const a of activeAllocs(m, d.dt_id)) staffSet.add(a.enumerator_id);
  const staff = staffOverride ?? staffSet.size;
  const target = opts.dailyTarget ?? f.target_per_staff_day ?? 30;
  const perWeek = f.working_days_per_week ?? 6;
  const plannedRate = staff * target;
  const plannedDays = plannedRate > 0 ? Math.ceil(remaining / plannedRate) : null;
  const today = new Date();
  const plannedDate = plannedDays != null ? addWorkingDays(today, plannedDays, perWeek) : null;

  // Actual pace from submissions (avg per active capture day, last 14 capture days)
  const dayCounts = new Map<string, number>();
  for (const s of m.submissions) {
    const fid = s.feeder_id ?? (s.dt_id ? m.dtById.get(s.dt_id)?.feeder_id : null);
    if (fid !== f.feeder_id || !s.captured_at) continue;
    const day = s.captured_at.slice(0, 10);
    dayCounts.set(day, (dayCounts.get(day) ?? 0) + s.count);
  }
  const days = [...dayCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const recent = days.slice(-14);
  const actualRate = recent.length ? recent.reduce((s, [, n]) => s + n, 0) / recent.length : 0;
  const actualDays = actualRate > 0 ? Math.ceil(remaining / actualRate) : null;
  const actualDate = actualDays != null ? addWorkingDays(today, actualDays, perWeek) : null;
  const pct = est > 0 ? Math.min(100, (captured / est) * 100) : 0;
  return { captured, est, remaining, staff, target, perWeek, plannedRate, plannedDays, plannedDate, actualRate, actualDays, actualDate, pct, baseEst, bufferPct, dailySeries: days, dtCount: dts.length };
}

export const fmtDate = (d: Date | string | null | undefined) => {
  if (!d) return "—";
  const x = typeof d === "string" ? new Date(d) : d;
  if (isNaN(x.getTime())) return "—";
  return x.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

export function waLink(phone: string | null | undefined, text: string) {
  let p = (phone ?? "").replace(/\D/g, "");
  if (p.startsWith("0")) p = "234" + p.slice(1);
  return `https://wa.me/${p}?text=${encodeURIComponent(text)}`;
}

/**
 * Checks one capture against the lookup, staff list and allocations. Returns the problem, or "" when the capture is fine.
 * Same rules as the Capture Alerts list.
 */
export function captureIssueReason(m: Model, username: string | null, feederId: string | null, dtId: string | null): string {
  if (!dtId) return "No DT ID on capture";
  const dt = m.dtById.get(dtId);
  if (!dt) return "DT not in lookup";
  if (feederId && dt.feeder_id !== feederId) return `Feeder mismatch (captured on ${feederId}, DT belongs to ${dt.feeder_id})`;
  const en = m.enumByUser.get(norm(username));
  if (!en) return "Enumerator not on staff list";
  if (m.feederById.get(dt.feeder_id)?.locked) {
    const all = m.allocsByDt.get(dt.dt_id) ?? [];
    if (!all.some((a) => a.enumerator_id === en.id && a.status !== "cancelled")) return all.length ? "DT allocated to someone else" : "DT not allocated to anyone";
  }
  return "";
}

/** A DT counts as "private" when its type or name says so. Private DTs may be given to someone who already has another open DT. */
export const isPrivateDt = (d: DT | undefined | null) => /private/i.test(`${d?.dt_type ?? ""} ${d?.dt_name ?? ""}`);

/** Open (not completed) DTs each enumerator currently holds. */
export function openDtsByEnumerator(m: Model) {
  const out = new Map<string, DT[]>();
  for (const a of m.allocations) {
    if (a.status !== "active") continue;
    const d = m.dtById.get(a.dt_id);
    if (!d || d.status === "completed") continue;
    const arr = out.get(a.enumerator_id) ?? [];
    if (!arr.some((x) => x.dt_id === d.dt_id)) arr.push(d);
    out.set(a.enumerator_id, arr);
  }
  return out;
}

/** Instantly change the data on screen (before the database round-trip finishes). */
export function useOptimistic() {
  const qc = useQueryClient();
  return (fn: (m: Model) => Model) => qc.setQueryData<Model>(["appdata"], (old) => (old ? fn(old) : old));
}
