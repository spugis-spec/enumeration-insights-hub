import { describe, expect, it } from "vitest";
import { collectDevice, completion, finishDate, returnDevice, type Device } from "@/lib/workspace-model";

describe("Frontend operation calculations", () => {
  it("calculates daily capacity and rounds completion days up", () => {
    expect(completion(1000, 100, 2, 30)).toEqual({ remaining: 900, days: 15 });
    expect(completion(101, 0, 1, 30).days).toBe(4);
  });
  it("does not project a finish when no staff are allocated", () => {
    expect(completion(100, 0, 0, 30).days).toBeNull();
    expect(completion(100, 120, 0, 30)).toEqual({ remaining: 0, days: 0 });
    expect(finishDate("2026-10-17", 15)).toBe("2026-11-01");
  });
  it("tracks collection and return without issuing a collected device again", () => {
    const device: Device = { id: "1", name: "Phone", serial: "123", holder: "", status: "Available", collected: "", returned: "" };
    const issued = collectDevice(device, "Staff A", "2026-10-17");
    expect(issued.status).toBe("Collected");
    expect(issued.holder).toBe("Staff A");
    expect(collectDevice(issued, "Staff B", "2026-10-18")).toEqual(issued);
    expect(returnDevice(issued, "2026-10-19")).toMatchObject({ status: "Available", holder: "", returned: "2026-10-19" });
  });
});