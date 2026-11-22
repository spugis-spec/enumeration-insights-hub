import { describe, expect, it } from "vitest";
import { addAppearedRows, buildAppearedWrites, createAppearedAcc, matchAppeared, type AppearedAcc } from "@/lib/field/appeared";
import type { CaptureRow } from "@/lib/field/captureEngine";
import { buildModel } from "@/lib/field/data";

const feeder = (id: string): any => ({ id: `f-${id}`, feeder_id: id, feeder_name: `Feeder ${id}`, area: null, feeder_type: null, est_customer_points: null, start_date: null, locked: false });
const dt = (id: string, f = "F1", o: any = {}): any => ({ id: `d-${id}`, dt_id: id, feeder_id: f, dt_name: `DT ${id}`, dt_type: null, status: "unassigned", status_note: null, ...o });
const en = (id: string, username: string, name: string): any => ({ id, username, full_name: name, phone: null, supervisor: null, active: true });
const al = (dt_id: string, enumerator_id: string, o: any = {}): any => ({ id: `${dt_id}-${enumerator_id}`, dt_id, enumerator_id, allocated_by: null, allocated_on: "2026-10-01", due_date: null, notes: null, status: "active", completed_on: null, ...o });

const STAFF = [en("e1", "ada", "Ada"), en("e2", "bayo", "Bayo"), en("e3", "chi", "Chi"), en("e4", "dele", "Dele"), en("e5", "emeka", "Emeka"), en("e6", "funmi", "Funmi")];

const model = (extra: any = {}) =>
  buildModel({
    feeders: [feeder("F1"), feeder("F2")],
    dts: [
      dt("D1", "F1"),
      dt("D2", "F1", { status: "assigned" }),
      dt("D3", "F1"),
      dt("D4", "F2"),
      dt("D5", "F1", { workers: [{ username: "oldperson", first: "2026-09-01T00:00:00.000Z", last: "2026-09-02T00:00:00.000Z", source: "customer" }] }),
      dt("D6", "F1"),
    ],
    enumerators: STAFF,
    allocations: [al("D5", "e1"), al("D6", "e1")],
    submissions: [], vehicles: [], trips: [], ...extra,
  });

const row = (username: string | null, dtId: string | null, o: any = {}): CaptureRow => ({ username, feeder: "F1", "DT ID": dtId, time: "2026-10-13 12:00:00", fid: "7", ...o });

/** D1 captured on by six different staff members, ada three times across three days. */
const d1Rows: CaptureRow[] = [
  row("ada", "D1", { time: "2026-10-13 12:00:00" }),
  row("ada", "D1", { time: "2026-10-14 12:00:00" }),
  row("ada", "D1", { time: "2026-10-15 12:00:00" }),
  row("bayo", "D1"), row("bayo", "D1"),
  row("chi", "D1"), row("dele", "D1"), row("emeka", "D1"), row("funmi", "D1"),
];
const accOf = (rows: CaptureRow[]): AppearedAcc => { const a = createAppearedAcc(); addAppearedRows(a, rows); return a; };

describe("addAppearedRows", () => {
  it("groups every capturer on one DT (six people) with counts and first/last", () => {
    const m = matchAppeared(model(), "F1", accOf(d1Rows));
    const d1 = m.matches.find((x) => x.dt.dt_id === "D1")!;
    expect(d1.total).toBe(9);
    expect(d1.capturers).toHaveLength(6);
    expect(d1.capturers.map((c) => c.username)).toEqual(["ada", "bayo", "chi", "dele", "emeka", "funmi"]);
    const ada = d1.capturers[0]!;
    expect(ada.count).toBe(3);
    expect(ada.first!.slice(0, 10)).toBe("2026-10-13");
    expect(ada.last!.slice(0, 10)).toBe("2026-10-15");
  });

  it("skips rows with no DT ID", () => {
    const acc = accOf([row("ada", null), row("ada", "D1"), { username: "ada", feeder: "F1", time: "2026-10-13 12:00:00" } as CaptureRow]);
    expect(acc.size).toBe(1);
    expect(matchAppeared(model(), "F1", acc).matches[0]!.total).toBe(1);
  });

  it("counts rows with no username toward the DT total under the empty capturer", () => {
    const acc = accOf([row("ghost", "D3"), row("ghost", "D3"), row(null, "D3"), row(null, "D3"), row(null, "D3")]);
    const d3 = matchAppeared(model(), "F1", acc).matches.find((x) => x.dt.dt_id === "D3")!;
    expect(d3.total).toBe(5);
    const anon = d3.capturers.find((c) => c.username === "")!;
    expect(anon.count).toBe(3);
    expect(anon.enumeratorId).toBeNull();
  });
});

describe("matchAppeared", () => {
  const rows = [...d1Rows, row("ada", "D2"), row("ghost", "D3"), row("ada", "D4", { feeder: "F2" }), row("ada", "D9")];
  it("returns only the unassigned DTs of the chosen feeder", () => {
    const r = matchAppeared(model(), "F1", accOf(rows));
    expect(r.matches.map((x) => x.dt.dt_id)).toEqual(["D1", "D3"]);
  });
  it("counts appeared on this feeder (any status) vs elsewhere or unknown", () => {
    const r = matchAppeared(model(), "F1", accOf(rows));
    expect(r.appearedOnFeeder).toBe(3); // D1, D2 (assigned), D3
    expect(r.appearedElsewhere).toBe(2); // D4 (other feeder), D9 (not in lookup)
  });
  it("resolves staff capturers to full name and enumerator id, strangers to null", () => {
    const r = matchAppeared(model(), "F1", accOf(rows));
    const ada = r.matches.find((x) => x.dt.dt_id === "D1")!.capturers.find((c) => c.username === "ada")!;
    expect(ada).toMatchObject({ fullName: "Ada", enumeratorId: "e1" });
    const ghost = r.matches.find((x) => x.dt.dt_id === "D3")!.capturers[0]!;
    expect(ghost).toMatchObject({ username: "ghost", fullName: null, enumeratorId: null });
  });
});

describe("buildAppearedWrites", () => {
  const opts = { authorize: false, uid: "admin-uid", today: "2026-10-20" };
  const matchFor = (m: any, rows: CaptureRow[], dtId: string) => matchAppeared(m, "F1", accOf(rows)).matches.find((x) => x.dt.dt_id === dtId)!;

  it("creates one allocation per staff capturer — not one per DT", () => {
    const m = model();
    const w = buildAppearedWrites(m, [matchFor(m, d1Rows, "D1")], opts);
    expect(w.allocCount).toBe(6);
    expect(w.allocations.map((a) => a["enumerator_id"]).sort()).toEqual(["e1", "e2", "e3", "e4", "e5", "e6"]);
    expect(w.allocations[0]).toMatchObject({ dt_id: "D1", status: "active", self_assigned: true, authorized: false, allocated_by: "admin-uid", due_date: null, completed_on: null });
    expect(w.allocations[0]!["notes"]).toBe("Self-assigned: captured on this DT before it was assigned on the app. Awaiting authorization.");
    expect(w.workerOnlyDts).toBe(0);
    const patch = w.dtPatches.find((p) => p.id === "d-D1")!;
    expect(patch.patch["status"]).toBe("assigned");
    expect(patch.patch["status_note"]).toBeNull();
    expect(patch.patch["workers"].map((x: any) => x.username).sort()).toEqual(["ada", "bayo", "chi", "dele", "emeka", "funmi"]);
  });

  it("authorize=true marks the allocations authorized with the Authorized note", () => {
    const m = model();
    const w = buildAppearedWrites(m, [matchFor(m, d1Rows, "D1")], { ...opts, authorize: true });
    expect(w.allocations.every((a) => a["authorized"] === true)).toBe(true);
    expect(w.allocations[0]!["notes"]).toBe("Self-assigned: captured on this DT before it was assigned on the app. Authorized.");
  });

  it("skips a capturer who already holds a live allocation on the DT, and keeps existing workers", () => {
    const m = model();
    const rows = [row("ada", "D5"), row("bayo", "D5"), row("bayo", "D5")];
    const w = buildAppearedWrites(m, [matchFor(m, rows, "D5")], opts);
    expect(w.allocations.map((a) => a["enumerator_id"])).toEqual(["e2"]); // ada (e1) already holds a live allocation on D5
    const patch = w.dtPatches.find((p) => p.id === "d-D5")!;
    expect(patch.patch["status"]).toBe("assigned"); // an allocation was created (for bayo)
    expect(patch.patch["workers"].map((x: any) => x.username).sort()).toEqual(["ada", "bayo", "oldperson"]); // nobody dropped
  });

  it("does not flip the status when no allocation could be created, and counts worker-only DTs", () => {
    const m = model();
    // D6: its only capturer (ada) already holds a live allocation. D3: only a stranger and no-name rows.
    const w = buildAppearedWrites(m, [matchFor(m, [row("ada", "D6"), row("ada", "D6")], "D6"), matchFor(m, [row("ghost", "D3"), row(null, "D3")], "D3")], opts);
    expect(w.allocCount).toBe(0);
    expect(w.workerOnlyDts).toBe(2);
    const p6 = w.dtPatches.find((p) => p.id === "d-D6")!;
    expect(p6.patch["status"]).toBeUndefined();
    expect(p6.patch["workers"].map((x: any) => x.username)).toEqual(["ada"]);
    const p3 = w.dtPatches.find((p) => p.id === "d-D3")!;
    expect(p3.patch["status"]).toBeUndefined();
    expect(p3.patch["workers"].map((x: any) => x.username)).toEqual(["ghost"]); // the "" no-name rows are not attached as a worker
  });

  it("a cancelled allocation does not block a new one", () => {
    const m = model({ allocations: [al("D5", "e1"), al("D6", "e1", { status: "cancelled" })] });
    const w = buildAppearedWrites(m, [matchFor(m, [row("ada", "D6")], "D6")], opts);
    expect(w.allocCount).toBe(1);
    expect(w.dtPatches.find((p) => p.id === "d-D6")!.patch["status"]).toBe("assigned");
  });
});
