import { createFileRoute } from "@tanstack/react-router";
import { ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense, useMemo, useRef, useState, useEffect } from "react";
import { ref, get } from "firebase/database";
import { getDb } from "@/lib/firebase";
import { listSpoolDates, loadSpool } from "@/lib/gisSpool";
import { SHARED_KEYS } from "@/lib/shared";
import { rowsToPoints, ASSET_LABELS, type AssetType, type GisPoint } from "@/lib/gis";
import { loadDtNames, type DtNames } from "@/lib/dtNames";
import { listAll } from "@/lib/field/db";
import type { DT, Feeder } from "@/lib/field/data";
import { buildKml, coordsFromRows, dtKey, loadDtCoords, loadLookupCoords, saveDtCoords, type DtCoordMap, type DtMapMarker, type UnassignedRow } from "@/lib/dtCoords";
import * as XLSX from "xlsx";

const GisMap = lazy(() => import("@/components/GisMap"));

export const Route = createFileRoute("/map")({
  validateSearch: (s: Record<string, unknown>): { view?: string; feeder?: string } => ({
    ...(typeof s["view"] === "string" ? { view: s["view"] } : {}),
    ...(typeof s["feeder"] === "string" ? { feeder: s["feeder"] } : {}),
  }),
  head: () => ({
    meta: [
      { title: "GIS Map — AEDC Enumeration" },
      { name: "description", content: "Interactive map of enumerated DSS, HT, LT and customer meter locations by feeder, enumerator and date." },
      { property: "og:title", content: "GIS Map — AEDC Enumeration" },
      { property: "og:description", content: "Plot and inspect enumerated assets and feeder coverage on an interactive map." },
    ],
  }),
  component: MapPage,
});

const TYPES: AssetType[] = ["dss", "ht", "lt", "cust"];

function MapPage() {
  const search = Route.useSearch();
  // The map shows either the enumeration data or the unassigned DTs — never both at once.
  const [view, setView] = useState<"data" | "unassigned">(search.view === "unassigned" ? "unassigned" : "data");
  const [points, setPoints] = useState<Record<AssetType, GisPoint[]>>({ dss: [], ht: [], lt: [], cust: [] });
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [msg, setMsg] = useState("");
  const [feeder, setFeeder] = useState("");
  const [user, setUser] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [visible, setVisible] = useState<Record<AssetType, boolean>>({ dss: true, ht: true, lt: true, cust: true });
  const [boundaries, setBoundaries] = useState(true);
  const [names, setNames] = useState<Record<string, string>>({});
  const [dtNames, setDtNames] = useState<DtNames>({});
  useEffect(() => { void loadDtNames().then(setDtNames); }, []);
  // Unassigned DTs (Field Manager) + their coordinates: from the DT Lookup (main source)
  // merged over any extra coordinates file uploaded on this page (kept on this device).
  const [deviceCoords, setDeviceCoords] = useState<DtCoordMap>(new Map());
  const [lookupCoords, setLookupCoords] = useState<DtCoordMap>(new Map());
  const [unassigned, setUnassigned] = useState<UnassignedRow[]>([]);
  const [uaFeeder, setUaFeeder] = useState(search.feeder ?? ""); // feeder NAME; "" = all feeders
  const [feederNames, setFeederNames] = useState<string[]>([]);
  const [dtMsg, setDtMsg] = useState("");
  const [coordBusy, setCoordBusy] = useState(false);
  const [dtsBusy, setDtsBusy] = useState(false);

  /** One check: re-read the coordinates (device file + DT Lookup) and rebuild the unassigned list from the Field Manager. */
  const checkUnassigned = async () => {
    setDtsBusy(true);
    try {
      const [dev, look] = await Promise.all([loadDtCoords(), loadLookupCoords()]);
      setDeviceCoords(dev);
      setLookupCoords(look);
      const merged = new Map(dev);
      look.forEach((v, k) => merged.set(k, v)); // the DT Lookup wins
      const [dts, feeders] = await Promise.all([listAll<DT>("dts"), listAll<Feeder>("feeders")]);
      const fname = new Map(feeders.map((f) => [f.feeder_id, f.feeder_name]));
      const rows = dts
        .filter((d) => d.status === "unassigned")
        .map((d) => {
          const c = merged.get(dtKey(d.dt_id));
          return { dt_id: d.dt_id, dt_name: d.dt_name ?? "", feeder_id: d.feeder_id, feeder_name: fname.get(d.feeder_id) ?? "", lat: c?.lat ?? null, lng: c?.lng ?? null };
        })
        .sort((a, b) => (a.dt_name || a.dt_id).localeCompare(b.dt_name || b.dt_id));
      setUnassigned(rows);
      setFeederNames([...new Set([...feeders.map((f) => f.feeder_name), ...rows.map((r) => r.feeder_name)].filter(Boolean))].sort());
    } catch (e: any) {
      setDtMsg("Could not load the Field Manager DTs: " + (e?.message ?? e));
    } finally { setDtsBusy(false); }
  };
  useEffect(() => { void checkUnassigned(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const uploadCoords = async (file: File) => {
    if (!worker.current) worker.current = new Worker(new URL("../lib/parse.worker.ts", import.meta.url), { type: "module" });
    setCoordBusy(true);
    const buffer = await file.arrayBuffer();
    const id = `coords-${Date.now()}`;
    const w = worker.current;
    const onMsg = (e: MessageEvent) => {
      if (e.data.id !== id) return;
      w.removeEventListener("message", onMsg);
      setCoordBusy(false);
      if (e.data.error) return setDtMsg(`Could not read ${file.name}`);
      const { coords, skipped } = coordsFromRows(e.data.rows as Record<string, unknown>[]);
      if (!coords.size) return setDtMsg(`${file.name}: no rows with both a DT ID and coordinates were found. The file needs a DT ID column (or a dss_* column) plus latitude/longitude (or X/Y) columns.`);
      const merged = new Map(deviceCoords);
      coords.forEach((v, k) => merged.set(k, v));
      setDeviceCoords(merged);
      void saveDtCoords(merged).catch(() => {}).then(() => checkUnassigned());
      setDtMsg(`Saved ${coords.size.toLocaleString()} extra DT coordinates from ${file.name}${skipped ? ` (${skipped.toLocaleString()} rows skipped — no DT ID or no coordinates)` : ""}. They stay on this device; the DT Lookup remains the main source.`);
    };
    w.addEventListener("message", onMsg);
    w.postMessage({ id, buffer }, [buffer]);
  };

  const uaScoped = useMemo(() => (uaFeeder ? unassigned.filter((r) => r.feeder_name === uaFeeder) : unassigned), [unassigned, uaFeeder]);
  const dtMarkers = useMemo<DtMapMarker[]>(
    () =>
      view === "unassigned"
        ? uaScoped
            .filter((r) => r.lat != null && r.lng != null)
            .map((r) => ({ lat: r.lat!, lng: r.lng!, dtId: r.dt_id, dtName: r.dt_name, feederName: r.feeder_name }))
        : [],
    [uaScoped, view],
  );
  const unassignedWithCoords = uaScoped.filter((r) => r.lat != null).length;

  const exportUnassignedExcel = () => {
    const rows = uaScoped.map((r, i) => ({
      "S/N": i + 1, "DT ID": r.dt_id, "DT Name": r.dt_name, "Feeder": r.feeder_name || r.feeder_id,
      "Status": "Unassigned", "Latitude": r.lat ?? "", "Longitude": r.lng ?? "",
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Unassigned DTs");
    XLSX.writeFile(wb, "Unassigned_DTs.xlsx");
    setDtMsg(`Excel exported: ${rows.length.toLocaleString()} unassigned DTs${uaFeeder ? ` on ${uaFeeder}` : ""} (${unassignedWithCoords.toLocaleString()} with coordinates).`);
  };
  const exportUnassignedKml = () => {
    if (!unassignedWithCoords) return setDtMsg("No unassigned DT has coordinates yet — add latitude/longitude columns to your DT Lookup file (or upload an extra coordinates file), then export the KML.");
    const blob = new Blob([buildKml(uaScoped)], { type: "application/vnd.google-earth.kml+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "Unassigned_DTs.kml";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setDtMsg(`KML exported: ${unassignedWithCoords.toLocaleString()} unassigned DTs with coordinates.`);
  };
  const worker = useRef<Worker | null>(null);
  const [spoolDates, setSpoolDates] = useState<{ date: string; count: number; where: string }[]>([]);
  const [spoolDate, setSpoolDate] = useState("");
  const [spooling, setSpooling] = useState(false);

  const spool = async (date: string) => {
    if (!date) return;
    setSpooling(true);
    const pts = await loadSpool(date);
    setSpooling(false);
    if (!pts) return setMsg(`No saved map points for ${date}. Generate (and save) that dashboard first.`);
    setPoints(pts);
    const n = pts.dss.length + pts.ht.length + pts.lt.length + pts.cust.length;
    setMsg(`Spooled ${n.toLocaleString()} points from the ${date} dashboard`);
  };

  useEffect(() => {
    listSpoolDates().then((d) => {
      setSpoolDates(d);
      const current = window.localStorage.getItem(SHARED_KEYS.currentDashboardDate) || "";
      const pick = d.find((x) => x.date === current)?.date ?? d[0]?.date ?? "";
      setSpoolDate(pick);
      if (pick) void spool(pick);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Username → full name from the shared roster mappings.
    get(ref(getDb(), "mappings"))
      .then((s) => {
        const v = s.val() || {};
        const out: Record<string, string> = {};
        ["aedc", "bss", "nysc"].forEach((g) => {
          const m = v[g];
          if (Array.isArray(m)) m.forEach((e: { username?: string; fullname?: string } | [string, string]) => {
            if (Array.isArray(e)) out[e[0]] = e[1];
            else if (e?.username) out[e.username] = e.fullname || e.username;
          });
          else if (m && typeof m === "object") Object.entries(m).forEach(([k, val]) => (out[k] = String(val)));
        });
        setNames(out);
      })
      .catch(() => {});
    return () => worker.current?.terminate();
  }, []);

  const upload = async (type: AssetType, file: File) => {
    if (!worker.current) worker.current = new Worker(new URL("../lib/parse.worker.ts", import.meta.url), { type: "module" });
    setBusy((b) => ({ ...b, [type]: true }));
    const buffer = await file.arrayBuffer();
    const id = `${type}-${Date.now()}`;
    const w = worker.current;
    const onMsg = (e: MessageEvent) => {
      if (e.data.id !== id) return;
      w.removeEventListener("message", onMsg);
      setBusy((b) => ({ ...b, [type]: false }));
      if (e.data.error) return setMsg(`Could not read ${file.name}`);
      const pts = rowsToPoints(e.data.rows, type);
      setPoints((p) => ({ ...p, [type]: pts }));
      setMsg(pts.length ? `${ASSET_LABELS[type]}: ${pts.length.toLocaleString()} located points loaded` : `${file.name} has no latitude/longitude columns`);
    };
    w.addEventListener("message", onMsg);
    w.postMessage({ id, buffer }, [buffer]);
  };

  const all = useMemo(() => TYPES.flatMap((t) => points[t]), [points]);
  const feeders = useMemo(() => [...new Set(all.map((p) => p.feeder).filter(Boolean))].sort(), [all]);
  const users = useMemo(() => [...new Set(all.map((p) => p.user).filter(Boolean))].sort(), [all]);

  const filtered = useMemo(
    () =>
      all.filter(
        (p) =>
          visible[p.type] &&
          (!feeder || p.feeder === feeder) &&
          (!user || p.user === user) &&
          (!from || (p.date && p.date >= from)) &&
          (!to || (p.date && p.date <= to)),
      ),
    [all, visible, feeder, user, from, to],
  );

  const counts = TYPES.map((t) => ({ t, n: filtered.filter((p) => p.type === t).length }));
  const sel = "w-full rounded-md border bg-background px-2 py-1.5 text-sm";

  return (
    <div className="grid h-[calc(100vh-3.5rem)] grid-cols-1 lg:grid-cols-[320px_1fr]">
      <aside className="space-y-5 overflow-y-auto border-r bg-card p-4">
        <section className="space-y-2">
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Map view</h2>
          <div className="inline-flex w-full overflow-hidden rounded-md border text-sm font-bold" role="group" aria-label="Map view">
            {([["data", "Enumeration data"], ["unassigned", "Unassigned DTs"]] as const).map(([v, label]) => (
              <button key={v} type="button" onClick={() => setView(v)} className={"min-h-10 flex-1 px-3 " + (view === v ? "bg-foreground text-background" : "hover:bg-muted")}>{label}</button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">The map shows one view at a time — enumeration points and unassigned DTs are never mixed.</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">From dashboard</h2>
          <div className="flex gap-2">
            <select className={sel} value={spoolDate} onChange={(e) => { setSpoolDate(e.target.value); void spool(e.target.value); }}>
              {!spoolDates.length && <option value="">No dashboard points yet</option>}
              {spoolDates.map((d) => (
                <option key={d.date} value={d.date}>{d.date.replace("_to_", " → ")}{d.count ? ` · ${d.count.toLocaleString()} pts` : ""}{d.where === "device" ? " (this device)" : ""}</option>
              ))}
            </select>
            <button className="rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-60" disabled={!spoolDate || spooling} onClick={() => spool(spoolDate)}>{spooling ? "…" : "Load"}</button>
          </div>
          <p className="text-xs text-muted-foreground">Points are saved automatically when a dashboard is generated, and shared with everyone once it's saved to the cloud.</p>
        </section>

        <section>
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">Or upload asset files</h2>
          <div className="space-y-2">
            {TYPES.map((t) => (
              <label key={t} className="flex cursor-pointer items-center justify-between rounded-md border border-dashed px-3 py-2 text-sm hover:bg-accent">
                <span className="font-medium">{ASSET_LABELS[t]}</span>
                <span className="font-mono text-xs text-muted-foreground">{busy[t] ? "parsing…" : points[t].length ? points[t].length.toLocaleString() : "upload"}</span>
                <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => e.target.files?.[0] && upload(t, e.target.files[0])} />
              </label>
            ))}
          </div>
          {msg && <p className="mt-2 text-xs text-muted-foreground">{msg}</p>}
        </section>

        <section className="space-y-2">
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Filters</h2>
          <select className={sel} value={feeder} onChange={(e) => setFeeder(e.target.value)}>
            <option value="">All feeders</option>
            {feeders.map((f) => <option key={f}>{f}</option>)}
          </select>
          <select className={sel} value={user} onChange={(e) => setUser(e.target.value)}>
            <option value="">All enumerators</option>
            {users.map((u) => <option key={u} value={u}>{names[u] ? `${names[u]} (${u})` : u}</option>)}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <input type="date" className={sel} value={from} onChange={(e) => setFrom(e.target.value)} />
            <input type="date" className={sel} value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-1 pt-1">
            {TYPES.map((t) => (
              <label key={t} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={visible[t]} onChange={(e) => setVisible((v) => ({ ...v, [t]: e.target.checked }))} />
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: `var(--chart-${TYPES.indexOf(t) + 1})` }} />
                {ASSET_LABELS[t]}
              </label>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={boundaries} onChange={(e) => setBoundaries(e.target.checked)} /> Show feeder boundaries
          </label>
          <button className="text-xs text-primary underline" onClick={() => { setFeeder(""); setUser(""); setFrom(""); setTo(""); }}>Reset filters</button>
        </section>

        <section className="space-y-2">
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Unassigned DTs</h2>
          <select className={sel} value={uaFeeder} onChange={(e) => setUaFeeder(e.target.value)} aria-label="Feeder for unassigned DTs">
            <option value="">All feeders</option>
            {uaFeeder && !feederNames.includes(uaFeeder) && <option value={uaFeeder}>{uaFeeder}</option>}
            {feederNames.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
          <button className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60" disabled={dtsBusy} onClick={() => void checkUnassigned()}>
            {dtsBusy ? "Checking…" : "🔍 Check Field Manager for unassigned DTs"}
          </button>
          <p className="text-xs text-muted-foreground">
            {dtsBusy ? "Loading DTs…" : <><b>{uaScoped.length.toLocaleString()}</b> unassigned{uaFeeder ? <> on <b>{uaFeeder}</b></> : ""} · <b>{unassignedWithCoords.toLocaleString()}</b> with coordinates · <b>{(uaScoped.length - unassignedWithCoords).toLocaleString()}</b> without</>}
          </p>
          <p className="text-xs text-muted-foreground">
            Coordinates come from your <b>DT Lookup</b> file (Dashboard → Upload Data Files): add latitude/longitude columns to it.
            They are <b>re-read every time the check runs</b>, so a fresh lookup upload shows up as soon as you press the check button
            {lookupCoords.size ? <> — <b>{lookupCoords.size.toLocaleString()}</b> loaded from the lookup</> : <> — none found in the lookup yet</>}.
          </p>
          <label className="flex cursor-pointer items-center justify-between rounded-md border border-dashed px-3 py-2 text-sm hover:bg-accent">
            <span className="font-medium">Extra coordinates file (optional)</span>
            <span className="font-mono text-xs text-muted-foreground">{coordBusy ? "parsing…" : deviceCoords.size ? `${deviceCoords.size.toLocaleString()} on device` : "upload"}</span>
            <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadCoords(f); e.currentTarget.value = ""; }} />
          </label>
          <div className="flex gap-2">
            <button className="flex-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-60" disabled={!uaScoped.length} onClick={exportUnassignedExcel}>Export Excel</button>
            <button className="flex-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-60" disabled={!uaScoped.length} onClick={exportUnassignedKml}>Export KML</button>
          </div>
          {dtMsg && <p className="text-xs text-muted-foreground">{dtMsg}</p>}
        </section>

        <section>
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">Showing</h2>
          <div className="grid grid-cols-2 gap-2">
            {counts.map(({ t, n }) => (
              <div key={t} className="rounded-md bg-secondary p-2">
                <div className="text-xs text-muted-foreground">{ASSET_LABELS[t]}</div>
                <div className="font-mono text-lg font-bold">{n.toLocaleString()}</div>
              </div>
            ))}
            <div className="rounded-md bg-secondary p-2">
              <div className="text-xs text-muted-foreground">Unassigned DTs</div>
              <div className="font-mono text-lg font-bold">{dtMarkers.length.toLocaleString()}</div>
            </div>
          </div>
        </section>
      </aside>
      <div className="relative p-2">
        <ClientOnly fallback={<div className="h-full animate-pulse rounded-lg bg-muted" />}>
          <Suspense fallback={<div className="h-full animate-pulse rounded-lg bg-muted" />}>
            <GisMap points={view === "data" ? filtered : []} showBoundaries={boundaries && view === "data"} dtNames={dtNames} dtMarkers={dtMarkers} />
          </Suspense>
        </ClientOnly>
        {view === "data" && !filtered.length && (
          <div className="pointer-events-none absolute inset-0 z-[500] grid place-items-center">
            <div className="rounded-lg bg-card/95 px-5 py-3 text-sm shadow">Pick a dashboard date above, or upload DSS, HT, LT or Customer files with latitude/longitude columns.</div>
          </div>
        )}
        {view === "unassigned" && !dtMarkers.length && (
          <div className="pointer-events-none absolute inset-0 z-[500] grid place-items-center">
            <div className="rounded-lg bg-card/95 px-5 py-3 text-sm shadow">No unassigned DTs with coordinates to show{uaFeeder ? <> on <b>{uaFeeder}</b></> : ""}. Press <b>🔍 Check Field Manager for unassigned DTs</b> — coordinates come from your DT Lookup file.</div>
          </div>
        )}
      </div>
    </div>
  );
}
