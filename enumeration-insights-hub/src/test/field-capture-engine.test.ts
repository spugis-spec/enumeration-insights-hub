import { describe, expect, it } from "vitest";
import { analyzeCaptures, mergeWorkers, readRow, scanFeeders, type CaptureInput } from "@/lib/field/captureEngine";
import { buildModel, SELF_ASSIGNED_REASON, STAFF_REASON, WRONG_FEEDER_REASON } from "@/lib/field/data";

const feeder = (id: string): any => ({ id: `f-${id}`, feeder_id: id, feeder_name: `Feeder ${id}`, area: null, feeder_type: null, est_customer_points: null, start_date: null, locked: false });
const dt = (id: string, f = "F1", o: any = {}): any => ({ id: `d-${id}`, dt_id: id, feeder_id: f, dt_name: `DT ${id}`, dt_type: null, status: "unassigned", status_note: null, ...o });
const en = (id: string, username: string, name: string, supervisor: string | null = null): any => ({ id, username, full_name: name, phone: null, supervisor, active: true });
const al = (dt_id: string, enumerator_id: string, o: any = {}): any => ({ id: `${dt_id}-${enumerator_id}`, dt_id, enumerator_id, allocated_by: null, allocated_on: "2026-10-01", due_date: null, notes: null, status: "active", completed_on: null, ...o });

const model = (extra: any = {}) =>
  buildModel({
    feeders: [feeder("F1"), feeder("F2")],
    dts: [dt("D1", "F1", { status: "assigned" }), dt("D2", "F1", { status: "assigned" }), dt("D3", "F1"), dt("D9", "F2")],
    enumerators: [en("e1", "ada", "Ada", "John Doe"), en("e2", "bayo", "Bayo"), en("e3", "chi", "Chi")],
    allocations: [al("D1", "e2"), al("D2", "e1")],
    submissions: [], vehicles: [], trips: [], ...extra,
  });

const cust = (rows: any[]): CaptureInput => ({ source: "customer", label: "cust.csv", rows });
const lt = (rows: any[]): CaptureInput => ({ source: "lt", label: "lt.csv", rows });
const row = (username: string, dtId: string | null, o: any = {}) => ({ username, feeder: "F1", "DT ID": dtId, time: "2026-10-13 10:00:00", fid: "7", ...o });
const scope = (feeders = ["F1"], from: string | null = null, to: string | null = null) => ({ feeders, from, to });

describe("scan and read", () => {
  it("lists feeders found and whether each is in the lookup", () => {
    const s = scanFeeders([cust([row("ada", "D2"), row("ada", "D2", { feeder: "X9", "DT ID": null }), row("bayo", "D9", { feeder: "F2" })])], model());
    expect(s.feeders.map((f) => [f.feeder_id, f.inLookup])).toEqual([["F1", true], ["F2", true], ["X9", false]]);
  });
  it("finds the DT ID in a raw dss_fdr column and reads structure and building", () => {
    const f = readRow({ username: "ada", dss_fdr1_x: "501101000012345", structure_no: "S5", building_code: "B1", customer_no: "C1", fid: "12" });
    expect(f).toMatchObject({ dt: "501101000012345", structure: "S5", building: "B1", customer: "C1", fid: "12" });
  });
});

describe("working only with the chosen feeders", () => {
  const rows = [row("ada", "D2"), row("bayo", "D9", { feeder: "F2" }), row("stranger", "D2", { feeder: "X9", "DT ID": null }), row("ada", null, { feeder: "X9" })];
  const a = analyzeCaptures({ inputs: [cust(rows)], m: model(), scope: scope() });
  it("ignores other feeders and strangers on feeders that are not in the lookup", () => {
    expect(a.stats.ignoredNotFocused).toBe(1);
    expect(a.stats.ignoredNotInLookup).toBe(1);
  });
  it("flags a staff member working here who picked a feeder that is not in the lookup", () => {
    const w = a.issues.find((i) => i.reason === WRONG_FEEDER_REASON)!;
    expect(w).toMatchObject({ username: "ada", feeder_id: "X9" });
  });
  it("saves only in-scope captures", () => {
    expect(a.groups.map((g) => g.dt_id)).toEqual(["D2"]);
  });
  it("limits by date", () => {
    const r = analyzeCaptures({ inputs: [cust([row("ada", "D2", { time: "2026-10-12 09:00:00" }), row("ada", "D2")])], m: model(), scope: scope(["F1"], "2026-10-13", "2026-10-13") });
    expect(r.stats.ignoredDates).toBe(1);
    expect(r.groups).toHaveLength(1);
  });
});

describe("flags and what they return", () => {
  it("returns FID, DT ID, feeder, building code, structure and customer number for a capture on someone else's DT", () => {
    const a = analyzeCaptures({ inputs: [lt([row("ada", "D1", { fid: "99", structure_no: "S77" })]), cust([row("ada", "D1", { fid: "5", building_code: "B9", customer_no: "C3" })])], m: model(), scope: scope() });
    const ltIssue = a.issues.find((i) => i.source === "lt")!;
    const cuIssue = a.issues.find((i) => i.source === "customer")!;
    expect(ltIssue).toMatchObject({ reason: "DT allocated to someone else", fid: "99", dt_id: "D1", feeder_id: "F1", structure_no: "S77" });
    expect(cuIssue).toMatchObject({ fid: "5", building_code: "B9", customer_no: "C3", dt_id: "D1" });
    expect(a.report[0]).toMatchObject({ kind: "other_holder", holders: ["Bayo"] });
  });
  it("notes when the DT belongs to a team partner", () => {
    const pairs: any = [{ key: "t", name: "Team 1", members: [{ group: "nysc", username: "ada", name: "Ada", enumeratorId: "e1" }, { group: "nysc", username: "bayo", name: "Bayo", enumeratorId: "e2" }] }];
    const a = analyzeCaptures({ inputs: [cust([row("ada", "D1")])], m: model(), scope: scope(), pairs });
    expect(a.report.find((r) => r.kind === "other_holder")!.partner).toBe(true);
  });
  it("flags a username that is not on the staff list but leaves supervisors and resolved people alone, and remembers all of them on the DT", () => {
    const m = model({ alert_resolutions: [{ id: "u", kind: "user", key: "ghost", response: "Resigned", resolved_at: "x" }] });
    const a = analyzeCaptures({ inputs: [cust([row("nobody", "D2"), row("john.doe", "D2"), row("ghost", "D2")])], m, scope: scope() });
    expect(a.issues.map((i) => [i.username, i.reason])).toEqual([["nobody", STAFF_REASON]]);
    expect(a.workers.get("D2")!.map((w) => w.username).sort()).toEqual(["ghost", "john.doe", "nobody"]);
  });
  it("flags a capture after the DT was completed", () => {
    const m = model({ allocations: [al("D2", "e1", { status: "completed", completed_on: "2026-10-10" })] });
    const a = analyzeCaptures({ inputs: [cust([row("ada", "D2")])], m, scope: scope() });
    expect(a.issues[0]!.reason).toBe("Captured after DT was completed");
  });
});

describe("self-assignment", () => {
  it("self-assigns a DT nobody was assigned, to whoever captured it, and flags it for authorization", () => {
    const a = analyzeCaptures({ inputs: [cust([row("ada", "D3"), row("ada", "D3"), row("chi", "D3")])], m: model(), scope: scope() });
    expect(a.selfAssign.map((s) => [s.dt.dt_id, s.enumerator.username, s.count]).sort()).toEqual([["D3", "ada", 2], ["D3", "chi", 1]]);
    // chi has nothing ongoing: plain self-assigned. ada still has D2 ongoing: the more useful flag.
    expect(a.issues.filter((i) => i.username === "chi").every((i) => i.reason === SELF_ASSIGNED_REASON)).toBe(true);
    expect(a.issues.filter((i) => i.username === "ada").every((i) => i.reason === "Has an ongoing DT but captured on a different DT")).toBe(true);
    expect(a.report.map((r) => r.kind).sort()).toEqual(["left_ongoing", "self_assigned"]);
  });
  it("does not assign again once the self-assigned allocation exists, but keeps flagging until authorized", () => {
    const pending = { self_assigned: true, authorized: false };
    const m = model({ allocations: [al("D1", "e2"), al("D2", "e1"), al("D3", "e1", pending)] });
    const a = analyzeCaptures({ inputs: [cust([row("ada", "D3")])], m, scope: scope() });
    expect(a.selfAssign).toHaveLength(0);
    expect(a.issues[0]!.reason).toBe(SELF_ASSIGNED_REASON);
    const ok = model({ allocations: [al("D1", "e2"), al("D2", "e1"), al("D3", "e1", { self_assigned: true, authorized: true })] });
    expect(analyzeCaptures({ inputs: [cust([row("ada", "D3")])], m: ok, scope: scope() }).issues).toHaveLength(0);
  });
  it("does not self-assign a DT already marked completed", () => {
    const m = model({ dts: [dt("D3", "F1", { status: "completed" }), dt("D1", "F1", { status: "assigned" }), dt("D2", "F1", { status: "assigned" })] });
    const a = analyzeCaptures({ inputs: [cust([row("ada", "D3")])], m, scope: scope() });
    expect(a.selfAssign).toHaveLength(0);
    expect(a.issues[0]!.reason).toBe("DT not allocated to anyone");
  });
});

describe("who worked on a DT", () => {
  it("keeps every username on the DT with a distinct kind, and LT captures do not inflate customer counts", () => {
    const m = model({
      dts: [dt("D2", "F1", { status: "assigned", workers: [{ username: "old.timer", first: "2026-09-01", last: "2026-09-02", source: "customer" }] }), dt("D1", "F1", { status: "assigned" }), dt("D3")],
      alert_resolutions: [{ id: "u", kind: "user", key: "old.timer", response: "Resigned", resolved_at: "x" }],
      submissions: [
        { id: "a", username: "ada", feeder_id: "F1", dt_id: "D2", captured_at: "2026-10-13T10:00:00Z", day: "2026-10-13", count: 4 },
        { id: "b", username: "ada", feeder_id: "F1", dt_id: "D2", captured_at: "2026-10-13T11:00:00Z", day: "2026-10-13", count: 6, source: "lt" },
        { id: "c", username: "john.doe", feeder_id: "F1", dt_id: "D2", captured_at: "2026-10-13T12:00:00Z", day: "2026-10-13", count: 1 },
      ],
    });
    const caps = m.capturersByDt.get("D2")!;
    const by = Object.fromEntries(caps.map((c) => [c.username, c]));
    expect(by["ada"]).toMatchObject({ kind: "staff", count: 10, sources: ["Customer", "LT Pole"] });
    expect(by["john.doe"]).toMatchObject({ kind: "supervisor" });
    expect(by["old.timer"]).toMatchObject({ kind: "left", label: "Resigned" });
    expect(m.subsByDt.get("D2")).toBe(5); // customers only: 4 + 1
    expect(m.submissions).toHaveLength(3); // but everything is kept for backups
  });
  it("marks a capturer whose allocation is self-assigned and unauthorized", () => {
    const m = model({ allocations: [al("D3", "e1", { self_assigned: true, authorized: false })], submissions: [{ id: "a", username: "ada", feeder_id: "F1", dt_id: "D3", captured_at: null, day: null, count: 1 }] });
    expect(m.capturersByDt.get("D3")![0]!.selfAssigned).toBe(true);
    expect(m.pendingAuth).toHaveLength(1);
  });
  it("merges workers without ever dropping a name", () => {
    const merged = mergeWorkers([{ username: "old", first: "2026-09-01", last: "2026-09-05" }], [{ username: "Old", first: "2026-08-30", last: "2026-10-01" }, { username: "new", first: null, last: null }]);
    expect(merged).toHaveLength(2);
    expect(merged.find((w) => w.username === "old")).toMatchObject({ first: "2026-08-30", last: "2026-10-01" });
  });
});

describe("ongoing DTs, confirmation and automatic clearing", () => {
  it("flags someone who still has an ongoing DT but captured on a different one, and says which DT they should be on", () => {
    const m = model(); // ada is allocated D2 (ongoing); D3 is nobody's
    const a = analyzeCaptures({ inputs: [cust([row("ada", "D3")])], m, scope: scope() });
    expect(a.issues[0]).toMatchObject({ reason: "Has an ongoing DT but captured on a different DT", dt_id: "D3", correct_dt: "D2" });
    expect(a.selfAssign.map((s) => s.dt.dt_id)).toEqual(["D3"]); // still recorded as self-assigned, awaiting authorization
    expect(a.report[0]).toMatchObject({ kind: "left_ongoing" });
  });
  it("does not flag that once the earlier DT is completed", () => {
    const m = model({ allocations: [al("D1", "e2"), al("D2", "e1", { status: "completed", completed_on: "2026-10-01" })], dts: [dt("D1", "F1", { status: "assigned" }), dt("D2", "F1", { status: "completed" }), dt("D3")] });
    const a = analyzeCaptures({ inputs: [cust([row("ada", "D3")])], m, scope: scope() });
    expect(a.issues[0]!.reason).toBe(SELF_ASSIGNED_REASON);
  });
  it("names the correct DT on a capture made on a DT someone else holds", () => {
    const a = analyzeCaptures({ inputs: [cust([row("ada", "D1")])], m: model(), scope: scope() });
    expect(a.issues[0]).toMatchObject({ reason: "DT allocated to someone else", correct_dt: "D2" });
  });
  it("confirms assigned staff who captured on their own DT, per date, and remembers when they last worked", () => {
    const a = analyzeCaptures({ inputs: [cust([row("ada", "D2", { time: "2026-10-12 09:00:00" }), row("ada", "D2", { time: "2026-10-13 09:00:00" }), row("bayo", "D1")])], m: model(), scope: scope() });
    expect(a.issues).toHaveLength(0);
    expect(a.confirmed.find((c) => c.dt_id === "D2")).toMatchObject({ users: ["ada"], days: ["2026-10-12", "2026-10-13"], count: 2 });
    expect(a.worked.find((w) => w.allocId === "D2-e1")!.last).toBe("2026-10-13");
    expect(a.confirmed).toHaveLength(2);
  });
  it("hides a flagged capture automatically once the DT is allocated or authorized to that person", () => {
    const issue = { id: "i1", username: "ada", feeder_id: "F1", dt_id: "D3", captured_at: null, reason: SELF_ASSIGNED_REASON, call_back_form_no: null, customer_no: null, building_code: null, upload: "x" };
    const pending = model({ capture_issues: [issue], allocations: [al("D1", "e2"), al("D3", "e1", { self_assigned: true, authorized: false })] });
    expect(pending.capture_issues).toHaveLength(1);
    const authorized = model({ capture_issues: [issue], allocations: [al("D1", "e2"), al("D3", "e1", { self_assigned: true, authorized: true })] });
    expect(authorized.capture_issues).toHaveLength(0);
    const teamAllocated = model({ capture_issues: [{ ...issue, reason: "DT allocated to someone else" }], allocations: [al("D3", "e1")] });
    expect(teamAllocated.capture_issues).toHaveLength(0);
    const other = model({ capture_issues: [{ ...issue, username: "chi" }], allocations: [al("D3", "e1")] });
    expect(other.capture_issues).toHaveLength(1); // someone else's allocation does not clear chi's flag
  });
});
