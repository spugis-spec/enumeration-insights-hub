import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { useAppData, useRefresh, useRole } from "@/lib/field/data";
import { scanFeeders, validateCaptureScan, type Analysis, type CaptureInput } from "@/lib/field/captureEngine";
import { applyCaptureCheck, checkSummary, type CheckChoice } from "@/lib/field/captureRun";
import { toRows } from "@/lib/field/dashboardSync";
import { CaptureReportDialog, CaptureScopeDialog } from "@/components/field/CaptureDialogs";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type DashboardPush = { customer: unknown; lt: unknown; from: string | null; to: string | null };

/**
 * The Dashboard (an embedded page) has a "Push LT Pole & Customer data to Field Manager" button. It sends its rows here,
 * and the capture check runs on top of the Dashboard page, so the Dashboard (and its uploaded data) stays where it is.
 */
export function DashboardBridge() {
  const [push, setPush] = useState<DashboardPush | null>(null);
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const d = e.data as { type?: string } & Partial<DashboardPush>;
      if (d?.type !== "dashboard-push-captures") return;
      setPush({ customer: d.customer ?? [], lt: d.lt ?? [], from: d.from ?? null, to: d.to ?? null });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  return push ? <PushFlow push={push} onClose={() => setPush(null)} /> : null;
}

function Notice({ title, body, onClose }: { title: string; body: string; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{body}</DialogDescription></DialogHeader>
        <DialogFooter><Button onClick={onClose}>OK</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PushFlow({ push, onClose }: { push: DashboardPush; onClose: () => void }) {
  const { user, ready } = useAuth();
  if (!ready) return null;
  if (!user) return <Notice title="Sign in first" body="Sign in at the top right, then press the push button again. The Dashboard keeps your uploaded data meanwhile." onClose={onClose} />;
  return <PushRun push={push} onClose={onClose} />;
}

function PushRun({ push, onClose }: { push: DashboardPush; onClose: () => void }) {
  const { data: m, isError } = useAppData();
  const role = useRole();
  const refresh = useRefresh();
  const navigate = useNavigate();
  const [stage, setStage] = useState<"scope" | "running" | "report">("scope");
  const [report, setReport] = useState<{ a: Analysis; label: string; feeders: string[]; from: string | null; to: string | null } | null>(null);

  const inputs = useMemo<CaptureInput[]>(() => {
    const out: CaptureInput[] = [];
    const customer = toRows(push.customer), lt = toRows(push.lt);
    const when = new Date().toLocaleString();
    if (customer.length) out.push({ source: "customer", label: `Dashboard push: Customer Enumeration (${when})`, rows: customer });
    if (lt.length) out.push({ source: "lt", label: `Dashboard push: LT Pole (${when})`, rows: lt });
    return out;
  }, [push]);
  const scan = useMemo(() => (m ? scanFeeders(inputs, m) : null), [m, inputs]);
  const problem = m && scan ? validateCaptureScan(scan, m) : null;

  useEffect(() => { if (problem) toast.error(problem); }, [problem]);

  if (isError) return <Notice title="Couldn't read the Field Manager data" body="Check your connection and that you are signed in with a Field Manager role, then try again." onClose={onClose} />;
  if (!m || !role.data) return <Notice title="Loading Field Manager data…" body="One moment." onClose={onClose} />;
  if (role.data.role !== "admin") return <Notice title="Field Manager admin needed" body="Only a Field Manager admin can push captures, because it assigns DTs and records flags." onClose={onClose} />;
  if (problem) return null;

  async function run(choice: CheckChoice) {
    setStage("running");
    try {
      const a = await applyCaptureCheck({ m: m!, inputs, choice });
      toast.success(checkSummary(a));
      setReport({ a, label: inputs.map((i) => i.label).join(" + "), feeders: choice.feeders, from: choice.from, to: choice.to });
      setStage("report");
      void refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "The check failed");
      onClose();
    }
  }

  if (stage === "running") return <Notice title="Checking captures…" body="Saving who worked, flags and assigned DTs. This can take a little while for large files." onClose={() => {}} />;
  if (stage === "report" && report)
    return <CaptureReportDialog rep={report} m={m} onCompleted={() => void refresh()} onClose={onClose} goTo={() => { onClose(); void navigate({ to: "/field" }); }} />;
  return (
    <CaptureScopeDialog
      req={{ inputs, scan: scan! }} m={m} hasData={m.submissions.length > 0} legacyCount={m.submissions.filter((x) => x.day == null).length}
      allowRestore={false} initialRange={push.from ? { from: push.from, to: push.to ?? push.from } : undefined}
      onCancel={onClose} onRun={(c) => void run(c)}
    />
  );
}
