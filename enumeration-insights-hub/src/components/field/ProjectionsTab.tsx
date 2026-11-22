import { useState } from "react";
import { toast } from "sonner";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { updateRow, safeId } from "@/lib/field/db";
import { activeAllocs, feederStats, fmtDate, projectFeeder, statusLabel, useRefresh, type Model } from "@/lib/field/data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Section, selectCls } from "./common";
import { SHARED_KEYS, useDailyTarget, useSharedNumber } from "@/lib/shared";

function bars(doc: jsPDF, x: number, y: number, w: number, h: number, items: { label: string; value: number; color: [number, number, number] }[]) {
  const max = Math.max(1, ...items.map((i) => i.value));
  const bw = w / items.length;
  items.forEach((it, i) => {
    const bh = (it.value / max) * (h - 14);
    doc.setFillColor(...it.color);
    doc.rect(x + i * bw + 4, y + h - 10 - bh, bw - 8, bh, "F");
    doc.setFontSize(8); doc.setTextColor(30);
    doc.text(String(it.value), x + i * bw + bw / 2, y + h - 12 - bh, { align: "center" });
    doc.text(it.label.slice(0, 16), x + i * bw + bw / 2, y + h - 3, { align: "center" });
  });
}

function header(doc: jsPDF, title: string) {
  doc.setFillColor(15, 37, 87); doc.rect(0, 0, 210, 24, "F");
  doc.setTextColor(255); doc.setFontSize(16); doc.text(title, 12, 15);
  doc.setFontSize(8); doc.text(`Generated ${new Date().toLocaleString("en-GB")}`, 198, 15, { align: "right" });
  doc.setTextColor(30);
}

export function ProjectionsTab({ m, isAdmin }: { m: Model; isAdmin: boolean }) {
  const refresh = useRefresh();
  const [fid, setFid] = useState("all");
  const feeders = fid === "all" ? m.feeders : m.feeders.filter((f) => f.feeder_id === fid);
  const [dailyTarget, setDailyTarget] = useDailyTarget();
  const [buffer, setBuffer] = useSharedNumber(SHARED_KEYS.projectionBuffer, 0);
  const opts = { dailyTarget, bufferPct: buffer };

  async function save(id: string, patch: any) {
    try { await updateRow("feeders", safeId(id), patch); } catch (e: any) { return toast.error(e.message); }
    refresh();
  }

  function allocationReport() {
    const doc = new jsPDF();
    header(doc, "DT Allocation Status Report");
    let y = 32;
    for (const f of feeders) {
      if (y > 200) { doc.addPage(); y = 20; }
      const s = feederStats(m, f.feeder_id);
      doc.setFontSize(13); doc.text(`${f.feeder_name} (${f.feeder_id})`, 12, y);
      doc.setFontSize(9);
      doc.text(`Area: ${f.area ?? "-"}   Start date: ${fmtDate(f.start_date)}   Total DTs: ${s.total}   Captures: ${s.captures}`, 12, y + 6);
      doc.text(`${s.assigned} DTs are assigned, ${s.unassigned} are still NOT assigned, ${s.completed} completed, ${s.problematic} problematic and ${s.access_denied} access denied. ${s.noCapture} DTs have no capture yet.`, 12, y + 12, { maxWidth: 186 });
      bars(doc, 12, y + 16, 186, 45, [
        { label: "Assigned (Ongoing)", value: s.assigned, color: [34, 160, 90] }, { label: "Not assigned", value: s.unassigned, color: [210, 50, 40] },
        { label: "Completed", value: s.completed, color: [15, 37, 87] }, { label: "Problematic", value: s.problematic, color: [230, 150, 30] },
        { label: "Access denied", value: s.access_denied, color: [60, 60, 60] }, { label: "No capture", value: s.noCapture, color: [150, 150, 170] },
      ]);
      const rows = m.dts.filter((d) => d.feeder_id === f.feeder_id).sort((a, b) => a.status.localeCompare(b.status)).map((d) => {
        const al = (m.allocsByDt.get(d.dt_id) ?? []).slice(-1)[0];
        return [d.dt_id, d.dt_name ?? "", statusLabel(d.status), activeAllocs(m, d.dt_id).map((a) => m.enumById.get(a.enumerator_id)?.full_name || m.enumById.get(a.enumerator_id)?.username).join(", "), al ? fmtDate(al.allocated_on) : "-", String(m.subsByDt.get(d.dt_id) ?? 0)];
      });
      autoTable(doc, { startY: y + 64, head: [["DT ID", "DT name", "Status", "Enumerators", "Allocated", "Captures"]], body: rows, styles: { fontSize: 7 }, headStyles: { fillColor: [15, 37, 87] },
        didParseCell: (c) => { if (c.section === "body" && c.column.index === 2) c.cell.styles.textColor = c.cell.raw === "Not assigned" ? [200, 30, 30] : c.cell.raw === "Assigned" ? [20, 140, 70] : [30, 30, 30]; } });
      y = (doc as any).lastAutoTable.finalY + 14;
    }
    doc.save("dt-allocation-report.pdf");
  }

  function projectionReport() {
    const doc = new jsPDF();
    header(doc, "Feeder Completion Projection Report");
    doc.setFontSize(8); doc.text(`Daily target ${dailyTarget}/person · buffer ${buffer > 0 ? "+" : ""}${buffer}% on estimated points`, 12, 28);
    const ps = feeders.map((f) => ({ f, p: projectFeeder(m, f, opts) }));
    autoTable(doc, { startY: 30, head: [["Feeder", "Start", "Est. points", "Captured", "%", "Staff", "Target/day", "Projected (plan)", "Projected (pace)"]],
      body: ps.map(({ f, p }) => [f.feeder_name, fmtDate(f.start_date), p.est, p.captured, p.pct.toFixed(1) + "%", p.staff, p.target, fmtDate(p.plannedDate), fmtDate(p.actualDate)]),
      styles: { fontSize: 7 }, headStyles: { fillColor: [15, 37, 87] } });
    let y = (doc as any).lastAutoTable.finalY + 8;
    bars(doc, 12, y, 186, 50, ps.slice(0, 10).map(({ f, p }) => ({ label: f.feeder_name, value: Math.round(p.pct), color: [34, 160, 90] })));
    doc.setFontSize(8); doc.text("Chart: % of estimated customer points captured per feeder", 12, y + 56);
    y += 66;
    for (const { f, p } of ps) {
      if (y > 250) { doc.addPage(); y = 20; }
      doc.setFontSize(11); doc.text(f.feeder_name, 12, y);
      doc.setFontSize(8.5);
      const txt = `Work started ${fmtDate(f.start_date)}. Of an estimated ${p.est.toLocaleString()} customer points, ${p.captured.toLocaleString()} have been captured (${p.pct.toFixed(1)}%), leaving ${p.remaining.toLocaleString()}. ` +
        `${p.staff} enumerator(s) are currently allocated across ${p.dtCount} DTs. At the target of ${p.target} points per person per day (${p.plannedRate}/day, ${p.perWeek} working days a week), the feeder should finish in about ${p.plannedDays ?? "—"} working days, on ${fmtDate(p.plannedDate)}. ` +
        (p.actualRate ? `Based on the actual field pace of ${p.actualRate.toFixed(0)} captures per working day, completion is expected on ${fmtDate(p.actualDate)}.` : "No capture history yet to measure actual pace.") +
        (p.staff === 0 ? " No staff allocated — the date cannot be projected until DTs are allocated." : "");
      const lines = doc.splitTextToSize(txt, 186);
      doc.text(lines, 12, y + 5);
      y += 10 + lines.length * 4;
    }
    doc.save("completion-projection-report.pdf");
  }

  return (
    <div className="space-y-4">
      <Section title="Reports" actions={
        <div className="flex flex-wrap gap-2">
          <select className={selectCls} value={fid} onChange={(e) => setFid(e.target.value)}>
            <option value="all">All feeders</option>
            {m.feeders.map((f) => <option key={f.feeder_id} value={f.feeder_id}>{f.feeder_name}</option>)}
          </select>
          <Button onClick={allocationReport}>PDF: DT allocation report</Button>
          <Button variant="outline" onClick={projectionReport}>PDF: Completion projection</Button>
        </div>
      }>
        <p className="text-sm text-muted-foreground">Projections use estimated customer points, captures uploaded so far, the number of enumerators currently allocated on each feeder and the daily target per person.</p>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium">Daily target per person (shared with the Dashboard)
            <Input type="number" min={1} value={dailyTarget} onChange={(e) => { const n = Number(e.target.value); if (n > 0) setDailyTarget(n); }} />
          </label>
          <label className="text-sm font-medium">Projection buffer: <b>{buffer > 0 ? "+" : ""}{buffer}%</b> <span className="text-xs text-muted-foreground">(network expansion / unmapped discovery)</span>
            <input type="range" min={-10} max={10} step={1} value={buffer} onChange={(e) => setBuffer(Number(e.target.value))} className="mt-2 w-full accent-primary" />
            <span className="flex justify-between text-xs text-muted-foreground"><span>−10%</span><span>0</span><span>+10%</span></span>
          </label>
        </div>
      </Section>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {feeders.map((f) => {
          const p = projectFeeder(m, f, opts);
          return (
            <div key={f.feeder_id} className="rounded-lg border bg-card p-4 shadow-sm">
              <div className="font-display text-xl font-bold">{f.feeder_name}</div>
              <div className="mt-2 h-3 overflow-hidden rounded-full bg-muted"><div className="h-full bg-success" style={{ width: `${p.pct}%` }} /></div>
              <div className="mt-1 text-xs text-muted-foreground">{p.captured.toLocaleString()} / {p.est.toLocaleString()} points · {p.pct.toFixed(1)}%{p.bufferPct ? ` (base ${p.baseEst.toLocaleString()} ${p.bufferPct > 0 ? "+" : ""}${p.bufferPct}%)` : ""}</div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <div><div className="text-xs text-muted-foreground">Staff allocated</div><b>{p.staff}</b></div>
                <div><div className="text-xs text-muted-foreground">Actual pace/day</div><b>{p.actualRate.toFixed(0)}</b></div>
                <div><div className="text-xs text-muted-foreground">Remaining points</div><b>{p.remaining.toLocaleString()}</b></div>
                <div><div className="text-xs text-muted-foreground">Planned rate/day</div><b>{p.plannedRate}</b> <span className="text-xs text-muted-foreground">({p.staff} × {p.target})</span></div>
                <div><div className="text-xs text-muted-foreground">Finish (plan)</div><b className="text-success">{fmtDate(p.plannedDate)}</b></div>
                <div><div className="text-xs text-muted-foreground">Finish (pace)</div><b>{fmtDate(p.actualDate)}</b></div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <label>Est. customer points<Input type="number" disabled={!isAdmin} defaultValue={f.est_customer_points ?? 0} onBlur={(e) => save(f.feeder_id, { est_customer_points: Number(e.target.value) })} /></label>
                <label>Start date<Input type="date" defaultValue={f.start_date ?? ""} onBlur={(e) => save(f.feeder_id, { start_date: e.target.value || null })} /></label>
                <label>Work days/week<Input type="number" min={5} max={7} disabled={!isAdmin} defaultValue={f.working_days_per_week ?? 6} onBlur={(e) => save(f.feeder_id, { working_days_per_week: Number(e.target.value) })} /></label>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
