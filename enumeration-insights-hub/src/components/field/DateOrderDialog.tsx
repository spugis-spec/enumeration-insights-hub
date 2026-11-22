import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { DateOrder, DateOrderInfo } from "@/lib/field/dates";

const nice = (d: string | null) => (d ? new Date(d + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—");
const span = (s: { min: string | null; max: string | null }) => (s.min ? (s.min === s.max ? nice(s.min) : `${nice(s.min)} – ${nice(s.max)}`) : "no valid dates");

/**
 * Shown when a capture file's dates can be read two ways (for example 11/04/2026 is 11 April or 4 November).
 * The user picks the order; the choice applies to this upload.
 */
export function DateOrderDialog({ info, suggested, onPick, onCancel }: {
  info: DateOrderInfo; suggested: DateOrder; onPick: (o: "dmy" | "mdy") => void; onCancel: () => void;
}) {
  const opt = (o: "dmy" | "mdy", title: string, example: string, side: DateOrderInfo["dmy"]) => (
    <button
      type="button"
      onClick={() => onPick(o)}
      className={"w-full rounded-lg border-2 p-3 text-left hover:bg-muted " + (suggested === o ? "border-foreground" : "border-border")}
    >
      <div className="text-base font-extrabold">{title}{suggested === o ? " · last used" : ""}</div>
      <div className="text-xs text-muted-foreground">{example}</div>
      <div className="mt-1 text-sm">
        Your dates would read as <b>{span(side)}</b>
        {side.future ? <span className="font-bold text-destructive"> · {side.future} would be in the future</span> : null}
      </div>
    </button>
  );
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onCancel(); }}>
      <DialogContent className="w-[calc(100vw-1rem)] max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Which order are the dates in?</DialogTitle>
        </DialogHeader>
        <p className="text-sm">
          {info.ambiguous.toLocaleString()} date{info.ambiguous === 1 ? "" : "s"} in this file can be read two ways
          {info.sample ? <> (for example <b>{info.sample}</b>)</> : null}, and nothing in the file says which. Pick the one that matches your data.
        </p>
        <div className="space-y-2">
          {opt("dmy", "Day first (DD/MM/YYYY)", "11/04/2026 is 11 April 2026", info.dmy)}
          {opt("mdy", "Month first (MM/DD/YYYY)", "11/04/2026 is 4 November 2026", info.mdy)}
        </div>
        {info.definiteDmy > 0 && info.definiteMdy > 0 && (
          <p className="rounded border border-warning bg-warning/15 p-2 text-xs font-bold">
            This file mixes both orders ({info.definiteDmy} day-first and {info.definiteMdy} month-first rows are certain). Check the file, then pick the order most rows use.
          </p>
        )}
        <div className="flex justify-end"><Button variant="ghost" onClick={onCancel}>Cancel upload</Button></div>
      </DialogContent>
    </Dialog>
  );
}
