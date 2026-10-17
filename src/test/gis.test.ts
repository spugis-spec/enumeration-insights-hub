import { describe, expect, it } from "vitest";
import { convexHull, rowsToPoints } from "@/lib/gis";

describe("GIS data handling", () => {
  it("handles an empty upload", () => {
    expect(rowsToPoints([], "dss")).toEqual([]);
  });

  it("retains coordinates and enumerator fields from uploaded rows", () => {
    const row = { latitude: 9.1, longitude: 7.4, username: "staff1", feeder: "Central", date: "2026-10-17", fid: "12" };
    expect(rowsToPoints([row], "dss")).toEqual([
      { type: "dss", lat: 9.1, lng: 7.4, user: "staff1", feeder: "Central", date: "2026-10-17", fid: "12", raw: row },
    ]);
  });

  it("draws the outer feeder boundary without interior points", () => {
    expect(convexHull([[0, 0], [2, 0], [1, 1], [2, 2], [0, 2]])).toEqual([
      [0, 0], [2, 0], [2, 2], [0, 2],
    ]);
    expect(convexHull([])).toEqual([]);
    expect(convexHull([[1, 2]])).toEqual([[1, 2]]);
  });
});