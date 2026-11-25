import { statusLabel, type DT, type Feeder, type Model } from "./data";
import { ownCoords } from "@/lib/dtCoords";

/**
 * The DT Allocation "Export to Excel" lists. One group is exported at a time for one feeder:
 * completed, ongoing (status assigned), not assigned (status unassigned), or every DT on the
 * feeder whatever its status (problematic and access denied included).
 */
export type DtExportGroup = "completed" | "ongoing" | "not_assigned" | "all";

export const DT_EXPORT_GROUPS: { value: DtExportGroup; label: string }[] = [
  { value: "completed", label: "Completed DTs" },
  { value: "ongoing", label: "Ongoing DTs" },
  { value: "not_assigned", label: "Not assigned DTs" },
  { value: "all", label: "All DTs" },
];

export const DT_EXPORT_HEADERS = [
  "DT_ID", "DT_NAME", "DT_TYPE", "STATUS", "FEEDER_NAME", "FEEDER_ID",
  "ALLOCATED_TO", "ALLOCATED_ON", "COMPLETED_ON", "WORKERS", "LONGITUDE", "LATITUDE",
];

export type DtExportCounts = Record<DtExportGroup, number>;

const groupOf = (status: string): DtExportGroup | null =>
  status === "completed" ? "completed" : status === "assigned" ? "ongoing" : status === "unassigned" ? "not_assigned" : null;

/**
 * Builds the export rows for one feeder and group, plus the live count of every group on that
 * feeder (so the chooser can show all four counts from one call). A "live" allocation is any
 * allocation that was not cancelled: ALLOCATED_TO names everyone holding one, ALLOCATED_ON is
 * the earliest of their allocation dates, and COMPLETED_ON is the latest completion date on a
 * completed allocation. WORKERS are the usernames kept on the DT itself. Coordinates are the
 * DT's own, when they are present and plausible.
 */
export function buildDtExport(m: Model, feeder: Feeder, group: DtExportGroup): { rows: Record<string, any>[]; headers: string[]; counts: DtExportCounts } {
  const onFeeder = m.dts.filter((d) => d.feeder_id === feeder.feeder_id);
  const counts: DtExportCounts = { completed: 0, ongoing: 0, not_assigned: 0, all: onFeeder.length };
  for (const d of onFeeder) {
    const g = groupOf(d.status);
    if (g) counts[g]++;
  }

  const nameOf = (id: string) => {
    const e = m.enumById.get(id);
    return e?.full_name || e?.username || id;
  };
  const rowFor = (d: DT): Record<string, any> => {
    const allocs = m.allocsByDt.get(d.dt_id) ?? [];
    const live = allocs.filter((a) => a.status !== "cancelled");
    const allocatedTo: string[] = [];
    for (const a of live) {
      const n = nameOf(a.enumerator_id);
      if (!allocatedTo.includes(n)) allocatedTo.push(n);
    }
    const allocatedOn = live.map((a) => a.allocated_on).filter(Boolean).sort()[0] ?? "";
    const completedOn = allocs
      .filter((a) => a.status === "completed" && a.completed_on)
      .map((a) => a.completed_on as string)
      .sort()
      .slice(-1)[0] ?? "";
    const workers: string[] = [];
    for (const w of d.workers ?? []) {
      if (w?.username && !workers.includes(w.username)) workers.push(w.username);
    }
    const c = ownCoords(d);
    return {
      DT_ID: d.dt_id,
      DT_NAME: d.dt_name ?? "",
      DT_TYPE: d.dt_type ?? "",
      STATUS: statusLabel(d.status),
      FEEDER_NAME: feeder.feeder_name,
      FEEDER_ID: feeder.feeder_id,
      ALLOCATED_TO: allocatedTo.join("; "),
      ALLOCATED_ON: allocatedOn,
      COMPLETED_ON: completedOn,
      WORKERS: workers.join("; "),
      LONGITUDE: c?.lng ?? "",
      LATITUDE: c?.lat ?? "",
    };
  };

  const rows = onFeeder
    .filter((d) => group === "all" || groupOf(d.status) === group)
    .sort((a, b) => (a.dt_id < b.dt_id ? -1 : a.dt_id > b.dt_id ? 1 : 0))
    .map(rowFor);
  return { rows, headers: [...DT_EXPORT_HEADERS], counts };
}
