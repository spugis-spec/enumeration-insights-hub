import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { runConnectionCheck, runDownloadTest, verdict, type Step } from "@/lib/cloudCheck";
import { downloadEnumerators } from "@/lib/enumeratorExport";

const dot: Record<Step["status"], string> = { ok: "bg-green-500", slow: "bg-amber-500", fail: "bg-red-500" };
const word: Record<Step["status"], string> = { ok: "OK", slow: "Slow", fail: "Failed" };

/** Header button: check the cloud connection, and export enumerators (usernames, names, phones, teams). */
export function CloudTools() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const [running, setRunning] = useState(false);
  const [exporting, setExporting] = useState<"" | "xlsx" | "csv">("");
  const [msg, setMsg] = useState("");

  async function check() {
    setRunning(true);
    setSteps([]);
    const got: Step[] = [];
    for await (const s of runConnectionCheck()) {
      got.push(s);
      setSteps([...got]);
    }
    setRunning(false);
  }

  async function download() {
    setRunning(true);
    const s = await runDownloadTest();
    setSteps((prev) => [...prev.filter((x) => x.id !== "download"), s]);
    setRunning(false);
  }

  async function exportNow(format: "xlsx" | "csv") {
    setExporting(format);
    setMsg("");
    try {
      const c = await downloadEnumerators(format);
      setMsg(`Downloaded ${c.enumerators} enumerators (${c.withPhone} with a phone number) and ${c.teams} teams.`);
    } catch (e) {
      const x = e as { code?: string; message?: string };
      setMsg(`Export failed: ${[x.code, x.message].filter(Boolean).join(": ")}`);
    } finally {
      setExporting("");
    }
  }

  const doneBasic = steps.some((s) => s.id === "firestore");

  return (
    <>
      <button onClick={() => setOpen(true)} className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent" title="Check the cloud connection or export enumerators">
        ☁ Cloud
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Cloud tools</DialogTitle>
            <DialogDescription>Check why data is slow, or download the enumerator list.</DialogDescription>
          </DialogHeader>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Connection check</h3>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={check} disabled={running}>{running && !steps.length ? "Checking…" : "Check cloud connection"}</Button>
              <Button size="sm" variant="outline" onClick={download} disabled={running}>Test data download speed</Button>
            </div>
            {steps.length > 0 && (
              <ul className="space-y-1.5 rounded-md border p-3 text-sm">
                {steps.map((s) => (
                  <li key={s.id} className="flex items-start gap-2">
                    <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${dot[s.status]}`} />
                    <span className="min-w-0">
                      <b>{s.label}</b> — {word[s.status]}
                      {s.ms != null && <span className="text-muted-foreground"> · {s.ms >= 1000 ? `${(s.ms / 1000).toFixed(1)} s` : `${s.ms} ms`}</span>}
                      <span className="block break-words text-xs text-muted-foreground">{s.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {doneBasic && !running && <p className="rounded-md bg-muted p-3 text-sm">{verdict(steps)}</p>}
          </section>

          <section className="space-y-2 border-t pt-4">
            <h3 className="text-sm font-semibold">Export enumerators</h3>
            <p className="text-xs text-muted-foreground">
              Username, full name, phone number, group, their team and who they are paired with, and whether they are on the supervision list. The Excel file also has a Teams sheet. Read live from the cloud.
            </p>
            {user ? (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => exportNow("xlsx")} disabled={!!exporting}>{exporting === "xlsx" ? "Preparing…" : "Download Excel (.xlsx)"}</Button>
                <Button size="sm" variant="outline" onClick={() => exportNow("csv")} disabled={!!exporting}>{exporting === "csv" ? "Preparing…" : "Download CSV"}</Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Sign in (top right) to download the list.</p>
            )}
            {msg && <p className="text-sm">{msg}</p>}
          </section>
        </DialogContent>
      </Dialog>
    </>
  );
}
