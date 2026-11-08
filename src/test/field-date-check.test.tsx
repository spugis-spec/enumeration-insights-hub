import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/field/db", () => ({ patchMany: vi.fn(async () => 0), upsertMany: vi.fn(), removeMany: vi.fn(), updateRow: vi.fn(), addRow: vi.fn(), safeId: (s: string) => s, listAll: vi.fn(async () => []) }));
vi.mock("@/lib/field/firebase", () => ({ auth: () => ({ currentUser: { uid: "u1" } }), db: () => ({}), currentUser: async () => ({ uid: "u1" }) }));

import { buildModel } from "@/lib/field/data";
import { findMissingOnDates, recentCaptureDates } from "@/lib/field/stale";

const feeder = (id: string): any => ({ id: `f-${id}`, feeder_id: id, feeder_name: `Feeder ${id}`, area: null, feeder_type: null, est_customer_points: null, start_date: null, locked: false });
const dt = (id: string, feeder_id = "F1", status = "assigned"): any => ({ id: `d-${id}`, dt_id: id, feeder_id, dt_name: `DT ${id}`, dt_type: null, status, status_note: null });
const en = (id: string, username: string, name: string): any => ({ id, username, full_name: name, phone: null, supervisor: null, active: true });
const al = (dt_id: string, enumerator_id: string, o: any = {}): any => ({ id: `${dt_id}-${enumerator_id}`, dt_id, enumerator_id, allocated_by: null, allocated_on: "2026-10-01", due_date: null, notes: null, status: "active", self_assigned: false, authorized: true, ...o });
const sub = (dt_id: string, day: string, username = "ada", feeder_id = "F1"): any => ({ id: `${username}|${dt_id}|${day}`, username, feeder_id, dt_id, captured_at: `${day}T10:00:00Z`, day, count: 3 });

const build = (subs: any[]) => buildModel({
  feeders: [feeder("F1"), feeder("F2")],
  dts: [dt("A"), dt("B"), dt("C"), dt("D", "F1", "unassigned"), dt("E"), dt("F", "F1", "completed"), dt("G"), dt("H", "F2")],
  enumerators: [en("e1", "ada", "Ada"), en("e2", "bayo", "Bayo"), en("e3", "chi", "Chi")],
  allocations: [al("A", "e1"), al("B", "e2"), al("C", "e3", { allocated_on: "2026-10-12" }), al("E", "e1", { self_assigned: true, authorized: false }), al("G", "e3"), al("H", "e1")],
  submissions: subs, vehicles: [], trips: [],
} as any);

// G is captured every day so the dates count as uploaded; A was last seen on the 12th, B on the 5th
const subs = [sub("G", "2026-10-11"), sub("G", "2026-10-12"), sub("G", "2026-10-13"), sub("A", "2026-10-12"), sub("B", "2026-10-05", "bayo")];

describe("check ongoing DTs against chosen dates", () => {
  it("today only: ongoing DTs with no capture today are listed, captured ones are not", () => {
    const r = findMissingOnDates({ m: build(subs), days: ["2026-10-13"] });
    expect(r.missing.map((x) => x.dt.dt_id)).toEqual(["A", "B", "C", "H"]);
    expect(r.found).toBe(1); // G
    expect(r.skipped).toEqual([]);
  });

  it("excludes unassigned, completed and still-unauthorized self-assigned DTs", () => {
    const ids = findMissingOnDates({ m: build(subs), days: ["2026-10-13"] }).missing.map((x) => x.dt.dt_id);
    expect(ids).not.toContain("D");
    expect(ids).not.toContain("F");
    expect(ids).not.toContain("E");
  });

  it("several dates: a DT seen on any of them stays ongoing", () => {
    const r = findMissingOnDates({ m: build(subs), days: ["2026-10-12", "2026-10-13"] });
    expect(r.missing.map((x) => x.dt.dt_id)).toEqual(["B", "C", "H"]);
  });

  it("skips dates with no uploaded data at all instead of flagging everything", () => {
    const r = findMissingOnDates({ m: build(subs), days: ["2026-10-14"] });
    expect(r.days).toEqual([]);
    expect(r.skipped).toEqual(["2026-10-14"]);
    expect(r.missing).toEqual([]);
    const mix = findMissingOnDates({ m: build(subs), days: ["2026-10-13", "2026-10-14"] });
    expect(mix.days).toEqual(["2026-10-13"]);
    expect(mix.skipped).toEqual(["2026-10-14"]);
  });

  it("ignores DTs assigned after the last checked date", () => {
    const r = findMissingOnDates({ m: build(subs), days: ["2026-10-11"] });
    expect(r.missing.map((x) => x.dt.dt_id)).not.toContain("C"); // allocated on the 12th
  });

  it("can be limited to one feeder", () => {
    const r = findMissingOnDates({ m: build(subs), days: ["2026-10-13"], feeders: ["F2"] });
    expect(r.missing.map((x) => x.dt.dt_id)).toEqual(["H"]);
  });

  it("reports when each missing DT was last captured and who holds it", () => {
    const r = findMissingOnDates({ m: build(subs), days: ["2026-10-13"] });
    const a = r.missing.find((x) => x.dt.dt_id === "A")!;
    expect(a.lastCapture).toBe("2026-10-12");
    expect(a.holders).toEqual(["Ada"]);
    expect(r.missing.find((x) => x.dt.dt_id === "C")!.lastCapture).toBeNull();
  });

  it("also lists unassigned DTs that were captured before, but never completed ones", () => {
    const withIdle = [...subs, sub("D", "2026-10-04"), sub("F", "2026-10-04")]; // D is unassigned, F is completed
    const r = findMissingOnDates({ m: build(withIdle), days: ["2026-10-13"] });
    expect(r.missing.map((x) => x.dt.dt_id)).toEqual(["A", "B", "C", "D", "H"]);
    expect(r.missing.map((x) => x.dt.dt_id)).not.toContain("F"); // completed stays completed
    const off = findMissingOnDates({ m: build(withIdle), days: ["2026-10-13"], includeUnassigned: false });
    expect(off.missing.map((x) => x.dt.dt_id)).not.toContain("D");
  });

  it("lists upload dates newest first and never future dates", () => {
    expect(recentCaptureDates(build([...subs, sub("G", "2099-01-01")]), 14, "2026-10-13")).toEqual(["2026-10-13", "2026-10-12", "2026-10-11", "2026-10-05"]);
  });
});
