import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = vi.hoisted(() => ({
  role: "admin" as string, signedIn: true,
  tables: {} as Record<string, any[]>,
  nav: vi.fn(),
}));
const db = vi.hoisted(() => ({
  upsertMany: vi.fn(async () => {}), addMany: vi.fn(async () => {}), patchMany: vi.fn(async () => 0), removeMany: vi.fn(async () => 0),
  updateRow: vi.fn(), addRow: vi.fn(), safeId: (s: string) => s,
  listAll: vi.fn(async (c: string) => state.tables[c] ?? []),
}));
vi.mock("@/lib/field/db", () => db);
vi.mock("@/lib/field/dataTools", () => ({ logUpload: vi.fn(async () => {}), downloadSheet: vi.fn() }));
vi.mock("@/lib/field/firebase", () => ({ auth: () => ({ currentUser: { uid: "admin1" } }), db: () => ({}), currentUser: async () => ({ uid: "admin1", email: "boss@x.com" }) }));
vi.mock("firebase/firestore", () => ({ doc: vi.fn(), getDoc: vi.fn(async () => ({ data: () => ({ role: state.role, full_name: "Boss" }) })) }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: state.signedIn ? { uid: "admin1" } : null, ready: true }) }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => state.nav }));
vi.mock("@/lib/field/pairingsApi", () => ({ fetchPairingsRaw: vi.fn(async () => ({ pairings: null, mappings: null })) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));

import { DashboardBridge } from "@/components/DashboardBridge";

const feeder = (id: string): any => ({ id: `f-${id}`, feeder_id: id, feeder_name: `Feeder ${id}`, area: null, feeder_type: null, est_customer_points: null, start_date: null, locked: false });
const dt = (id: string, status = "unassigned"): any => ({ id: `d-${id}`, dt_id: id, feeder_id: "F1", dt_name: `DT ${id}`, dt_type: null, status, status_note: null });
const en = (id: string, username: string, name: string): any => ({ id, username, full_name: name, phone: null, supervisor: null, active: true });

const send = (data: unknown) => act(() => { window.dispatchEvent(new MessageEvent("message", { data, origin: window.location.origin })); });
const mount = () => render(<QueryClientProvider client={new QueryClient()}><DashboardBridge /></QueryClientProvider>);

beforeEach(() => {
  vi.clearAllMocks();
  state.role = "admin"; state.signedIn = true;
  state.tables = {
    feeders: [feeder("F1")], dts: [dt("D1", "assigned"), dt("D3")], enumerators: [en("e1", "ada", "Ada"), en("e2", "bayo", "Bayo")],
    allocations: [{ id: "a1", dt_id: "D1", enumerator_id: "e2", status: "active", allocated_on: "2026-10-01", due_date: null, notes: null, completed_on: null, allocated_by: null }],
  };
});

const payload = {
  type: "dashboard-push-captures", from: "2026-10-13", to: "2026-10-13",
  customer: [
    { username: "bayo", feeder: "F1", "DT ID": "D1", time: "2026-10-13T10:00:00.000Z", fid: "1" },
    { username: "ada", feeder: "F1", "DT ID": "D3", time: "2026-10-13T11:00:00.000Z", fid: "2", building_code: "B7", customer_no: "C5" },
    { username: "ada", feeder: "F1", "DT ID": "D3", time: "2026-10-14T11:00:00.000Z", fid: "3" },
  ],
  lt: [{ username: "ada", feeder: "F1", "DT ID": "D3", time: "2026-10-13T12:00:00.000Z", fid: "9", structure_no: "S1" }],
};

describe("Dashboard push to Field Manager", () => {
  it("opens the feeder and date choice with the report date already filled in, then checks and reports", async () => {
    mount();
    send(payload);
    await screen.findByText("Which feeders and dates should I check?");
    const dialog = screen.getByRole("dialog");
    expect((within(dialog).getByLabelText(/Only these dates/) as HTMLInputElement).checked).toBe(true);
    expect(within(dialog).queryByText(/restore point/)).toBeNull(); // not offered from the Dashboard
    fireEvent.click(within(dialog).getByRole("button", { name: "Check 1 feeder" }));

    await waitFor(() => expect(screen.getByText("Check finished")).toBeTruthy());
    // only the 13th: the 14th capture is outside the report date
    const subs = (db.upsertMany.mock.calls as unknown as [string, any[]][]).find((c) => c[0] === "submissions")![1];
    expect(subs.map((g) => `${g.username}|${g.dt_id}|${g.day}|${g.source}`).sort()).toEqual(["ada|D3|2026-10-13|customer", "ada|D3|2026-10-13|lt", "bayo|D1|2026-10-13|customer"]);
    // bayo worked their own DT: confirmed; ada's DT D3 was nobody's: self-assigned
    expect(screen.getByText(/Confirmed working/)).toBeTruthy();
    expect((db.addMany.mock.calls[0] as unknown as [string, any[]])[1][0]).toMatchObject({ dt_id: "D3", enumerator_id: "e1", self_assigned: true, authorized: false });
    expect(db.patchMany).toHaveBeenCalledWith("allocations", [{ id: "a1", patch: { last_worked_on: "2026-10-13" } }]);
    const issues = (db.upsertMany.mock.calls as unknown as [string, any[]][]).find((c) => c[0] === "capture_issues")![1];
    expect(issues.find((i) => i.source === "lt")).toMatchObject({ fid: "9", structure_no: "S1", dt_id: "D3" });
    expect(issues.find((i) => i.fid === "2")).toMatchObject({ building_code: "B7", customer_no: "C5" });
  });

  it("ignores messages from other sites and unrelated messages", async () => {
    mount();
    act(() => { window.dispatchEvent(new MessageEvent("message", { data: payload, origin: "https://evil.example" })); });
    send({ type: "something-else" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("asks you to sign in first, and keeps non-admins out", async () => {
    state.signedIn = false;
    const { unmount } = mount();
    send(payload);
    expect(await screen.findByText("Sign in first")).toBeTruthy();
    unmount();
    state.signedIn = true; state.role = "supervisor";
    mount();
    send(payload);
    expect(await screen.findByText("Field Manager admin needed")).toBeTruthy();
    expect(db.upsertMany).not.toHaveBeenCalled();
  });
});
