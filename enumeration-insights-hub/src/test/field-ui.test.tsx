import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const db = vi.hoisted(() => ({
  patchMany: vi.fn(async () => 0), upsertMany: vi.fn(async () => {}), removeMany: vi.fn(async () => 0),
  updateRow: vi.fn(async () => {}), addRow: vi.fn(async () => "id"), safeId: (s: string) => s.replace(/\//g, "_"),
  listAll: vi.fn(async () => []),
}));
vi.mock("@/lib/field/db", () => db);
vi.mock("@/lib/field/firebase", () => ({ auth: () => ({ currentUser: { uid: "u1" } }), db: () => ({}), currentUser: async () => ({ uid: "u1" }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));

import { buildModel } from "@/lib/field/data";
import { AllocationTab } from "@/components/field/AllocationTab";
import { AlertsTab } from "@/components/field/AlertsTab";

const wrap = (ui: React.ReactElement) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

const feeders: any[] = [{ id: "f1", feeder_id: "F1", feeder_name: "Feeder One", locked: true, area: null, feeder_type: null, est_customer_points: null, start_date: null }];
const dts: any[] = [
  { id: "d1", dt_id: "D1", feeder_id: "F1", dt_name: "Alpha DT", dt_type: null, status: "assigned", status_note: null },
  { id: "d2", dt_id: "D2", feeder_id: "F1", dt_name: "Bravo DT", dt_type: null, status: "assigned", status_note: null },
  { id: "d3", dt_id: "D3", feeder_id: "F1", dt_name: "Charlie DT", dt_type: null, status: "unassigned", status_note: null },
];
const enumerators: any[] = [{ id: "e1", username: "ada", full_name: "Ada A", phone: null, supervisor: null, active: true }, { id: "e2", username: "bayo", full_name: "Bayo B", phone: null, supervisor: null, active: true }];
const allocations: any[] = [
  { id: "a1", dt_id: "D1", enumerator_id: "e1", status: "active", allocated_on: "2026-10-01", due_date: null, notes: null, completed_on: null, allocated_by: null },
  { id: "a2", dt_id: "D2", enumerator_id: "e2", status: "active", allocated_on: "2026-10-01", due_date: null, notes: null, completed_on: null, allocated_by: null },
];

beforeEach(() => vi.clearAllMocks());

describe("DT Allocation table", () => {
  const model = () => buildModel({ feeders, dts, enumerators, allocations, submissions: [], vehicles: [], trips: [] });

  it("toggles between Assigned and Not assigned", () => {
    wrap(<AllocationTab m={model()} isAdmin />);
    const group = screen.getByRole("group", { name: /assigned or not assigned/i });
    fireEvent.click(within(group).getByRole("button", { name: /^Not assigned/ }));
    expect(screen.getAllByText("Charlie DT").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("Alpha DT")).toHaveLength(0);
    fireEvent.click(within(group).getByRole("button", { name: /^Assigned/ }));
    expect(screen.queryAllByText("Charlie DT")).toHaveLength(0);
    expect(screen.getAllByText("Alpha DT").length).toBeGreaterThan(0);
  });

  it("selects all assigned DTs and marks them complete in one go", async () => {
    wrap(<AllocationTab m={model()} isAdmin />);
    fireEvent.click(screen.getByRole("button", { name: /Select all assigned \(2\)/ }));
    fireEvent.click(screen.getByRole("button", { name: /Mark 2 as complete/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Yes, complete 2/ }));
    await waitFor(() => expect(db.patchMany).toHaveBeenCalledTimes(2));
    const calls = db.patchMany.mock.calls as unknown as [string, { id: string; patch: any }[]][];
    const allocCall = calls.find((c) => c[0] === "allocations")!;
    const dtCall = calls.find((c) => c[0] === "dts")!;
    expect(allocCall[1].map((x) => x.id).sort()).toEqual(["a1", "a2"]);
    expect(allocCall[1][0]!.patch.status).toBe("completed");
    expect(dtCall[1].map((x) => x.id).sort()).toEqual(["d1", "d2"]);
    expect(dtCall[1][0]!.patch.status).toBe("completed");
  });

  it("changes a status from the table", async () => {
    wrap(<AllocationTab m={model()} isAdmin />);
    const sel = screen.getAllByLabelText("Status of Alpha DT")[0]!;
    fireEvent.change(sel, { target: { value: "completed" } });
    await waitFor(() => expect(db.updateRow).toHaveBeenCalledWith("dts", "d1", expect.objectContaining({ status: "completed" })));
    expect(db.updateRow).toHaveBeenCalledWith("allocations", "a1", expect.objectContaining({ status: "completed" }));
  });

  it("offers 'mark all other DTs complete' from a person's drop arrow", async () => {
    const extra = [...allocations, { id: "a3", dt_id: "D2", enumerator_id: "e1", status: "active", allocated_on: "2026-10-01", due_date: null, notes: null, completed_on: null, allocated_by: null }];
    wrap(<AllocationTab m={buildModel({ feeders, dts, enumerators, allocations: extra, submissions: [], vehicles: [], trips: [] })} isAdmin />);
    fireEvent.click(screen.getAllByRole("button", { name: /1 other open DT/ })[0]!);
    fireEvent.click((await screen.findAllByRole("button", { name: /Mark all 1 other DT as complete/ }))[0]!);
    fireEvent.click(await screen.findByRole("button", { name: /Yes, complete 1/ }));
    await waitFor(() => expect(db.patchMany).toHaveBeenCalled());
  });
});

describe("Capture Alerts", () => {
  const subs: any[] = [
    { id: "s1", username: "ghost1", feeder_id: "F1", dt_id: "D1", captured_at: "2026-10-10T10:00:00Z", day: "2026-10-10", count: 5 },
    { id: "s2", username: "ghost2", feeder_id: "F1", dt_id: "D2", captured_at: "2026-10-11T10:00:00Z", day: "2026-10-11", count: 2 },
    { id: "s3", username: "ada", feeder_id: "F1", dt_id: "D2", captured_at: "2026-10-12T10:00:00Z", day: "2026-10-12", count: 3 },
  ];
  const model = () => buildModel({ feeders, dts, enumerators, allocations, submissions: subs, vehicles: [], trips: [] });

  it("shows the wrong capture with who is involved, and resolves it", async () => {
    wrap(<AlertsTab m={model()} />);
    expect(screen.getByText("DT allocated to someone else")).toBeTruthy();
    expect(screen.getByText(/DT holder: Bayo B/)).toBeTruthy();
    const pick = screen.getAllByRole("combobox").find((c) => within(c).queryByText("Corrected"))!;
    fireEvent.change(pick, { target: { value: "Corrected" } });
    await waitFor(() => expect(db.upsertMany).toHaveBeenCalled());
    const rows = (db.upsertMany.mock.calls[0] as unknown as [string, any[]])[1];
    expect(rows[0]).toMatchObject({ kind: "alert", response: "Corrected", username: "ada" });
  });

  it("resolves several usernames not on the staff list at once", async () => {
    wrap(<AlertsTab m={model()} />);
    fireEvent.click(screen.getAllByRole("button", { name: /^Not on staff list/ })[0]!);
    fireEvent.click(screen.getByLabelText("Select all"));
    expect(screen.getByText("2 selected")).toBeTruthy();
    const bulk = screen.getAllByRole("combobox")[0]!;
    fireEvent.change(bulk, { target: { value: "Resigned" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(db.upsertMany).toHaveBeenCalled());
    const rows = (db.upsertMany.mock.calls[0] as unknown as [string, any[]])[1];
    expect(rows.map((r) => r.key).sort()).toEqual(["ghost1", "ghost2"]);
    expect(rows.every((r) => r.kind === "user" && r.response === "Resigned")).toBe(true);
  });
});
