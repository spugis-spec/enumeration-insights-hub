import { describe, expect, it, vi } from "vitest";

vi.mock("firebase/database", () => ({ ref: vi.fn(), get: vi.fn(async () => ({ val: () => null })) }));
vi.mock("@/lib/firebase", () => ({ getDb: () => ({}) }));

import { rowsToPoints } from "@/lib/gis";
import { convertSpool } from "@/lib/gisSpool";
import { dtNameOf } from "@/lib/dtNames";

describe("GIS map popup: building code and DT name", () => {
  it("reads building code and DT ID from an uploaded file", () => {
    const [a] = rowsToPoints([{ username: "ada", latitude: 9.1, longitude: 7.4, feeder: "F1", creation_date: "2026-11-04", FID: 1, building_code: "BC-001", "DT ID": "DSS_77" }], "cust");
    expect(a).toMatchObject({ building: "BC-001", dtId: "DSS_77" });
  });

  it("falls back to a dss_* column when there is no DT ID column, and drops a trailing .0", () => {
    const [b] = rowsToPoints([{ username: "bayo", latitude: 9.2, longitude: 7.5, "Building Code": "BC-002", dss_fdr_id: "DSS_78.0", dss_other: "x" }], "cust");
    expect(b).toMatchObject({ building: "BC-002", dtId: "DSS_78" });
  });

  it("leaves both blank when the file has neither column", () => {
    const [p] = rowsToPoints([{ username: "ada", latitude: 9.1, longitude: 7.4 }], "dss");
    expect(p).toMatchObject({ building: "", dtId: "" });
  });

  it("restores building code and DT from a dashboard spool, and still opens older spools", () => {
    const fresh = convertSpool({ points: { cust: [[9.1, 7.4, "ada", "F1", "2026-11-04", "1", "BC-001", 1], [9.2, 7.5, "bayo", "F1", "2026-11-04", "2", "", -1]] }, count: 2, savedAt: 1, dts: ["DSS_1", "DSS_2"] });
    expect(fresh.cust[0]).toMatchObject({ building: "BC-001", dtId: "DSS_2" });
    expect(fresh.cust[1]).toMatchObject({ building: "", dtId: "" });
    const old = convertSpool({ points: { lt: [[9.1, 7.4, "ada", "F1", "2026-11-04", "1"]] }, count: 1, savedAt: 1 });
    expect(old.lt[0]).toMatchObject({ building: "", dtId: "", user: "ada" });
  });

  it("turns a DT ID into the DT name from the lookup, ignoring case", () => {
    const names = { dss_77: "Ajah Nwabueze Close S/S" };
    expect(dtNameOf("DSS_77", names)).toBe("Ajah Nwabueze Close S/S");
    expect(dtNameOf("DSS_99", names)).toBe("");
    expect(dtNameOf(undefined, names)).toBe("");
  });
});
