import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/field/db", () => ({ patchMany: vi.fn(), upsertMany: vi.fn(), removeMany: vi.fn(), updateRow: vi.fn(), addRow: vi.fn(), safeId: (s: string) => s, listAll: vi.fn(async () => []) }));
vi.mock("@/lib/field/firebase", () => ({ auth: () => ({ currentUser: { uid: "u1" } }), db: () => ({}), currentUser: async () => ({ uid: "u1" }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));

import { buildModel } from "@/lib/field/data";
import { AlertsTab } from "@/components/field/AlertsTab";
import { AllocationTab } from "@/components/field/AllocationTab";

const wrap = (ui: React.ReactElement) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
const feeders: any[] = [{ id: "f1", feeder_id: "F1", feeder_name: "132KV KATAMPE 1 TS_33KV JABI FDR_PL_PL", locked: false, area: null, feeder_type: null, est_customer_points: null, start_date: null }];
const dts: any[] = [
  { id: "d1", dt_id: "501101", feeder_id: "F1", dt_name: "Jabi Market DT", dt_type: null, status: "assigned", status_note: null },
  { id: "d2", dt_id: "501102", feeder_id: "F1", dt_name: "Wuse Road DT", dt_type: null, status: "unassigned", status_note: null },
];
const enumerators: any[] = [{ id: "e1", username: "ada", full_name: "Ada", phone: null, supervisor: null, active: true }];
const allocations: any[] = [{ id: "a1", dt_id: "501101", enumerator_id: "e1", status: "active", allocated_on: "2026-10-01", due_date: null, notes: null, completed_on: null, allocated_by: null, last_worked_on: "2026-10-13" }];

beforeEach(() => vi.clearAllMocks());

describe("Assigned shows as Ongoing", () => {
  const m = () => buildModel({ feeders, dts, enumerators, allocations, submissions: [], vehicles: [], trips: [] });
  it("labels the status, the toggle and the big count", () => {
    wrap(<AllocationTab m={m()} isAdmin />);
    const sel = screen.getAllByLabelText("Status of Jabi Market DT")[0] as HTMLSelectElement;
    expect(within(sel).getByRole("option", { name: "Assigned (Ongoing)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Assigned \(Ongoing\)/ })).toBeTruthy();
    const aside = screen.getByText("(Ongoing)");
    expect(aside.previousElementSibling!.textContent).toBe("Assigned");
  });
  it("shows when the assigned person last worked", () => {
    wrap(<AllocationTab m={m()} isAdmin />);
    expect(screen.getAllByText(/worked/).length).toBeGreaterThan(0);
  });
});

describe("Captures to correct", () => {
  const issues: any[] = [{
    id: "i1", username: "ada", feeder_id: "F1", dt_id: "501102", captured_at: "2026-10-13T10:00:00Z", reason: "Has an ongoing DT but captured on a different DT",
    call_back_form_no: "CB9", customer_no: "C77", building_code: "BLD5", upload: "x", fid: "123", structure_no: "S42", source: "lt", correct_dt: "501101",
  }];
  const m = () => buildModel({ feeders, dts, enumerators, allocations: [], submissions: [], vehicles: [], trips: [], capture_issues: issues });

  it("shows the DT by its full name, and keeps the details behind a button", () => {
    wrap(<AlertsTab m={m()} />);
    fireEvent.click(screen.getByRole("button", { name: /Check capture alerts/ }));
    expect(screen.getByText("Wue Road DT".replace("Wue", "Wuse"))).toBeTruthy();
    expect(screen.queryByText("BLD5")).toBeNull();
    expect(screen.queryByText("S42")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(screen.getByText("BLD5")).toBeTruthy();
    expect(screen.getByText("C77")).toBeTruthy();
    expect(screen.getByText("123")).toBeTruthy();
    expect(screen.getByText("S42")).toBeTruthy();
    expect(screen.getByText("Wuse Road DT (501102)")).toBeTruthy(); // wrong DT
    expect(screen.getByText("Jabi Market DT (501101)")).toBeTruthy(); // correct DT
    fireEvent.click(screen.getByRole("button", { name: "Hide details" }));
    expect(screen.queryByText("BLD5")).toBeNull();
  });
});
