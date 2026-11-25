import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import type { Model } from "@/lib/field/data";
import { buildDtExport, DT_EXPORT_GROUPS, type DtExportGroup } from "@/lib/field/dtExport";
import { downloadSheet } from "@/lib/field/dataTools";

/**
 * Admin-only export for one feeder: choose Completed, Ongoing, Not assigned or All DTs
 * (with the live count of each), then download the full list as Excel — status, who each DT
 * is allocated to, who has worked on it, and its coordinates.
 */
export function DtExportDialog({ m, feederId, open, onOpenChange }: {
  m: Model; feederId: string; open: boolean; onOpenChange: (v: boolean) => void;
}) {
  const feeder = m.feederById.get(feederId);
  const [group, setGroup] = useState<DtExportGroup>("all");
  const counts = useMemo(() => (feeder ? buildDtExport(m, feeder, "all").counts : null), [m, feeder]);
  const n = counts?.[group] ?? 0;

  function doExport() {
    if (!feeder) return;
    const { rows, headers } = buildDtExport(m, feeder, group);
    downloadSheet(`DTs_${feeder.feeder_id}_${group}`, rows, headers);
    toast.success(`Exported ${rows.length} DT${rows.length === 1 ? "" : "s"} from ${feeder.feeder_name}`);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Export DTs to Excel</DialogTitle>
          <p className="text-xs text-muted-foreground">
            Feeder: <b>{feeder?.feeder_name}</b> ({feeder?.feeder_id}). Pick which DTs to include — the file lists each DT
            with its status, who it is allocated to, who has worked on it and its coordinates.
          </p>
        </DialogHeader>
        <div className="space-y-2" role="radiogroup" aria-label="Which DTs to export">
          {DT_EXPORT_GROUPS.map((g) => (
            <label
              key={g.value}
              className={"flex cursor-pointer items-center gap-2 rounded border px-3 py-2 text-sm " + (group === g.value ? "border-foreground bg-muted font-bold" : "hover:bg-muted")}
            >
              <input type="radio" name="dt-export-group" checked={group === g.value} onChange={() => setGroup(g.value)} />
              <span className="flex-1">{g.label}</span>
              <span className="text-muted-foreground">{counts?.[g.value] ?? 0}</span>
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={doExport} disabled={!n}>Export{n ? ` ${n} DT${n === 1 ? "" : "s"}` : ""}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
