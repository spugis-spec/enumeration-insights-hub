import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const db = vi.hoisted(() => ({
  patchMany: vi.fn(async () => 0), upsertMany: vi.fn(async () => {}), removeMany: vi.fn(async () => 0),
  updateRow: vi.fn(async () => {}), addRow: vi.fn(async () => "id"), safeId: (s: string) => s, listAll: vi.fn(async () => []),
}));
vi.mock("@/lib/field/db", () => db);
vi.mock("@/lib/field/firebase", () => ({ auth: () => ({ currentUser: { uid: "u1" } }), db: () => ({}), currentUser: async () => ({ uid: "u1" }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));
vi.mock("@/lib/field/pairingsApi", () => ({
  fetchPairingsRaw: vi.fn(async () => ({
    pairings: { teams: [
      { name: "Team 1", members: [{ group: "aedc", username: "sup1" }, { group: "nysc", username: "ada" }] },
      { name: "Team 2", members: [{ group: "bss", username: "bayo" }, { group: "nysc", username: "stranger" }] },
    ] },
    mappings: { aedc: { sup1: "Sade Supervisor" }, nysc: { stranger: "Not On List" } },
  })),
}));

import { buildModel } from "@/lib/field/data";
import { buildPairTeams, teamMatches } from "@/lib/field/pairings";
import { AllocationTab } from "@/components/field/AllocationTab";

const feeders: any[] = [{ id: "f1", feeder_id: "F1", feeder_name: "Feeder One", locked: false, area: null, feeder_type: null, est_customer_points: null, start_date: null }];
const dts: any[] = [{ id: "d3", dt_id: "D3", feeder_id: "F1", dt_name: "Charlie DT", dt_type: null, status: "unassigned", status_note: null }];
const mk = (id: string, username: string, full_name: string) => ({ id, username, full_name, phone: null, supervisor: null, active: true });
const enumerators: any[] = [mk("e1", "ada", "Ada Corper"), mk("e2", "bayo", "Bayo Corper"), mk("e3", "sup1", "Sade Supervisor")];

beforeEach(() => vi.clearAllMocks());

describe("team pairing helpers", () => {
  const raw = {
    pairings: { teams: [{ name: "Team 1", members: [{ group: "aedc", username: "sup1" }, { group: "nysc", username: "ada" }] }, { name: "Team 2", members: [{ group: "bss", username: "ghost" }] }] },
    mappings: { bss: { ghost: "Ghost Name" } },
  };
  it("matches members to the staff list and keeps unmatched ones", () => {
    const t = buildPairTeams(raw, enumerators);
    expect(t[0]!.members.map((x) => x.enumeratorId)).toEqual(["e3", "e1"]);
    expect(t[1]!.members[0]).toMatchObject({ name: "Ghost Name", enumeratorId: null });
  });
  it("shows the whole team when the team name or either member is searched", () => {
    const t = buildPairTeams(raw, enumerators)[0]!;
    for (const q of ["team 1", "sade", "ada", "SUP1", ""]) expect(teamMatches(t, q)).toBe(true);
    expect(teamMatches(t, "bayo")).toBe(false);
  });
  it("reads the older pairing format too", () => {
    const t = buildPairTeams({ pairings: { aedcNysc: [{ staffUsername: "sup1", nyscUsername: "ada" }] }, mappings: null }, enumerators);
    expect(t).toHaveLength(1);
    expect(t[0]!.members).toHaveLength(2);
  });
});

describe("Allocate dialog", () => {
  const open = async () => {
    render(<QueryClientProvider client={new QueryClient()}><AllocationTab m={buildModel({ feeders, dts, enumerators, allocations: [], submissions: [], vehicles: [], trips: [] })} isAdmin /></QueryClientProvider>);
    fireEvent.click(screen.getAllByRole("button", { name: /^(✋ )?Allocate/i })[0]!);
    await screen.findByText(/Allocate Charlie DT/);
  };

  it("defaults to team allocation and finds a team by either member's name", async () => {
    await open();
    expect(screen.getByRole("button", { name: "Team allocation" }).className).toContain("bg-foreground");
    expect(await screen.findByText("Team 1")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText(/Search team name or any member/), { target: { value: "sade" } });
    expect(screen.getByText("Team 1")).toBeTruthy();
    expect(screen.getByText("Ada Corper")).toBeTruthy(); // the other member of the team shows too
    expect(screen.queryByText("Team 2")).toBeNull();
  });

  it("allocates every member of the team in one go, and warns about people not on the staff list", async () => {
    await open();
    fireEvent.click((await screen.findByText("Team 1")).closest("label")!.querySelector("input")!);
    expect(screen.getByText(/Selected \(2\)/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save allocation" }));
    await waitFor(() => expect(db.addRow).toHaveBeenCalledTimes(2));
    const who = (db.addRow.mock.calls as unknown as [string, any][]).map((c) => c[1].enumerator_id).sort();
    expect(who).toEqual(["e1", "e3"]);
  });

  it("flags a team member who is not on the staff list and cannot be ticked alone", async () => {
    await open();
    expect(await screen.findByText(/not on staff list, can't be allocated/)).toBeTruthy();
  });

  it("switches to individual allocation", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Individual allocation" }));
    expect(screen.getByPlaceholderText("Search enumerators")).toBeTruthy();
    expect(screen.getByText("Bayo Corper")).toBeTruthy();
  });
});
