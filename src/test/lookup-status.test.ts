import { describe, expect, it } from "vitest";
import { lookupStatusFor, normaliseLookupStatus } from "@/lib/field/lookupStatus";

describe("normaliseLookupStatus", () => {
  it("accepts the app's DT statuses, case- and spacing-insensitively", () => {
    expect(normaliseLookupStatus("completed")).toBe("completed");
    expect(normaliseLookupStatus(" COMPLETED ")).toBe("completed");
    expect(normaliseLookupStatus("Assigned")).toBe("assigned");
    expect(normaliseLookupStatus("unassigned")).toBe("unassigned");
    expect(normaliseLookupStatus("Problematic")).toBe("problematic");
    expect(normaliseLookupStatus("access denied")).toBe("access_denied");
    expect(normaliseLookupStatus("Access_Denied")).toBe("access_denied");
  });

  it("maps 'complete' to 'completed'", () => {
    expect(normaliseLookupStatus("Complete")).toBe("completed");
    expect(normaliseLookupStatus(" complete ")).toBe("completed");
  });

  it("rejects blank, non-string and unknown values", () => {
    expect(normaliseLookupStatus("")).toBeNull();
    expect(normaliseLookupStatus("   ")).toBeNull();
    expect(normaliseLookupStatus(null)).toBeNull();
    expect(normaliseLookupStatus(undefined)).toBeNull();
    expect(normaliseLookupStatus(42)).toBeNull();
    expect(normaliseLookupStatus("done")).toBeNull();
    expect(normaliseLookupStatus("in progress")).toBeNull();
  });
});

describe("lookupStatusFor", () => {
  it("applies the file status when the DT is new (no current status)", () => {
    expect(lookupStatusFor(undefined, "completed")).toBe("completed");
    expect(lookupStatusFor(null, "assigned")).toBe("assigned");
    expect(lookupStatusFor("", "problematic")).toBe("problematic");
  });

  it("applies the file status when the DT is currently unassigned", () => {
    expect(lookupStatusFor("unassigned", "completed")).toBe("completed");
    expect(lookupStatusFor("unassigned", "assigned")).toBe("assigned");
    expect(lookupStatusFor("unassigned", "problematic")).toBe("problematic");
  });

  it("never overwrites a status recorded in the app", () => {
    expect(lookupStatusFor("assigned", "completed")).toBeNull();
    expect(lookupStatusFor("assigned", "unassigned")).toBeNull();
    expect(lookupStatusFor("completed", "unassigned")).toBeNull();
    expect(lookupStatusFor("completed", "problematic")).toBeNull();
    expect(lookupStatusFor("problematic", "completed")).toBeNull();
    expect(lookupStatusFor("access_denied", "completed")).toBeNull();
  });

  it("returns null for blank or unknown file values, whatever the current status", () => {
    expect(lookupStatusFor("unassigned", "")).toBeNull();
    expect(lookupStatusFor("unassigned", null)).toBeNull();
    expect(lookupStatusFor(undefined, undefined)).toBeNull();
    expect(lookupStatusFor("unassigned", "nonsense")).toBeNull();
    expect(lookupStatusFor("completed", "also nonsense")).toBeNull();
  });

  it("normalises the file value before applying it", () => {
    expect(lookupStatusFor("unassigned", "Complete")).toBe("completed");
    expect(lookupStatusFor(undefined, " COMPLETED ")).toBe("completed");
  });

  it("file 'unassigned' over an unassigned DT returns 'unassigned' (harmless rewrite)", () => {
    expect(lookupStatusFor("unassigned", "unassigned")).toBe("unassigned");
    expect(lookupStatusFor(undefined, "unassigned")).toBe("unassigned");
  });
});
