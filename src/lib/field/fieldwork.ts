import type { Allocation, DT, Enumerator, Model } from "./data";
import { inDateRange, type Scope } from "./scope";

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
const squash = (x: string | null | undefined) => norm(x).replace(/[^a-z0-9]/g, "");

export type WorkerKind = "staff" | "supervisor" | "former" | "unknown";
export type DtWorker = {
  key: string; username: string; enumerator?: Enumerator | undefined; kind: WorkerKind;
  /** For "former": why they are out (Left, Resigned, …) */ note: string | null;
  customers: number; poles: number; first: string | null; last: string | null;
  isHolder: boolean; historyOnly: boolean;
};
/** self = nobody assigned on the app · unauthorised = the app assigned it from the upload, awaiting a supervisor · wrong_staff = someone captured who isn't on the DT · ok */
export type DtWorkState = "self" | "unauthorised" | "wrong_staff" | "ok";
export type DtWork = {
  dt: DT; feederName: string; workers: DtWorker[]; holders: Enumerator[]; team: boolean; teamGaps: string[];
  state: DtWorkState; customers: number; poles: number; selfAllocIds: string[]; liveAllocIds: string[];
};

/**
 * Every DT that has a capture (customer or LT pole), with everyone who worked on it. People who have left, supervisors and
 * unknown usernames are kept on the DT and labelled, so it is always clear who worked there.
 */
export function buildDtWork(m: Model, feederIds: Set<string> | null, range: Pick<Scope, "from" | "to"> = { from: "", to: "" }): DtWork[] {
  const supervisorKeys = new Set(m.enumerators.map((e) => squash(e.supervisor)).filter(Boolean));
  const resUser = new Map((m.alert_resolutions ?? []).filter((r) => r.kind === "user").map((r) => [r.key, r]));
  const dated = !!(range.from || range.to);

  type Acc = { username: string; customers: number; poles: number; first: string | null; last: string | null };
  const byDt = new Map<string, Map<string, Acc>>();
  const add = (list: Model["submissions"], lt: boolean) => {
    for (const s of list) {
      if (!s.dt_id || !s.username) continue;
      const dt = m.dtById.get(s.dt_id);
      if (!dt || (feederIds && !feederIds.has(dt.feeder_id))) continue;
      if (!inDateRange(s.day ?? s.captured_at?.slice(0, 10), range)) continue;
      const people = byDt.get(s.dt_id) ?? new Map<string, Acc>();
      const k = norm(s.username);
      const a = people.get(k) ?? { username: s.username, customers: 0, poles: 0, first: null, last: null };
      if (lt) a.poles += s.count; else a.customers += s.count;
      const at = s.captured_at;
      if (at && (!a.first || at < a.first)) a.first = at;
      if (at && (!a.last || at > a.last)) a.last = at;
      people.set(k, a);
      byDt.set(s.dt_id, people);
    }
  };
  add(m.submissions, false);
  add(m.ltSubmissions, true);

  const out: DtWork[] = [];
  for (const [dtId, people] of byDt) {
    const dt = m.dtById.get(dtId)!;
    // names saved on the DT from earlier uploads stay visible (not when looking at a date range)
    if (!dated) for (const n of dt.worked_by ?? []) if (!people.has(norm(n))) people.set(norm(n), { username: n, customers: 0, poles: 0, first: null, last: null });

    const live: Allocation[] = (m.allocsByDt.get(dtId) ?? []).filter((a) => a.status !== "cancelled");
    const holderIds = new Set(live.map((a) => a.enumerator_id));
    const holders = [...holderIds].map((id) => m.enumById.get(id)).filter((e): e is Enumerator => !!e);

    const workers: DtWorker[] = [...people.entries()].map(([key, a]) => {
      const en = m.enumByUser.get(key);
      const res = resUser.get(key);
      let kind: WorkerKind = "unknown";
      let note: string | null = null;
      if (en && en.active !== false) kind = "staff";
      else if (supervisorKeys.has(squash(a.username)) || res?.response === "Supervisor") kind = "supervisor";
      else if (en || res) { kind = "former"; note = res?.response ?? "Inactive"; }
      return { key, username: a.username, enumerator: en, kind, note, customers: a.customers, poles: a.poles, first: a.first, last: a.last, isHolder: !!en && holderIds.has(en.id), historyOnly: a.customers + a.poles === 0 };
    }).sort((x, y) => (y.customers + y.poles) - (x.customers + x.poles));

    const active = workers.filter((w) => !w.historyOnly);
    const selfAllocs = live.filter((a) => a.self_assigned && !a.authorised);
    let state: DtWorkState = "ok";
    if (!live.length) state = "self";
    else if (active.some((w) => !w.isHolder)) state = "wrong_staff";
    else if (selfAllocs.length) state = "unauthorised";

    // On a team DT every member's work should show; list the members with no capture.
    const team = holders.length > 1;
    const teamGaps = team ? holders.filter((h) => !active.some((w) => w.enumerator?.id === h.id)).map((h) => h.full_name || h.username) : [];
    out.push({
      dt, feederName: m.feederById.get(dt.feeder_id)?.feeder_name ?? dt.feeder_id, workers, holders, team, teamGaps, state,
      customers: workers.reduce((n, w) => n + w.customers, 0), poles: workers.reduce((n, w) => n + w.poles, 0),
      selfAllocIds: selfAllocs.map((a) => a.id), liveAllocIds: live.map((a) => a.id),
    });
  }
  const rank: Record<DtWorkState, number> = { wrong_staff: 0, self: 1, unauthorised: 2, ok: 3 };
  return out.sort((a, b) => rank[a.state] - rank[b.state] || a.feederName.localeCompare(b.feederName) || a.dt.dt_id.localeCompare(b.dt.dt_id));
}

export type CaptureGroup = { username: string | null; dt_id: string | null; captured_at?: string | null; day?: string | null };

/**
 * After an upload: every in-scope DT that has captures but nobody assigned on the app is assigned to the staff who captured it
 * (flagged self-assigned, awaiting a supervisor), its status becomes "assigned" so it can later be set to completed etc, and
 * every username that worked on it is saved on the DT. Existing allocations are never touched; locked feeders are only flagged.
 */
export function planSelfAssign(m: Model, groups: CaptureGroup[], uid: string | null, today = new Date().toISOString().slice(0, 10)) {
  const byDt = new Map<string, { names: Map<string, string>; first: string | null }>();
  for (const g of groups) {
    if (!g.dt_id || !g.username) continue;
    const cur = byDt.get(g.dt_id) ?? { names: new Map<string, string>(), first: null };
    cur.names.set(norm(g.username), g.username.trim());
    const at = g.captured_at ?? g.day ?? null;
    if (at && (!cur.first || at < cur.first)) cur.first = at;
    byDt.set(g.dt_id, cur);
  }
  const allocs: Record<string, any>[] = [];
  const dtPatches: { id: string; patch: Record<string, any> }[] = [];
  const selfDts: string[] = [];
  const lockedSkipped: string[] = [];
  const now = new Date().toISOString();
  for (const [dtId, v] of byDt) {
    const dt = m.dtById.get(dtId);
    if (!dt) continue;
    const patch: Record<string, any> = {};
    const known = new Set((dt.worked_by ?? []).map(norm));
    const merged = [...(dt.worked_by ?? [])];
    for (const [k, name] of v.names) if (!known.has(k)) merged.push(name);
    if (merged.length !== (dt.worked_by ?? []).length) patch["worked_by"] = merged;

    const hasLive = (m.allocsByDt.get(dtId) ?? []).some((a) => a.status !== "cancelled");
    if (!hasLive) {
      if (m.feederById.get(dt.feeder_id)?.locked) lockedSkipped.push(dtId);
      else {
        const staff = [...v.names.keys()].map((k) => m.enumByUser.get(k)).filter((e): e is Enumerator => !!e);
        for (const e of staff)
          allocs.push({
            dt_id: dtId, enumerator_id: e.id, allocated_on: v.first?.slice(0, 10) ?? today, due_date: null,
            notes: "Self-assigned: captured in an upload but not assigned on the app. Awaiting supervisor authorisation.",
            allocated_by: uid, status: "active", completed_on: null, self_assigned: true, authorised: false,
          });
        selfDts.push(dtId);
        if (dt.status === "unassigned") {
          patch["status"] = "assigned";
          patch["status_note"] = `Self-assigned by ${[...v.names.values()].map((n) => "@" + n).join(", ")}: awaiting authorisation and a status update`;
          patch["updated_at"] = now;
        }
      }
    }
    if (Object.keys(patch).length) dtPatches.push({ id: dt.id, patch });
  }
  return { allocs, dtPatches, selfDts, lockedSkipped };
}
