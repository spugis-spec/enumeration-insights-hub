import { describe, expect, it } from "vitest";
import { parseCaptureTime } from "@/lib/field/dates";
import { buildModel, captureIssueReason, STAFF_REASON, type Allocation, type DT, type Enumerator, type Feeder, type Resolution, type Submission } from "@/lib/field/data";

const NOW = new Date("2026-10-18T12:00:00Z");

describe("parseCaptureTime", () => {
  it("reads slash dates day-first (12/10/2026 is 12 October, not 10 December)", () => {
    expect(parseCaptureTime("12/10/2026", NOW)?.slice(0, 10)).toBe("2026-10-12");
    expect(parseCaptureTime("12/10/2026 08:30:15", NOW)).toBe("2026-10-12T08:30:15.000Z");
  });
  it("uses an unambiguous day or month when one is over 12", () => {
    expect(parseCaptureTime("25/09/2026", NOW)?.slice(0, 10)).toBe("2026-09-25");
    expect(parseCaptureTime("09/25/2026", NOW)?.slice(0, 10)).toBe("2026-09-25");
  });
  it("handles AM/PM, 2-digit years, dashes and Excel serials", () => {
    expect(parseCaptureTime("19/06/2026 12:00:00 AM", NOW)).toBe("2026-06-19T00:00:00.000Z");
    expect(parseCaptureTime("28/4/26 1:10 PM", NOW)).toBe("2026-04-28T13:10:00.000Z");
    expect(parseCaptureTime("05-10-2026", NOW)?.slice(0, 10)).toBe("2026-10-05");
    expect(parseCaptureTime("46307", NOW)?.slice(0, 10)).toBe("2026-10-12");
  });
  it("never returns a date in the future", () => {
    // 10/12/2026 day-first is 10 Dec (future), so the month-first reading, 12 Oct, is used
    expect(parseCaptureTime("10/12/2026", NOW)?.slice(0, 10)).toBe("2026-10-12");
    expect(parseCaptureTime("20/12/2026", NOW)).toBeNull();
    expect(parseCaptureTime("2027-03-01T00:00:00Z", NOW)).toBeNull();
  });
  it("rejects nonsense", () => {
    expect(parseCaptureTime("", NOW)).toBeNull();
    expect(parseCaptureTime("31/02/2026", NOW)).toBeNull();
    expect(parseCaptureTime("hello", NOW)).toBeNull();
  });
});

const feeder = (o: Partial<Feeder> = {}): Feeder => ({ id: "f1", feeder_id: "F1", feeder_name: "Feeder 1", area: null, feeder_type: null, est_customer_points: null, start_date: null, target_per_staff_day: 40, working_days_per_week: 6, locked: true, ...o });
const dt = (id: string, o: Partial<DT> = {}): DT => ({ id, dt_id: id, feeder_id: "F1", dt_name: id, dt_type: null, status: "assigned", status_note: null, ...o });
const en = (id: string, username: string, o: Partial<Enumerator> = {}): Enumerator => ({ id, username, full_name: username, phone: null, supervisor: null, active: true, ...o });
const al = (dt_id: string, enumerator_id: string, o: Partial<Allocation> = {}): Allocation => ({ id: `${dt_id}-${enumerator_id}`, dt_id, enumerator_id, allocated_by: null, allocated_on: "2026-10-01", due_date: null, notes: null, status: "active", completed_on: null, ...o });
const sub = (username: string, dt_id: string, day: string, count = 1): Submission => ({ id: `${username}|${dt_id}|${day}`, username, feeder_id: "F1", dt_id, captured_at: `${day}T10:00:00.000Z`, day, count });

const base = () => ({
  feeders: [feeder()], dts: [dt("D1"), dt("D2")], enumerators: [en("e1", "ada", { supervisor: "John Doe" })],
  allocations: [al("D1", "e1")], vehicles: [], trips: [],
});

describe("alerts", () => {
  it("flags a capture on a DT not allocated to that person, and a stranger username", () => {
    const m = buildModel({ ...base(), submissions: [sub("ada", "D2", "2026-10-10"), sub("ghost", "D1", "2026-10-10", 3)] });
    expect(m.alerts.map((a) => a.reason).sort()).toEqual(["DT not allocated to anyone", STAFF_REASON].sort());
  });

  it("answering a username clears all its 'not on staff list' alerts from the list", () => {
    const res: Resolution = { id: "user:ghost", kind: "user", key: "ghost", response: "Resigned", resolved_at: "x" };
    const m = buildModel({ ...base(), submissions: [sub("ghost", "D1", "2026-10-10", 3), sub("ghost", "D2", "2026-10-11")], alert_resolutions: [res] });
    expect(m.alerts).toHaveLength(0);
    expect(m.resolvedAlerts).toHaveLength(2);
    expect(m.resolvedAlerts[0]!.response).toBe("Resigned");
  });

  it("answering a single wrong capture clears only that one", () => {
    const subs = [sub("ada", "D2", "2026-10-10"), sub("ada", "D1", "2026-10-10")];
    const open = buildModel({ ...base(), submissions: subs });
    const key = open.alerts[0]!.key;
    const m = buildModel({ ...base(), submissions: subs, alert_resolutions: [{ id: "a", kind: "alert", key, response: "Corrected", resolved_at: "x" }] });
    expect(open.alerts).toHaveLength(1);
    expect(m.alerts).toHaveLength(0);
    expect(m.resolvedAlerts[0]!.response).toBe("Corrected");
  });

  it("does not flag a capture whose username matches a supervisor name", () => {
    const m = buildModel({ ...base(), submissions: [sub("john.doe", "D1", "2026-10-10", 4)] });
    expect(m.alerts).toHaveLength(0);
    expect(m.supervisorCaptures).toBe(4);
  });

  it("flags captures made after the DT was completed, but not on or before that day", () => {
    const done = { ...base(), allocations: [al("D1", "e1", { status: "completed", completed_on: "2026-10-10" })] };
    const m = buildModel({ ...done, submissions: [sub("ada", "D1", "2026-10-10"), sub("ada", "D1", "2026-10-12")] });
    expect(m.alerts).toHaveLength(1);
    expect(m.alerts[0]!.reason).toBe("Captured after DT was completed");
    expect(captureIssueReason(m, "ada", "F1", "D1", "2026-10-09")).toBe("");
    expect(captureIssueReason(m, "ada", "F1", "D1", "2026-10-11")).toBe("Captured after DT was completed");
  });

  it("lists rows dated in the future for cleanup", () => {
    const m = buildModel({ ...base(), submissions: [sub("ada", "D1", "2099-12-10"), sub("ada", "D1", "2026-10-10")] });
    expect(m.futureIds.submissions).toEqual(["ada|D1|2099-12-10"]);
  });

  it("unlocked feeders only flag staff/lookup problems", () => {
    const m = buildModel({ ...base(), feeders: [feeder({ locked: false })], submissions: [sub("ada", "D2", "2026-10-10")] });
    expect(m.alerts).toHaveLength(0);
  });
});
