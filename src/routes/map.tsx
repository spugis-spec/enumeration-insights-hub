import { createFileRoute } from "@tanstack/react-router";
import { ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense, useMemo, useRef, useState, useEffect } from "react";
import { ref, get } from "firebase/database";
import { getDb } from "@/lib/firebase";
import { rowsToPoints, ASSET_LABELS, type AssetType, type GisPoint } from "@/lib/gis";

const GisMap = lazy(() => import("@/components/GisMap"));

export const Route = createFileRoute("/map")({
  head: () => ({
    meta: [
      { title: "GIS Map — AEDC Enumeration" },
      { name: "description", content: "Interactive map of enumerated DSS, HT, LT and customer meter locations by feeder, enumerator and date." },
      { property: "og:title", content: "GIS Map — AEDC Enumeration" },
      { property: "og:description", content: "Plot and inspect enumerated assets and feeder coverage on an interactive map." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: MapPage,
});

const TYPES: AssetType[] = ["dss", "ht", "lt", "cust"];

function MapPage() {
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
  const worker = useRef<Worker | null>(null);

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
        <section>
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">Asset files</h2>
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

        <section>
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">Showing</h2>
          <div className="grid grid-cols-2 gap-2">
            {counts.map(({ t, n }) => (
              <div key={t} className="rounded-md bg-secondary p-2">
                <div className="text-xs text-muted-foreground">{ASSET_LABELS[t]}</div>
                <div className="font-mono text-lg font-bold">{n.toLocaleString()}</div>
              </div>
            ))}
          </div>
        </section>
      </aside>
      <div className="relative p-2">
        <ClientOnly fallback={<div className="h-full animate-pulse rounded-lg bg-muted" />}>
          <Suspense fallback={<div className="h-full animate-pulse rounded-lg bg-muted" />}>
            <GisMap points={filtered} showBoundaries={boundaries} />
          </Suspense>
        </ClientOnly>
        {!all.length && (
          <div className="pointer-events-none absolute inset-0 z-[500] grid place-items-center">
            <div className="rounded-lg bg-card/95 px-5 py-3 text-sm shadow">Upload DSS, HT, LT or Customer files with latitude/longitude columns to plot them.</div>
          </div>
        )}
      </div>
    </div>
  );
}
