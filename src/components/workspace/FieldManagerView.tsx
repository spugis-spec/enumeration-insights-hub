import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "./WorkspaceProvider";
import { cell, DataTable, ExportButton, inputClass, Metrics, SpreadsheetUpload, tdClass, WorkspacePage } from "./common";
import { exportCsv } from "@/lib/workspace-model";

export function FieldManagerView() {
  const { assets, setAssets } = useWorkspace();
  const [feeder, setFeeder] = useState("");
  const [transformer, setTransformer] = useState("");
  const [staff, setStaff] = useState("");
  const [search, setSearch] = useState("");
  const filtered = assets.filter(a => `${a.feeder} ${a.transformer} ${a.staff}`.toLowerCase().includes(search.toLowerCase()));
  return <WorkspacePage title="Field Manager" actions={<><SpreadsheetUpload onRows={rows => setAssets(a => [...a, ...rows.map(r => ({ id: crypto.randomUUID(), feeder: cell(r, "feeder", "feedername"), transformer: cell(r, "transformer", "dt", "dtname", "dss"), staff: cell(r, "staff", "enumerator", "username"), status: "Pending" })).filter(r => r.transformer)])} /><ExportButton disabled={!assets.length} onClick={() => exportCsv("field-manager.csv", [["Feeder", "Transformer", "Staff", "Status"], ...assets.map(a => [a.feeder, a.transformer, a.staff, a.status])])} /></>}>
    <Metrics values={[["Transformers", assets.length], ["Allocated", assets.filter(a => a.staff).length], ["In progress", assets.filter(a => a.status === "In progress").length], ["Completed", assets.filter(a => a.status === "Completed").length]]} />
    <section className="space-y-3"><h2 className="font-semibold">Transformer allocation</h2><form className="flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); setAssets(a => [...a, { id: crypto.randomUUID(), feeder: feeder.trim(), transformer: transformer.trim(), staff: staff.trim(), status: "Pending" }]); setTransformer(""); setStaff(""); }}>
      <input aria-label="Feeder" placeholder="Feeder" required className={inputClass} value={feeder} onChange={e => setFeeder(e.target.value)} />
      <input aria-label="Transformer" placeholder="Transformer / DT ID" required className={inputClass} value={transformer} onChange={e => setTransformer(e.target.value)} />
      <input aria-label="Allocated staff" placeholder="Allocated staff" className={inputClass} value={staff} onChange={e => setStaff(e.target.value)} />
      <Button type="submit"><Plus />Add transformer</Button>
    </form></section>
    <input aria-label="Search transformers" placeholder="Search feeder, transformer or staff" className={`${inputClass} w-full sm:max-w-sm`} value={search} onChange={e => setSearch(e.target.value)} />
    <DataTable headers={["Transformer", "Feeder", "Allocated staff", "Status", ""]} empty={!filtered.length}>{filtered.map(a => <tr key={a.id}><td className={`${tdClass} font-semibold`}>{a.transformer}</td><td className={tdClass}>{a.feeder}</td><td className={tdClass}><input aria-label={`Staff for ${a.transformer}`} className={inputClass} value={a.staff} onChange={e => setAssets(rows => rows.map(r => r.id === a.id ? { ...r, staff: e.target.value } : r))} /></td><td className={tdClass}><select aria-label={`Status for ${a.transformer}`} className={inputClass} value={a.status} onChange={e => setAssets(rows => rows.map(r => r.id === a.id ? { ...r, status: e.target.value } : r))}>{["Pending", "In progress", "Completed"].map(s => <option key={s}>{s}</option>)}</select></td><td className={tdClass}><Button variant="ghost" size="icon" title="Remove transformer" aria-label={`Remove ${a.transformer}`} onClick={() => setAssets(rows => rows.filter(r => r.id !== a.id))}><Trash2 /></Button></td></tr>)}</DataTable>
  </WorkspacePage>;
}