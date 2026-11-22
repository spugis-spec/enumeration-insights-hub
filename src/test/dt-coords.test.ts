import { describe, expect, it } from "vitest";
import { buildKml, coordsFromLookup, coordsFromRows, dtKey, ownCoords, withLookupCoords } from "@/lib/dtCoords";

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

describe("coordsFromRows with the Field Manager lookup file's exact headers", () => {
  const headerRow = {
    "FEEDER NAME": "132KV KATAMPE 1 TS_33KV JABI FDR_PL_PL",
    FEEDER_ID: "509201",
    AREA: "APO",
    FEEDER_TYPE: null,
    DT_NAME: "MAITAMA JUNCTION S/S",
    DT_ID: "509201003401",
    DT_TYPE: "PUBLIC",
    STATUS: "completed",
    LONGITUDE: 7.4800668,
    LATITUDE: 9.1074609,
  };

  it("reads DT_ID + LONGITUDE/LATITUDE, as numbers and as strings", () => {
    const { coords, skipped } = coordsFromRows([
      headerRow,
      { ...headerRow, DT_ID: "509201009401", DT_NAME: "BESIDE UNITED SURGICAL S/S", LONGITUDE: "7.4745401669571", LATITUDE: "9.09466996339987" },
      { ...headerRow, DT_ID: "501101001001", DT_NAME: "DRAMBS VILLA S/S", LONGITUDE: null, LATITUDE: null },
    ]);
    expect(coords.size).toBe(2);
    expect(coords.get("509201003401")).toEqual({ lat: 9.1074609, lng: 7.4800668 });
    expect(coords.get("509201009401")).toEqual({ lat: 9.09466996339987, lng: 7.4745401669571 });
    expect(coords.has("501101001001")).toBe(false);
    expect(skipped).toBe(1);
  });
});

describe("withLookupCoords", () => {
  const { coords } = coordsFromRows([
    { DT_ID: "509201003401", LONGITUDE: 7.4800668, LATITUDE: 9.1074609 },
    { DT_ID: "509201003402", LONGITUDE: "7.4743", LATITUDE: "9.0958" },
  ]);

  it("attaches coordinates by normalised DT ID and counts them", () => {
    const records = [
      { dt_id: "509201003401", dt_name: "MAITAMA JUNCTION S/S", feeder_id: "509201" },
      { dt_id: "5092 0100-3402", dt_name: "SAME DT, WRITTEN WITH SPACES", feeder_id: "509201" },
      { dt_id: "999999999999", dt_name: "NOT IN THE FILE", feeder_id: "509201" },
    ];
    const { rows, attached } = withLookupCoords(records, coords);
    expect(attached).toBe(2);
    expect(rows[0]).toMatchObject({ dt_name: "MAITAMA JUNCTION S/S", lat: 9.1074609, lng: 7.4800668 });
    expect(rows[1]).toMatchObject({ lat: 9.0958, lng: 7.4743 });
  });

  it("leaves unmatched records untouched — no lat/lng keys are added", () => {
    const records = [{ dt_id: "999999999999", dt_name: "NOT IN THE FILE" }];
    const { rows, attached } = withLookupCoords(records, coords);
    expect(attached).toBe(0);
    expect(rows[0]).toBe(records[0]);
    expect("lat" in rows[0]!).toBe(false);
    expect("lng" in rows[0]!).toBe(false);
  });

  it("returns every record, in order", () => {
    const records = [{ dt_id: "1" }, { dt_id: "509201003401" }, { dt_id: "2" }];
    const { rows } = withLookupCoords(records, coords);
    expect(rows.map((r) => r.dt_id)).toEqual(["1", "509201003401", "2"]);
  });
});

describe("ownCoords", () => {
  it("accepts a record's own valid coordinates and rejects bad ones", () => {
    expect(ownCoords({ lat: 9.1074609, lng: 7.4800668 })).toEqual({ lat: 9.1074609, lng: 7.4800668 });
    expect(ownCoords({ lat: "9.1", lng: "7.48" })).toEqual({ lat: 9.1, lng: 7.48 });
    expect(ownCoords({ lat: null, lng: null })).toBeNull();
    expect(ownCoords({})).toBeNull();
    expect(ownCoords({ lat: 0, lng: 0 })).toBeNull();
    expect(ownCoords({ lat: 91, lng: 7.4 })).toBeNull();
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
