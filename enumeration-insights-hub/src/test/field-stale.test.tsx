import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const db = vi.hoisted(() => ({
  patchMany: vi.fn(async () => 0), upsertMany: vi.fn(), removeMany: vi.fn(), updateRow: vi.fn(), addRow: vi.fn(), safeId: (s: string) => s, listAll: vi.fn(async () => []),
}));
vi.mock("@/lib/field/db", () => db);
vi.mock("@/lib/field/firebase", () => ({ auth: () => ({ currentUser: { uid: "u1" } }), db: () => ({}), currentUser: async () => ({ uid: "u1" }) }));
vi.mock("@/lib/field/dataTools", () => ({ downloadSheet: vi.fn(), logUpload: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));

import { buildModel } from "@/lib/field/data";
import { findStaleDts } from "@/lib/field/stale";
import { analyzeCaptures } from "@/lib/field/captureEngine";
import { AllocationTab } from "@/components/field/AllocationTab";
import { CaptureReportDialog } from "@/components/field/CaptureDialogs";

const TODAY = "2026-10-13";
const feeder = (id = "F1"): any => ({ id: `f-${id}`, feeder_id: id, feeder_name: `Feeder ${id}`, area: null, feeder_type: null, est_customer_points: null, start_date: null, locked: false });
const dt = (id: string, status = "assigned"): any => ({ id: `d-${id}`, dt_id: id, feeder_id: "F1", dt_name: `DT ${id}`, dt_type: null, status, status_note: null });
const en = (id: string, username: string, name: string): any => ({ id, username, full_name: name, phone: null, supervisor: null, active: true });
const al = (dt_id: string, enumerator_id: string, o: any = {}): any => ({ id: `${dt_id}-${enumerator_id}`, dt_id, enumerator_id, allocated_by: null, allocated_on: "2026-10-01", due_date: null, notes: null, status: "active", completed_on: null, ...o });
const sub = (dt_id: string, day: string, username = "ada"): any => ({ id: `${username}|${dt_id}|${day}`, username, feeder_id: "F1", dt_id, captured_at: `${day}T10:00:00Z`, day, count: 3 });

const build = (subs: any[], extra: any = {}) => buildModel({
  feeders: [feeder()],
  dts: [dt("A"), dt("B"), dt("C"), dt("D", "unassigned"), dt("E"), dt("F", "completed"), dt("G")],
  enumerators: [en("e1", "ada", "Ada"), en("e2", "bayo", "Bayo"), en("e3", "chi", "Chi")],
  allocations: [al("A", "e1"), al("B", "e2"), al("C", "e3", { allocated_on: "2026-10-12" }), al("E", "e1", { self_assigned: true, authorized: false }), al("G", "e3")],
  submissions: subs, vehicles: [], trips: [], ...extra,
});
// G keeps every recent date alive; B was last captured long ago
const base = [sub("G", "2026-10-11"), sub("G", "2026-10-12"), sub("G", "2026-10-13"), sub("B", "2026-10-05", "bayo")];

beforeEach(() => vi.clearAllMocks());

describe("DTs that stopped showing up", () => {
  it("lists ongoing DTs with no captures on the 3 most recent capture dates, with when they were last seen", () => {
    const r = findStaleDts({ m: build([...base, sub("A", "2026-10-13")]), today: TODAY });
    expect(r.enough).toBe(true);
    expect(r.days).toEqual(["2026-10-11", "2026-10-12", "2026-10-13"]);
    expect(r.stale.map((x) => x.dt.dt_id)).toEqual(["B"]);
    expect(r.stale[0]).toMatchObject({ lastCapture: "2026-10-05", holders: ["Bayo"] });
  });
  it("keeps a DT ongoing if it appeared on the current date, or on any one of the recent dates", () => {
    const m = build([...base, sub("A", "2026-10-13"), sub("B", "2026-10-11", "bayo")]);
    expect(findStaleDts({ m, today: TODAY }).stale).toHaveLength(0);
  });
  it("counts a capture by someone else, and LT Pole captures, as the DT still being worked", () => {
    const m = build([...base, { ...sub("B", "2026-10-12", "stranger"), source: "lt" }]);
    expect(findStaleDts({ m, today: TODAY }).stale.map((x) => x.dt.dt_id)).not.toContain("B");
  });
  it("skips DTs assigned inside the window, waiting for authorization, completed or unassigned", () => {
    const ids = findStaleDts({ m: build(base), today: TODAY }).stale.map((x) => x.dt.dt_id).sort();
    expect(ids).toEqual(["A", "B"]); // not C (assigned 12 Oct), E (pending), F (completed), D (unassigned)
  });
  it("needs 3 recent capture dates before judging anything", () => {
    const r = findStaleDts({ m: build([sub("G", "2026-10-12"), sub("G", "2026-10-13")]), today: TODAY });
    expect(r.enough).toBe(false);
    expect(r.stale).toHaveLength(0);
    expect(r.note).toMatch(/2 recent capture dates; 3 are needed/);
  });
  it("ignores dates in the future and dates too far back to count as recent", () => {
    expect(findStaleDts({ m: build([sub("G", "2026-10-12"), sub("G", "2026-10-13"), sub("G", "2026-12-10")]), today: TODAY }).enough).toBe(false);
    expect(findStaleDts({ m: build([sub("G", "2026-09-01"), sub("G", "2026-10-12"), sub("G", "2026-10-13")]), today: TODAY }).enough).toBe(false);
  });
  it("uses what is being uploaded as well as what is already saved", () => {
    const m = build([sub("G", "2026-10-11"), sub("G", "2026-10-12")]);
    const a = analyzeCaptures({ inputs: [{ source: "customer", label: "x", rows: [{ username: "chi", feeder: "F1", "DT ID": "G", time: "2026-10-13 10:00:00" }, { username: "ada", feeder: "F1", "DT ID": "A", time: "2026-10-13 11:00:00" }] }], m, scope: { feeders: ["F1"], from: null, to: null }, today: TODAY });
    expect(a.stale.enough).toBe(true);
    expect(a.stale.stale.map((x) => x.dt.dt_id)).toEqual(["B"]); // A appeared today and stays ongoing
  });
});

describe("shown in the app", () => {
  const wrap = (ui: React.ReactElement) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
  const recent = () => {
    const d = (n: number) => { const x = new Date(); x.setDate(x.getDate() - n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; };
    return [sub("G", d(2)), sub("G", d(1)), sub("G", d(0)), sub("A", d(0))];
  };

  it("DT Allocation warns, filters, and completes them all", async () => {
    const m = build(recent(), { allocations: [al("A", "e1"), al("B", "e2"), al("G", "e3")] });
    wrap(<AllocationTab m={m} isAdmin />);
    expect(screen.getByText(/ongoing DT did not show up in the last 3 capture dates/)).toBeTruthy();
    expect(screen.getAllByText(/Not seen in captures: complete\?/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /^Not seen 3 dates/ }));
    expect(screen.queryAllByText("DT A")).toHaveLength(0);
    expect(screen.getAllByText("DT B").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Mark all 1 as complete" }));
    fireEvent.click(await screen.findByRole("button", { name: "Yes, complete 1" }));
    await waitFor(() => expect(db.patchMany).toHaveBeenCalledWith("dts", [expect.objectContaining({ id: "d-B", patch: expect.objectContaining({ status: "completed" }) })]));
    expect(db.patchMany).toHaveBeenCalledWith("allocations", [expect.objectContaining({ id: "B-e2", patch: expect.objectContaining({ status: "completed" }) })]);
  });

  it("the check results notify you and complete the ticked DTs", async () => {
    const m = build([sub("G", "2026-10-11"), sub("G", "2026-10-12")], { allocations: [al("A", "e1"), al("B", "e2"), al("G", "e3")] });
    const a = analyzeCaptures({ inputs: [{ source: "customer", label: "x", rows: [{ username: "chi", feeder: "F1", "DT ID": "G", time: "2026-10-13 10:00:00" }, { username: "ada", feeder: "F1", "DT ID": "A", time: "2026-10-13 11:00:00" }] }], m, scope: { feeders: ["F1"], from: null, to: null }, today: TODAY });
    const onCompleted = vi.fn();
    wrap(<CaptureReportDialog rep={{ a, label: "x", feeders: ["F1"], from: null, to: null }} m={m} goTo={undefined} onClose={() => {}} onCompleted={onCompleted} />);
    expect(screen.getByText(/1 ongoing DT did not show up in the last 3 capture dates: mark as complete\?/)).toBeTruthy();
    expect(screen.getByText(/A DT captured on any of them, including the current date, stays ongoing/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Mark 1 as complete" }));
    await waitFor(() => expect(db.patchMany).toHaveBeenCalledWith("dts", [expect.objectContaining({ id: "d-B" })]));
    await waitFor(() => expect(screen.getByText(/1 marked completed/)).toBeTruthy());
    expect(onCompleted).toHaveBeenCalled();
  });

  it("says nothing needs completing when everything showed up", () => {
    const m = build([...base, sub("A", "2026-10-13"), sub("B", "2026-10-12", "bayo")]);
    const a = analyzeCaptures({ inputs: [{ source: "customer", label: "x", rows: [{ username: "chi", feeder: "F1", "DT ID": "G", time: "2026-10-13 10:00:00" }] }], m, scope: { feeders: ["F1"], from: null, to: null }, today: TODAY });
    wrap(<CaptureReportDialog rep={{ a, label: "x", feeders: ["F1"], from: null, to: null }} m={m} goTo={undefined} onClose={() => {}} />);
    expect(screen.getByText(/Every ongoing DT showed up/)).toBeTruthy();
  });
});
