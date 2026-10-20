import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const u = vi.hoisted(() => ({
  listStaffUsers: vi.fn(async () => [{ id: "sup1", email: "sup@x.com", full_name: "Sade Supervisor", phone: "0801", role: "supervisor" }]),
  updateStaffUser: vi.fn(async () => {}), createStaffUser: vi.fn(async () => {}), revokeStaffUser: vi.fn(), sendReset: vi.fn(),
}));
vi.mock("@/lib/field/users", () => u);
vi.mock("@/lib/field/db", () => ({ removeRow: vi.fn(), upsertMany: vi.fn(), listAll: vi.fn(async () => []) }));
vi.mock("@/lib/field/firebase", () => ({ auth: () => ({}), db: () => ({}) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn(), message: vi.fn() } }));

import { buildModel } from "@/lib/field/data";
import { UsersTab } from "@/components/field/UsersTab";

beforeEach(() => vi.clearAllMocks());
const model = () => buildModel({ feeders: [], dts: [], enumerators: [], allocations: [], submissions: [], vehicles: [], trips: [] });
const mount = () => render(<QueryClientProvider client={new QueryClient()}><UsersTab m={model()} /></QueryClientProvider>);

describe("Users & Staff", () => {
  it("edits an existing supervisor and sets a username", async () => {
    mount();
    expect(await screen.findByText(/no username yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(await screen.findByPlaceholderText("e.g. ada.sup"), { target: { value: "sade.sup" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(u.updateStaffUser).toHaveBeenCalled());
    const [user, patch] = u.updateStaffUser.mock.calls[0] as unknown as [any, any];
    expect(user.id).toBe("sup1");
    expect(patch).toMatchObject({ username: "sade.sup", role: "supervisor", full_name: "Sade Supervisor" });
  });

  it("can create a login with a username", async () => {
    mount();
    await screen.findByText(/no username yet/);
    fireEvent.change(screen.getAllByPlaceholderText("Full name")[0]!, { target: { value: "New Sup" } });
    fireEvent.change(screen.getByPlaceholderText("Login email"), { target: { value: "new@x.com" } });
    fireEvent.change(screen.getByPlaceholderText(/Username \(optional/), { target: { value: "new.sup" } });
    fireEvent.change(screen.getByPlaceholderText(/Password/), { target: { value: "longenough1" } });
    fireEvent.click(screen.getByRole("button", { name: "Create login" }));
    await waitFor(() => expect(u.createStaffUser).toHaveBeenCalledWith(expect.objectContaining({ email: "new@x.com", username: "new.sup" })));
  });
});
