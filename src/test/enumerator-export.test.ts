import { describe, expect, it } from "vitest";
import { buildEnumeratorExport } from "@/lib/enumeratorExport";

const mappings = {
  aedc: { sup1: "Ada Supervisor" },
  nysc: { "corp.a": "Chi Corper", corpb: "Bayo Corper" },
  bss: {},
};
const phones = { sup1: "08011111111", corpb: "08022222222" }; // keyed by lowercase username

describe("enumerator export", () => {
  it("joins names, phones, teams and supervision list", () => {
    const pairings = { teams: [{ name: "Team 1", members: [{ group: "aedc", username: "sup1" }, { group: "nysc", username: "corp.a" }] }] };
    const r = buildEnumeratorExport(mappings, phones, pairings, ["corpb"]);
    expect(r.counts).toEqual({ enumerators: 3, teams: 1, withPhone: 2 });
    const sup = r.enumerators.find((x) => x[1] === "sup1")!;
    expect(sup.slice(0, 5)).toEqual(["AEDC", "sup1", "Ada Supervisor", "08011111111", "Team 1"]);
    expect(String(sup[5])).toContain("Chi Corper");
    const b = r.enumerators.find((x) => x[1] === "corpb")!;
    expect(b[4]).toBe("");
    expect(b[6]).toBe("Yes");
    expect(r.teams[0]![0]).toBe("Team 1");
  });

  it("reads older pairing format and object-shaped arrays", () => {
    const pairings = { aedcNysc: { 0: { staffUsername: "sup1", nyscUsername: "corpb" } } };
    const r = buildEnumeratorExport(mappings, phones, pairings, { 0: "sup1" });
    expect(r.counts.teams).toBe(1);
    expect(r.enumerators.find((x) => x[1] === "sup1")![4]).toBe("Team A1");
    expect(r.enumerators.find((x) => x[1] === "sup1")![6]).toBe("Yes");
  });

  it("copes with nothing saved", () => {
    expect(buildEnumeratorExport(null, null, null, null).counts.enumerators).toBe(0);
  });

  it("adds team members that are missing from mappings", () => {
    const r = buildEnumeratorExport({}, {}, { teams: [{ name: "T", members: [{ group: "bss", username: "ghost" }] }] }, null);
    expect(r.enumerators[0]![1]).toBe("ghost");
  });
});
