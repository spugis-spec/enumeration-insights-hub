import { describe, expect, it } from "vitest";
import { buildKml, coordsFromLookup, coordsFromRows, dtKey } from "@/lib/dtCoords";

describe("dtKey", () => {
  it("normalises DT IDs for matching", () => {
    expect(dtKey("5011 0110-1101")).toBe("501101101101");
    expect(dtKey("abc-123")).toBe("ABC123");
  });
});

describe("coordsFromRows", () => {
  it("reads DT ID + latitude/longitude columns", () => {
    const { coords, skipped } = coordsFromRows([
      { "DT ID": "501101101101", latitude: 9.0765, longitude: 7.3986 },
      { "DT ID": "501101101102", latitude: "9.10", longitude: "7.40" },
      { "DT ID": "", latitude: 9.1, longitude: 7.4 },
    ]);
    expect(coords.size).toBe(2);
    expect(coords.get(dtKey("501101101101"))).toEqual({ lat: 9.0765, lng: 7.3986 });
    expect(skipped).toBe(1);
  });

  it("reads X/Y columns and a dss_fdr DT ID", () => {
    const { coords } = coordsFromRows([{ X: 7.5, Y: 9.06, dss_fdr_1: "501101101103" }]);
    expect(coords.get("501101101103")).toEqual({ lat: 9.06, lng: 7.5 });
  });

  it("returns nothing when there are no coordinate columns", () => {
    const { coords } = coordsFromRows([{ "DT ID": "1", feeder: "X" }]);
    expect(coords.size).toBe(0);
  });
});

describe("coordsFromLookup", () => {
  it("reads coordinates saved in the DT lookup, skipping entries without them", () => {
    const m = coordsFromLookup({
      a: { id: "501101101101", name: "KATAMPE DSS 1", feeder: "Katampe", lat: 9.0765, lng: 7.3986 },
      b: { id: "501101101102", name: "NO COORDS", feeder: "Katampe" },
      c: { id: "501101101103", name: "BAD", feeder: "", lat: 0, lng: 0 },
      d: { name: "NO ID", lat: 9.1, lng: 7.4 },
    });
    expect(m.size).toBe(1);
    expect(m.get("501101101101")).toEqual({ lat: 9.0765, lng: 7.3986 });
  });

  it("handles null and non-objects", () => {
    expect(coordsFromLookup(null).size).toBe(0);
    expect(coordsFromLookup("x").size).toBe(0);
  });
});

describe("buildKml", () => {
  it("includes only rows with coordinates, with lng,lat order", () => {
    const kml = buildKml([
      { dt_id: "501101101101", dt_name: "KATAMPE DSS 1", feeder_id: "F1", feeder_name: "Katampe", lat: 9.0765, lng: 7.3986 },
      { dt_id: "501101101102", dt_name: "NO COORDS", feeder_id: "F1", feeder_name: "Katampe", lat: null, lng: null },
    ]);
    expect(kml).toContain("<name>KATAMPE DSS 1</name>");
    expect(kml).toContain("<coordinates>7.3986,9.0765,0</coordinates>");
    expect(kml).not.toContain("NO COORDS");
  });

  it("escapes XML in names", () => {
    const kml = buildKml([{ dt_id: "1", dt_name: "A & B <DT>", feeder_id: "F", feeder_name: "F", lat: 1, lng: 2 }]);
    expect(kml).toContain("A &amp; B &lt;DT&gt;");
  });
});
