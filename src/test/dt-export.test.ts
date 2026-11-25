import { describe, expect, it } from "vitest";
import { buildModel } from "@/lib/field/data";
import { buildDtExport } from "@/lib/field/dtExport";

const feeder = (id: string): any => ({ id: `f-${id}`, feeder_id: id, feeder_name: `Feeder ${id}`, area: null, feeder_type: null, est_customer_points: null, start_date: null, locked: false });
const dt = (id: string, f = "F1", o: any = {}): any => ({ id: `d-${id}`, dt_id: id, feeder_id: f, dt_name: `DT ${id}`, dt_type: "Public", status: "unassigned", status_note: null, ...o });
const en = (id: string, username: string, name: string): any => ({ id, username, full_name: name, phone: null, supervisor: null, active: true });
const al = (dt_id: string, enumerator_id: string, o: any = {}): any => ({ id: `${dt_id}-${enumerator_id}-${o.status ?? "active"}`, dt_id, enumerator_id, allocated_by: null, allocated_on: "2026-10-01", due_date: null, notes: null, status: "active", completed_on: null, ...o });

const STAFF = [en("e1", "ada", "Ada"), en("e2", "bayo", "Bayo")];

const model = () =>
  buildModel({
    feeders: [feeder("F1"), feeder("F2"), feeder("F3")],
    dts: [
      // deliberately unordered: rows must come out sorted by DT_ID
      dt("D5", "F1", { status: "access_denied" }),
      dt("D1", "F1", {
        status: "completed", lat: 9.03, lng: 7.49,
        workers: [
          { username: "ada", first: "2026-09-20T00:00:00.000Z", last: "2026-10-01T00:00:00.000Z", source: "customer" },
          { username: "oldperson", first: "2026-09-21T00:00:00.000Z", last: "2026-09-22T00:00:00.000Z", source: "customer" },
          { username: "ada", first: "2026-09-23T00:00:00.000Z", last: "2026-09-24T00:00:00.000Z", source: "lt" },
        ],
      }),
      dt("D3", "F1"),
      dt("D2", "F1", { status: "assigned" }),
      dt("D4", "F1", { status: "problematic" }),
      dt("D9", "F2", { status: "completed" }),
    ],
    enumerators: STAFF,
    allocations: [
      al("D1", "e1", { status: "completed", allocated_on: "2026-09-01", completed_on: "2026-10-05" }),
      al("D1", "e2", { status: "cancelled", allocated_on: "2026-08-01" }), // cancelled: must not appear anywhere
      al("D2", "e2", { allocated_on: "2026-09-15" }),
      al("D2", "e1", { allocated_on: "2026-10-02" }),
    ],
    submissions: [], vehicles: [], trips: [],
  });

describe("buildDtExport", () => {
  it("counts every group on the feeder, and only that feeder", () => {
    const m = model();
    const { counts } = buildDtExport(m, m.feederById.get("F1")!, "all");
    expect(counts).toEqual({ completed: 1, ongoing: 1, not_assigned: 1, all: 5 });
  });

  it("puts each status in its group; 'all' also includes problematic and access denied", () => {
    const m = model();
    const f = m.feederById.get("F1")!;
    expect(buildDtExport(m, f, "completed").rows.map((r) => r["DT_ID"])).toEqual(["D1"]);
    expect(buildDtExport(m, f, "ongoing").rows.map((r) => r["DT_ID"])).toEqual(["D2"]);
    expect(buildDtExport(m, f, "not_assigned").rows.map((r) => r["DT_ID"])).toEqual(["D3"]);
    expect(buildDtExport(m, f, "all").rows.map((r) => r["DT_ID"])).toEqual(["D1", "D2", "D3", "D4", "D5"]);
  });

  it("names only the live allocations, with the earliest allocation date", () => {
    const m = model();
    const f = m.feederById.get("F1")!;
    const d2 = buildDtExport(m, f, "ongoing").rows[0]!;
    expect(d2["ALLOCATED_TO"]).toBe("Bayo; Ada");
    expect(d2["ALLOCATED_ON"]).toBe("2026-09-15");
    const d1 = buildDtExport(m, f, "completed").rows[0]!;
    expect(d1["ALLOCATED_TO"]).toBe("Ada"); // Bayo's allocation was cancelled
    expect(d1["ALLOCATED_ON"]).toBe("2026-09-01");
    expect(d1["COMPLETED_ON"]).toBe("2026-10-05");
    expect(d1["STATUS"]).toBe("Completed");
  });

  it("joins the DT's workers once each and includes its own coordinates", () => {
    const m = model();
    const d1 = buildDtExport(m, m.feederById.get("F1")!, "completed").rows[0]!;
    expect(d1["WORKERS"]).toBe("ada; oldperson");
    expect(d1["LONGITUDE"]).toBe(7.49);
    expect(d1["LATITUDE"]).toBe(9.03);
    expect(d1["FEEDER_NAME"]).toBe("Feeder F1");
    expect(d1["FEEDER_ID"]).toBe("F1");
  });

  it("leaves allocation, worker and coordinate cells blank when there is nothing to show", () => {
    const m = model();
    const d3 = buildDtExport(m, m.feederById.get("F1")!, "not_assigned").rows[0]!;
    expect(d3["ALLOCATED_TO"]).toBe("");
    expect(d3["ALLOCATED_ON"]).toBe("");
    expect(d3["COMPLETED_ON"]).toBe("");
    expect(d3["WORKERS"]).toBe("");
    expect(d3["LONGITUDE"]).toBe("");
    expect(d3["LATITUDE"]).toBe("");
  });

  it("an empty feeder exports no rows and zero counts", () => {
    const m = model();
    const out = buildDtExport(m, m.feederById.get("F3")!, "all");
    expect(out.rows).toEqual([]);
    expect(out.counts).toEqual({ completed: 0, ongoing: 0, not_assigned: 0, all: 0 });
    expect(out.headers).toContain("DT_ID");
  });
});
