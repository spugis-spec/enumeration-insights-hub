import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/field/db", () => ({ patchMany: vi.fn(async () => 0), upsertMany: vi.fn(), removeMany: vi.fn(), updateRow: vi.fn(), addRow: vi.fn(), safeId: (s: string) => s, listAll: vi.fn(async () => []) }));
vi.mock("@/lib/field/firebase", () => ({ auth: () => ({ currentUser: { uid: "u1" } }), db: () => ({}), currentUser: async () => ({ uid: "u1" }) }));

import { detectDateOrder, parseCaptureTime } from "@/lib/field/dates";
import { analyzeCaptures, readRow, type CaptureInput } from "@/lib/field/captureEngine";
import { buildModel } from "@/lib/field/data";
import { setDateOrder } from "@/lib/field/dates";

const NOW = new Date("2026-11-08T12:00:00Z");
const sample = ["11/04/2026 12:04", "11/05/2026 12:04", "11/06/2026 12:04", "11/07/2026 12:04"];

describe("dates that can be read two ways", () => {
  it("asks when 11/04 to 11/07 could be April-July or 4-7 November", () => {
    const i = detectDateOrder(sample, NOW);
    expect(i.needsChoice).toBe(true);
    expect(i.ambiguous).toBe(4);
    expect(i.dmy).toMatchObject({ min: "2026-04-11", max: "2026-07-11" });
    expect(i.mdy).toMatchObject({ min: "2026-11-04", max: "2026-11-07" });
  });
  it("reads the same cell either way when the user chooses", () => {
    expect(parseCaptureTime("11/04/2026 12:04", NOW, "dmy")?.slice(0, 10)).toBe("2026-04-11");
    expect(parseCaptureTime("11/04/2026 12:04", NOW, "mdy")?.slice(0, 10)).toBe("2026-11-04");
    expect(parseCaptureTime("11/07/2026 12:04", NOW, "mdy")?.slice(0, 10)).toBe("2026-11-07");
  });
  it("does not ask when the file proves the order", () => {
    const day = detectDateOrder([...sample, "25/11/2026 09:00"], NOW);
    expect(day.evidence).toBe("dmy");
    expect(day.needsChoice).toBe(false);
    const month = detectDateOrder([...sample, "11/25/2026 09:00"], NOW);
    expect(month.evidence).toBe("mdy");
    expect(month.needsChoice).toBe(false);
  });
  it("asks when a file mixes both orders", () => {
    expect(detectDateOrder([...sample, "25/11/2026", "11/25/2026"], NOW).needsChoice).toBe(true);
  });
  it("does not ask for ISO dates or when both parts match (05/05)", () => {
    expect(detectDateOrder(["2026-11-04 12:04", "05/05/2026"], NOW).needsChoice).toBe(false);
  });
  it("the chosen order is used when rows are read", () => {
    setDateOrder("mdy");
    expect(readRow({ username: "ada", "DT ID": "D1", time: "11/04/2026 12:04" }).day).toBe("2026-11-04");
    setDateOrder("dmy");
    expect(readRow({ username: "ada", "DT ID": "D1", time: "11/04/2026 12:04" }).day).toBe("2026-04-11");
    setDateOrder("auto");
  });
});

describe("a completed DT stays completed when data is uploaded", () => {
  const feeder: any = { id: "f1", feeder_id: "F1", feeder_name: "Feeder 1", area: null, feeder_type: null, est_customer_points: null, start_date: null, locked: false };
  const dt = (id: string, status: string): any => ({ id: `d-${id}`, dt_id: id, feeder_id: "F1", dt_name: `DT ${id}`, dt_type: null, status, status_note: null });
  const en: any = { id: "e1", username: "ada", full_name: "Ada", phone: null, supervisor: null, active: true };
  const m = buildModel({ feeders: [feeder], dts: [dt("DONE", "completed"), dt("OPEN", "unassigned")], enumerators: [en], allocations: [], submissions: [], vehicles: [], trips: [] } as any);
  const rows = [{ username: "ada", feeder: "F1", "DT ID": "DONE", time: "2026-10-13 10:00:00" }, { username: "ada", feeder: "F1", "DT ID": "OPEN", time: "2026-10-13 10:05:00" }];
  const a = analyzeCaptures({ inputs: [{ source: "customer", label: "c.csv", rows } as CaptureInput], m, scope: { feeders: ["F1"], from: null, to: null } });
  it("never self-assigns or reopens a completed DT", () => {
    expect(a.selfAssign.map((s) => s.dt.dt_id)).toEqual(["OPEN"]);
  });
});
