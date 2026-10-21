import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const db = vi.hoisted(() => ({
  upsertMany: vi.fn(async () => {}), addMany: vi.fn(async () => {}), patchMany: vi.fn(async () => 0), removeMany: vi.fn(async () => 0),
  updateRow: vi.fn(async () => {}), addRow: vi.fn(async () => "id"), safeId: (s: string) => s, listAll: vi.fn(async () => []),
}));
vi.mock("@/lib/field/db", () => db);
const tools = vi.hoisted(() => ({
  UPLOADED_COLLECTIONS: [], DATA_COLLECTIONS: [], clearCaptures: vi.fn(), clearCollections: vi.fn(), clearLookup: vi.fn(), clearPoints: vi.fn(), clearStaff: vi.fn(),
  createSnapshot: vi.fn(async () => {}), deleteSnapshot: vi.fn(), downloadCaptures: vi.fn(), downloadFullBackup: vi.fn(), downloadLookup: vi.fn(), downloadPoints: vi.fn(),
  downloadSheet: vi.fn(), downloadStaff: vi.fn(), listSnapshots: vi.fn(async () => []), listUploads: vi.fn(async () => []), logUpload: vi.fn(async () => {}),
  readBackupFile: vi.fn(), restoreData: vi.fn(), restoreSnapshot: vi.fn(),
}));
vi.mock("@/lib/field/dataTools", () => tools);
vi.mock("@/lib/field/firebase", () => ({ auth: () => ({ currentUser: { uid: "admin1" } }), db: () => ({}), currentUser: async () => ({ uid: "admin1" }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));
vi.mock("@/lib/field/pairingsApi", () => ({ fetchPairingsRaw: vi.fn(async () => ({ pairings: null, mappings: null })) }));
const dash = vi.hoisted(() => ({ fetchDashboardCaptureRows: vi.fn() }));
vi.mock("@/lib/field/dashboardSync", () => dash);

import { buildModel, SELF_ASSIGNED_REASON } from "@/lib/field/data";
import { UploadsTab } from "@/components/field/UploadsTab";
import { AllocationTab } from "@/components/field/AllocationTab";

const wrap = (ui: React.ReactElement) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
const feeder = (id: string): any => ({ id: `f-${id}`, feeder_id: id, feeder_name: `Feeder ${id}`, area: null, feeder_type: null, est_customer_points: null, start_date: null, locked: false });
const dt = (id: string, f: string, status = "unassigned"): any => ({ id: `d-${id}`, dt_id: id, feeder_id: f, dt_name: `DT ${id}`, dt_type: null, status, status_note: null });
const en = (id: string, username: string, name: string): any => ({ id, username, full_name: name, phone: null, supervisor: null, active: true });
const al = (dt_id: string, enumerator_id: string, o: any = {}): any => ({ id: `${dt_id}-${enumerator_id}`, dt_id, enumerator_id, allocated_by: null, allocated_on: "2026-10-01", due_date: null, notes: null, status: "active", completed_on: null, ...o });
const build = (o: any = {}) => buildModel({
  feeders: [feeder("F1"), feeder("F2")], dts: [dt("D1", "F1", "assigned"), dt("D3", "F1"), dt("D9", "F2")],
  enumerators: [en("e1", "ada", "Ada"), en("e2", "bayo", "Bayo"), en("e3", "chi", "Chi")],
  allocations: [al("D1", "e2")], submissions: [], vehicles: [], trips: [], ...o,
});

beforeEach(() => vi.clearAllMocks());

describe("checking captures: Customer Enumeration + LT Pole", () => {
  it("asks which feeders, works only on them, self-assigns, flags, and reports", async () => {
    dash.fetchDashboardCaptureRows.mockResolvedValue({
      savedAt: Date.parse("2026-10-14T09:00:00Z"),
      customer: [
        { username: "ada", feeder: "F1", "DT ID": "D3", time: "2026-10-13 10:00:00", fid: "1", customer_no: "C1", building_code: "B1" },
        { username: "chi", feeder: "F2", "DT ID": "D9", time: "2026-10-13 11:00:00", fid: "2" },
      ],
      lt: [
        { username: "ada", feeder: "F1", "DT ID": "D3", time: "2026-10-13 12:00:00", fid: "9", structure_no: "S1" },
        { username: "ada", feeder: "X9", "DT ID": "", time: "2026-10-13 13:00:00", fid: "10", structure_no: "S2" },
      ],
    });
    wrap(<UploadsTab m={build()} />);
    fireEvent.click(screen.getByRole("button", { name: /Check the Dashboard's Customer Enumeration \+ LT Pole upload/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Which feeders and dates should I check?")).toBeTruthy();
    expect(within(dialog).getByText(/Not in your lookup, so left out: X9/)).toBeTruthy();
    fireEvent.click(within(dialog).getByLabelText(/Feeder F2/)); // leave F2 out
    fireEvent.click(within(dialog).getByRole("button", { name: "Check 1 feeder" }));

    await waitFor(() => expect(screen.getByText("Check finished")).toBeTruthy());

    const saved = (db.upsertMany.mock.calls as unknown as [string, any[]][]).find((c) => c[0] === "submissions")![1];
    expect(saved.map((g) => `${g.dt_id}|${g.source}`).sort()).toEqual(["D3|customer", "D3|lt"]);
    expect(saved.some((g) => g.dt_id === "D9")).toBe(false); // the F2 capture was left out

    const issues = (db.upsertMany.mock.calls as unknown as [string, any[]][]).find((c) => c[0] === "capture_issues")![1];
    const lt = issues.find((i) => i.source === "lt" && i.reason === SELF_ASSIGNED_REASON)!;
    expect(lt).toMatchObject({ fid: "9", dt_id: "D3", feeder_id: "F1", structure_no: "S1", username: "ada" });
    expect(issues.find((i) => i.source === "customer")).toMatchObject({ fid: "1", building_code: "B1", customer_no: "C1" });
    expect(issues.find((i) => i.feeder_id === "X9")).toMatchObject({ reason: "Captured on a feeder that is not in the lookup", structure_no: "S2" });

    const allocs = (db.addMany.mock.calls[0] as unknown as [string, any[]])[1];
    expect(allocs).toHaveLength(1);
    expect(allocs[0]).toMatchObject({ dt_id: "D3", enumerator_id: "e1", self_assigned: true, authorized: false, status: "active" });

    const dtPatch = (db.patchMany.mock.calls as unknown as [string, any[]][]).find((c) => c[0] === "dts")![1];
    const d3 = dtPatch.find((p) => p.id === "d-D3")!;
    expect(d3.patch.status).toBe("assigned");
    expect(d3.patch.workers.map((w: any) => w.username)).toEqual(["ada"]);

    expect(screen.getByText(/Self-assigned DTs: captured, but not assigned on the app/)).toBeTruthy();
    expect(screen.getByText(/Captured on a feeder that is not in the lookup/)).toBeTruthy();
  });

  it("refuses to run when the DT IDs are in scientific notation", async () => {
    dash.fetchDashboardCaptureRows.mockResolvedValue({ savedAt: null, lt: [], customer: [{ username: "ada", feeder: "F1", "DT ID": "5.01E+11", time: "2026-10-13 10:00:00" }] });
    const { toast } = await import("sonner");
    wrap(<UploadsTab m={build()} />);
    fireEvent.click(screen.getByRole("button", { name: /Check the Dashboard's/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("scientific notation")));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("self-assigned DTs in DT Allocation", () => {
  const pending = () => build({
    dts: [dt("D1", "F1", "assigned"), dt("D3", "F1", "assigned")],
    allocations: [al("D1", "e2"), al("D3", "e1", { self_assigned: true, authorized: false })],
    submissions: [
      { id: "s1", username: "ada", feeder_id: "F1", dt_id: "D3", captured_at: "2026-10-13T10:00:00Z", day: "2026-10-13", count: 5 },
      { id: "s2", username: "ghost", feeder_id: "F1", dt_id: "D3", captured_at: "2026-10-12T10:00:00Z", day: "2026-10-12", count: 2, source: "lt" },
    ],
    capture_issues: [{ id: "i1", username: "ada", feeder_id: "F1", dt_id: "D3", captured_at: null, reason: SELF_ASSIGNED_REASON, call_back_form_no: null, customer_no: null, building_code: null, upload: "x" }],
    alert_resolutions: [{ id: "u", kind: "user", key: "ghost", response: "Resigned", resolved_at: "x" }],
  });

  it("shows who captured, each kind looking different, and the authorization badge", () => {
    wrap(<AllocationTab m={pending()} isAdmin />);
    const chips = screen.getAllByLabelText("Captured by")[0]!;
    expect(chips.querySelector('[data-kind="staff"]')!.textContent).toContain("ada");
    expect(chips.querySelector('[data-kind="staff"]')!.textContent).toContain("self-assigned");
    const left = chips.querySelector('[data-kind="left"]')!;
    expect(left.textContent).toContain("ghost");
    expect(left.textContent).toContain("Resigned");
    expect(left.querySelector(".line-through")).toBeTruthy();
    expect(screen.getAllByText(/Self-assigned · needs authorization/).length).toBeGreaterThan(0);
  });

  it("authorizes: marks the allocation authorized and clears the self-assigned flag", async () => {
    wrap(<AllocationTab m={pending()} isAdmin />);
    fireEvent.click(screen.getAllByRole("button", { name: "Authorize" })[0]!);
    await waitFor(() => expect(db.patchMany).toHaveBeenCalledWith("allocations", [{ id: "D3-e1", patch: { authorized: true } }]));
    await waitFor(() => expect(db.removeMany).toHaveBeenCalledWith("capture_issues", ["i1"]));
  });

  it("rejects: cancels the allocation, puts the DT back to not assigned, keeps the captures flagged", async () => {
    wrap(<AllocationTab m={pending()} isAdmin />);
    fireEvent.click(screen.getAllByRole("button", { name: "Reject" })[0]!);
    fireEvent.click(await screen.findByRole("button", { name: "Yes, reject" }));
    await waitFor(() => expect(db.patchMany).toHaveBeenCalledWith("allocations", [{ id: "D3-e1", patch: { status: "cancelled", authorized: false } }]));
    expect(db.updateRow).toHaveBeenCalledWith("dts", "d-D3", expect.objectContaining({ status: "unassigned" }));
    expect(db.patchMany).toHaveBeenCalledWith("capture_issues", [{ id: "i1", patch: { reason: "DT not allocated to anyone" } }]);
  });

  it("filters to DTs that need authorization", () => {
    wrap(<AllocationTab m={pending()} isAdmin />);
    fireEvent.click(screen.getByRole("button", { name: /^Needs authorization/ }));
    expect(screen.queryAllByText("DT D1")).toHaveLength(0);
    expect(screen.getAllByText("DT D3").length).toBeGreaterThan(0);
  });
});
