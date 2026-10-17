import { useState } from "react";
import { toast } from "sonner";
import { Copy, MessageCircle, Trash2 } from "lucide-react";
import { addRow, removeRow, updateRow } from "@/lib/field/db";
import { fmtDate, useRefresh, type Model } from "@/lib/field/data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Section, selectCls } from "./common";
import { useConfirm } from "./ConfirmDialog";

const VSTATUS = ["available", "on duty", "breakdown", "maintenance", "unavailable"];

export function VehiclesTab({ m, isAdmin }: { m: Model; isAdmin: boolean }) {
  const { ask, dialog } = useConfirm();
  const refresh = useRefresh();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [v, setV] = useState({ name: "", driver: "", capacity: 8, icon: "🚐" });
  const trips = m.trips.filter((t) => t.trip_date === date);

  async function addVehicle(e: React.FormEvent) {
    e.preventDefault();
    try { await addRow("vehicles", { ...v, status: "available" }); } catch (e: any) { return toast.error(e.message); }
    setV({ name: "", driver: "", capacity: 8, icon: "🚐" });
    refresh();
  }
  async function addTrip(vehicle_id: string) {
    try { await addRow("trips", { vehicle_id, trip_date: date, staff: [], destination: null, feeder_id: null, notes: null }); } catch (e: any) { return toast.error(e.message); }
    refresh();
  }
  async function upd(id: string, patch: any) {
    try { await updateRow("trips", id, patch); } catch (e: any) { return toast.error(e.message); }
    refresh();
  }

  // Suggest staff for a feeder: enumerators with active allocations there
  function staffForFeeder(fid: string) {
    const set = new Set<string>();
    for (const d of m.dts) if (d.feeder_id === fid) for (const a of m.allocsByDt.get(d.dt_id) ?? []) if (a.status === "active") {
      const e = m.enumById.get(a.enumerator_id); if (e) set.add(e.full_name || e.username);
    }
    return [...set];
  }

  const text = [`GIS ENUMERATION — DAILY VEHICLE SCHEDULE`, `Date: ${fmtDate(date)}`, ""]
    .concat(m.vehicles.flatMap((veh) => {
      const ts = trips.filter((t) => t.vehicle_id === veh.id);
      if (!ts.length) return [];
      return [`${veh.icon} ${veh.name} — Driver: ${veh.driver ?? "—"}`, ...ts.map((t) => `  ⚡ ${m.feederById.get(t.feeder_id ?? "")?.feeder_name ?? "No feeder"}${t.destination ? ` (${t.destination})` : ""}: ${(t.staff ?? []).join(", ") || "no staff"}`), ""];
    })).join("\n");

  return (
    <div className="space-y-4">
      <Section title="Daily schedule" actions={
        <div className="flex gap-2">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-44" />
          <Button variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(text); toast.success("Schedule copied"); }}><Copy className="h-4 w-4" /> Copy</Button>
          <a className="inline-flex items-center gap-1 rounded-md border px-3 text-sm" target="_blank" rel="noreferrer" href={`https://wa.me/?text=${encodeURIComponent(text)}`}><MessageCircle className="h-4 w-4" /> WhatsApp</a>
        </div>
      }>
        {!m.vehicles.length && <p className="text-muted-foreground">No vehicles yet{isAdmin ? " — add one below." : "."}</p>}
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {m.vehicles.map((veh) => {
            const ts = trips.filter((t) => t.vehicle_id === veh.id);
            const seats = ts.reduce((s, t) => s + (t.staff?.length ?? 0), 0);
            const over = seats > (veh.capacity ?? 0);
            return (
              <div key={veh.id} className="rounded-lg border bg-background p-3">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-display text-xl font-bold">{veh.icon} {veh.name}</div>
                    <div className="text-xs text-muted-foreground">Driver: {veh.driver ?? "—"}</div>
                  </div>
                  <div className={"text-right text-sm font-bold " + (over ? "text-destructive" : "")}>{seats}/{veh.capacity} seats</div>
                </div>
                <select className={selectCls + " mt-2 w-full text-xs"} value={veh.status ?? "available"} onChange={async (e) => { await updateRow("vehicles", veh.id, { status: e.target.value }); refresh(); }}>
                  {VSTATUS.map((s) => <option key={s}>{s}</option>)}
                </select>
                <div className="mt-2 space-y-2">
                  {ts.map((t) => (
                    <div key={t.id} className="rounded border p-2 text-sm space-y-1">
                      <div className="flex gap-1">
                        <select className={selectCls + " flex-1 text-xs"} value={t.feeder_id ?? ""} onChange={(e) => upd(t.id, { feeder_id: e.target.value || null, staff: t.staff?.length ? t.staff : staffForFeeder(e.target.value) })}>
                          <option value="">— feeder —</option>
                          {m.feeders.map((f) => <option key={f.feeder_id} value={f.feeder_id}>{f.feeder_name}</option>)}
                        </select>
                        <Button size="icon" variant="ghost" onClick={() => ask({ title: "Remove this feeder drop?", danger: true, body: <p>{m.feederById.get(t.feeder_id ?? "")?.feeder_name ?? "This drop"}{t.destination ? ` · ${t.destination}` : ""} will be removed from the vehicle.</p>, confirmLabel: "Yes, remove", onConfirm: async () => { await removeRow("trips", t.id); refresh(); } })}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                      <Input className="h-8 text-xs" placeholder="Destination / area" defaultValue={t.destination ?? ""} onBlur={(e) => e.target.value !== (t.destination ?? "") && upd(t.id, { destination: e.target.value })} />
                      <Input className="h-8 text-xs" placeholder="Staff (comma separated)" defaultValue={(t.staff ?? []).join(", ")} key={(t.staff ?? []).join("|")}
                        onBlur={(e) => upd(t.id, { staff: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
                    </div>
                  ))}
                  <Button size="sm" variant="outline" className="w-full" onClick={() => addTrip(veh.id)}>+ Feeder drop</Button>
                </div>
                {isAdmin && <button className="mt-2 text-xs text-destructive" onClick={async () => { if (confirm(`Delete ${veh.name}?`)) { await removeRow("vehicles", veh.id); refresh(); } }}>Delete vehicle</button>}
              </div>
            );
          })}
        </div>
      </Section>

      {isAdmin && (
        <Section title="Add vehicle">
          <form onSubmit={addVehicle} className="flex flex-wrap gap-2">
            <Input className="w-20" value={v.icon} onChange={(e) => setV({ ...v, icon: e.target.value })} />
            <Input required className="w-60" placeholder="Vehicle name (e.g. 18-Seater Bus)" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
            <Input className="w-48" placeholder="Driver name" value={v.driver} onChange={(e) => setV({ ...v, driver: e.target.value })} />
            <Input className="w-24" type="number" min={1} value={v.capacity} onChange={(e) => setV({ ...v, capacity: Number(e.target.value) })} />
            <Button type="submit">Save vehicle</Button>
          </form>
        </Section>
      )}

      <Section title="Schedule text preview">
        <pre className="whitespace-pre-wrap rounded bg-muted p-3 text-xs">{text}</pre>
      </Section>
      {dialog}
    </div>
  );
}
