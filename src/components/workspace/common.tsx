import { useEffect, useRef, useState, type ReactNode } from "react";
import { Download, FileSpreadsheet, LockKeyhole, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";

export const inputClass = "h-9 min-w-0 rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export function WorkspacePage({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  const { user, ready } = useAuth();
  return <main className="mx-auto max-w-[1600px] space-y-6 p-4 md:p-6">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div><p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">AEDC · Field operations</p><h1 className="text-2xl font-bold">{title}</h1></div>
      <div className="flex flex-wrap gap-2">{actions}</div>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-2 border-y py-3 text-sm text-muted-foreground">
      <span className="flex items-center gap-2"><LockKeyhole className="size-4" />{!ready ? "Checking session…" : user ? `Signed in as ${user.email}` : "Not signed in · Admin sign in is available in the header"}</span>
      <span className="font-medium">Temporary workspace · not saved after refresh</span>
    </div>
    {children}
  </main>;
}

export function Metrics({ values }: { values: [string, string | number][] }) {
  return <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{values.map(([label, value]) => <div key={label} className="border-l-2 border-primary pl-4 py-2"><div className="text-xs text-muted-foreground">{label}</div><div className="mt-1 font-mono text-2xl font-bold">{typeof value === "number" ? value.toLocaleString() : value}</div></div>)}</div>;
}

export function DataTable({ headers, children, empty }: { headers: string[]; children: ReactNode; empty?: boolean }) {
  return <div className="overflow-x-auto rounded-md border bg-card"><table className="w-full text-left text-sm"><thead className="border-b bg-muted"><tr>{headers.map(h => <th key={h} className="whitespace-nowrap px-4 py-3 text-xs font-semibold text-muted-foreground">{h}</th>)}</tr></thead><tbody className="divide-y">{empty ? <tr><td colSpan={headers.length} className="px-4 py-14 text-center text-muted-foreground"><FileSpreadsheet className="mx-auto mb-3 size-7" />No records yet</td></tr> : children}</tbody></table></div>;
}

export function ExportButton({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  return <Button variant="outline" disabled={disabled} onClick={onClick}><Download />Export CSV</Button>;
}

export function SpreadsheetUpload({ onRows }: { onRows: (rows: Record<string, unknown>[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const worker = useRef<Worker | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => () => worker.current?.terminate(), []);
  async function read(file: File) {
    setBusy(true); setError("");
    try {
      const w = new Worker(new URL("../../lib/parse.worker.ts", import.meta.url), { type: "module" });
      worker.current = w;
      w.onerror = () => { setError("Could not read the spreadsheet"); setBusy(false); w.terminate(); };
      w.onmessage = (event: MessageEvent<{ rows?: Record<string, unknown>[]; error?: string }>) => {
        setBusy(false); w.terminate();
        if (event.data.error) setError("Could not read the spreadsheet");
        else if (event.data.rows) onRows(event.data.rows);
      };
      const buffer = await file.arrayBuffer();
      w.postMessage({ id: file.name, buffer }, [buffer]);
    } catch { setError("Could not open the file"); setBusy(false); }
  }
  return <div><Button variant="outline" disabled={busy} onClick={() => input.current?.click()}><Upload />{busy ? "Reading…" : "Import spreadsheet"}</Button><input ref={input} aria-label="Import spreadsheet" className="hidden" type="file" accept=".xlsx,.xls,.csv" onChange={e => { const file = e.target.files?.[0]; if (file) void read(file); e.target.value = ""; }} />{error && <p role="alert" className="mt-1 text-xs text-destructive">{error}</p>}</div>;
}

export function cell(row: Record<string, unknown>, ...names: string[]): string {
  const key = Object.keys(row).find(k => names.includes(k.trim().toLowerCase().replace(/[ _-]/g, "")));
  return key ? String(row[key] ?? "").trim() : "";
}

export function numberCell(row: Record<string, unknown>, ...names: string[]) {
  const n = Number(cell(row, ...names).replaceAll(",", ""));
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

export const tdClass = "px-4 py-3";