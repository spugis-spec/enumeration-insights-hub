import { describe, expect, it } from "vitest";
import { buildModel, captureIssueReason, SELF_REASON, type Allocation, type DT, type Enumerator, type Feeder, type Resolution, type Submission } from "@/lib/field/data";
import { buildDtWork, planSelfAssign } from "@/lib/field/fieldwork";
import { scopeFeederIds } from "@/lib/field/scope";

const feeder = (id: string, o: Partial<Feeder> = {}): Feeder => ({ id, feeder_id: id, feeder_name: id, area: null, feeder_type: null, est_customer_points: null, start_date: null, target_per_staff_day: 40, working_days_per_week: 6, locked: false, ...o });
const dt = (id: string, feeder_id = "F1", o: Partial<DT> = {}): DT => ({ id, dt_id: id, feeder_id, dt_name: id, dt_type: null, status: "unassigned", status_note: null, ...o });
const en = (id: string, username: string, o: Partial<Enumerator> = {}): Enumerator => ({ id, username, full_name: username, phone: null, supervisor: null, active: true, ...o });
const al = (dt_id: string, enumerator_id: string, o: Partial<Allocation> = {}): Allocation => ({ id: `${dt_id}-${enumerator_id}`, dt_id, enumerator_id, allocated_by: null, allocated_on: "2026-10-01", due_date: null, notes: null, status: "active", completed_on: null, ...o });
const sub = (username: string, dt_id: string, o: Partial<Submission> = {}): Submission => ({ id: `${o.source ?? "c"}|${username}|${dt_id}`, username, feeder_id: "F1", dt_id, captured_at: "2026-10-10T10:00:00.000Z", day: "2026-10-10", count: 1, ...o });

const base = (extra: Record<string, any> = {}) => ({
  feeders: [feeder("F1")], dts: [dt("D1"), dt("D2"), dt("D3")], enumerators: [en("e1", "ada", { supervisor: "Boss Man" }), en("e2", "bob")],
  allocations: [al("D1", "e1")], submissions: [] as Submission[], vehicles: [], trips: [], ...extra,
});

describe("LT pole and scope", () => {
  it("keeps LT poles out of customer counts but still checks who captured them", () => {
    const m = buildModel(base({ submissions: [sub("ada", "D1", { count: 5 }), sub("bob", "D1", { count: 2, source: "ltpole" })] }));
    expect(m.subsByDt.get("D1")).toBe(5);
    expect(m.ltSubmissions).toHaveLength(1);
    const a = m.alerts.find((x) => x.username === "bob")!;
    expect(a.reason).toBe("DT allocated to someone else");
    expect(a.source).toBe("ltpole");
  });
  it("ignores captures for feeders that were not uploaded, but flags a wrong feeder on a lookup DT", () => {
    const m = buildModel(base({ submissions: [sub("ada", "X9", { feeder_id: "F9" }), sub("ada", "D1", { feeder_id: "F9" })] }));
    expect(m.alerts.map((a) => a.reason)).toEqual(["Feeder mismatch (captured on F9, DT belongs to F1)"]);
  });
  it("chosen feeders narrow the scope, unknown ones are dropped", () => {
    expect([...scopeFeederIds({ feeders: ["F1", "Z"], from: "", to: "" }, ["F1", "F2"])]).toEqual(["F1"]);
    expect(scopeFeederIds({ feeders: null, from: "", to: "" }, ["F1", "F2"]).size).toBe(2);
  });
});

describe("who is on the DT", () => {
  it("flags a non-holder on any feeder, but a team partner is fine", () => {
    const solo = buildModel(base({ submissions: [sub("bob", "D1")] }));
    expect(solo.alerts[0]?.reason).toBe("DT allocated to someone else");
    const team = buildModel(base({ allocations: [al("D1", "e1"), al("D1", "e2")], submissions: [sub("bob", "D1")] }));
    expect(team.alerts).toHaveLength(0);
  });
  it("shows both partners' work on a team DT and flags the partner with no capture", () => {
    const m = buildModel(base({ allocations: [al("D1", "e1"), al("D1", "e2")], submissions: [sub("ada", "D1", { count: 4 })] }));
    const [row] = buildDtWork(m, null);
    expect(row!.team).toBe(true);
    expect(row!.teamGaps).toEqual(["bob"]);
    const both = buildDtWork(buildModel(base({ allocations: [al("D1", "e1"), al("D1", "e2")], submissions: [sub("ada", "D1"), sub("bob", "D1")] })), null)[0]!;
    expect(both.teamGaps).toEqual([]);
    expect(both.state).toBe("ok");
  });
  it("labels supervisors, people who have left and strangers, and keeps names saved on the DT", () => {
    const res: Resolution = { id: "r", kind: "user", key: "gone", response: "Left", resolved_at: "2026-10-01" };
    const m = buildModel(base({
      dts: [dt("D1", "F1", { worked_by: ["oldtimer"] })],
      alert_resolutions: [res],
      submissions: [sub("ada", "D1"), sub("boss man", "D1"), sub("gone", "D1"), sub("stranger", "D1")],
    }));
    const row = buildDtWork(m, null)[0]!;
    const kind = Object.fromEntries(row.workers.map((w) => [w.username, w.kind]));
    expect(kind).toMatchObject({ ada: "staff", "boss man": "supervisor", gone: "former", stranger: "unknown", oldtimer: "unknown" });
    expect(row.workers.find((w) => w.username === "gone")!.note).toBe("Left");
    expect(row.workers.find((w) => w.username === "oldtimer")!.historyOnly).toBe(true);
    expect(row.state).toBe("wrong_staff");
  });
  it("respects the date range and the feeder scope", () => {
    const m = buildModel(base({ dts: [dt("D1"), dt("D5", "F2")], feeders: [feeder("F1"), feeder("F2")], submissions: [sub("ada", "D1"), sub("ada", "D5", { feeder_id: "F2" })] }));
    expect(buildDtWork(m, new Set(["F1"])).map((r) => r.dt.dt_id)).toEqual(["D1"]);
    expect(buildDtWork(m, null, { from: "2026-10-11", to: "" })).toHaveLength(0);
  });
});

describe("self-assignment", () => {
  it("assigns a DT nobody holds to the capturer, awaiting authorisation, and remembers every username", () => {
    const m = buildModel(base({ submissions: [] }));
    const plan = planSelfAssign(m, [{ username: "bob", dt_id: "D2", day: "2026-10-09" }, { username: "stranger", dt_id: "D2" }], "uid1");
    expect(plan.allocs).toHaveLength(1);
    expect(plan.allocs[0]).toMatchObject({ dt_id: "D2", enumerator_id: "e2", self_assigned: true, authorised: false, allocated_on: "2026-10-09" });
    const p = plan.dtPatches.find((x) => x.id === "D2")!.patch;
    expect(p["status"]).toBe("assigned");
    expect(p["worked_by"]).toEqual(["bob", "stranger"]);
  });
  it("never overrides an existing allocation and only flags locked feeders", () => {
    const m = buildModel(base({ feeders: [feeder("F1", { locked: true })] }));
    const plan = planSelfAssign(m, [{ username: "bob", dt_id: "D1" }, { username: "bob", dt_id: "D2" }], null);
    expect(plan.allocs).toHaveLength(0);
    expect(plan.lockedSkipped).toEqual(["D2"]);
    expect(plan.dtPatches.find((x) => x.id === "D1")!.patch["status"]).toBeUndefined();
  });
  it("lists the DT as awaiting authorisation until authorised", () => {
    const pending = buildModel(base({ allocations: [al("D2", "e2", { self_assigned: true, authorised: false })], submissions: [sub("bob", "D2")] }));
    expect(buildDtWork(pending, null)[0]!.state).toBe("unauthorised");
    const done = buildModel(base({ allocations: [al("D2", "e2", { self_assigned: true, authorised: true })], submissions: [sub("bob", "D2")] }));
    expect(buildDtWork(done, null)[0]!.state).toBe("ok");
  });
  it("flags the row at upload time when the DT is not assigned on the app", () => {
    const m = buildModel(base());
    expect(captureIssueReason(m, "bob", "F1", "D2", "2026-10-10")).toBe(SELF_REASON);
    expect(captureIssueReason(m, "ada", "F1", "D1", "2026-10-10")).toBe("");
    expect(captureIssueReason(m, "bob", "F1", "D1", "2026-10-10")).toBe("DT allocated to someone else");
  });
});
