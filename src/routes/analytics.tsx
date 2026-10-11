import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ref, get } from "firebase/database";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid, LineChart, Line, AreaChart, Area,
} from "recharts";
import { getDb } from "@/lib/firebase";

export const Route = createFileRoute("/analytics")({
  head: () => ({
    meta: [
      { title: "Performance Analytics — AEDC Enumeration" },
      { name: "description", content: "Team comparison, daily velocity, feeder completion and zero-entry monitoring from saved enumeration reports." },
      { property: "og:title", content: "Performance Analytics — AEDC Enumeration" },
      { property: "og:description", content: "Interactive charts built from saved daily GIS enumeration reports." },
    ],
  }),
  component: AnalyticsPage,
});

type Row = { username: string; fullname: string; total: number; dss: number; ht: number; lt: number; cust: number; status?: string; savedFeeder?: string };
type Group = { results?: Row[]; totals?: { total: number; dss: number; ht: number; lt: number; cust: number; issues: number } };
type Dash = { aedc?: Group; bss?: Group; nysc?: Group; dateKey?: string };
const GROUPS = ["aedc", "bss", "nysc"] as const;

function AnalyticsPage() {
  const [dash, setDash] = useState<Record<string, Dash> | null>(null);
  const [status, setStatus] = useState<Record<string, string>>({});
  const [err, setErr] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  useEffect(() => {
    const db = getDb();
    get(ref(db, "dashboards")).then((s) => setDash(s.val() || {})).catch((e) => setErr(e.message));
    get(ref(db, "feederCompletionStatus"))
      .then((s) => {
        const out: Record<string, string> = {};
        Object.values((s.val() || {}) as Record<string, { feeder?: string; status?: string }>).forEach((e) => {
          if (e?.feeder && e?.status) out[e.feeder] = e.status;
        });
        setStatus(out);
      })
      .catch(() => {});
  }, []);

  const dates = useMemo(
    () => Object.keys(dash || {}).sort().filter((d) => (!from || d >= from) && (!to || d <= to)),
    [dash, from, to],
  );

  const daily = useMemo(
    () =>
      dates.map((d) => {
        const r = (dash![d] ?? ({} as Dash));
        const row: Record<string, number | string> = { date: d.slice(5) };
        let total = 0, zero = 0, dss = 0, ht = 0, lt = 0, cust = 0;
        GROUPS.forEach((g) => {
          const t = r[g]?.totals?.total || 0;
          row[g.toUpperCase()] = t;
          total += t;
          const res = r[g]?.results || [];
          const z = res.filter((x) => (x.total || 0) === 0 && x.status !== "excused").length;
          row[`zero_${g}`] = z;
          zero += z;
          dss += r[g]?.totals?.dss || 0; ht += r[g]?.totals?.ht || 0; lt += r[g]?.totals?.lt || 0; cust += r[g]?.totals?.cust || 0;
        });
        return { ...row, total, zero, DSS: dss, HT: ht, LT: lt, Customers: cust };
      }),
    [dates, dash],
  );

  const teams = useMemo(
    () =>
      GROUPS.map((g) => {
        let total = 0, people = new Set<string>();
        dates.forEach((d) => {
          total += (dash![d] ?? ({} as Dash))[g]?.totals?.total || 0;
          ((dash![d] ?? ({} as Dash))[g]?.results || []).forEach((r) => people.add(r.username));
        });
        return { team: g.toUpperCase(), total, avgPerEnumerator: people.size ? Math.round(total / people.size) : 0 };
      }),
    [dates, dash],
  );

  const feeders = useMemo(() => {
    const m = new Map<string, number>();
    dates.forEach((d) =>
      GROUPS.forEach((g) =>
        ((dash![d] ?? ({} as Dash))[g]?.results || []).forEach((r) => {
          if (r.savedFeeder) m.set(r.savedFeeder, (m.get(r.savedFeeder) || 0) + (r.total || 0));
        }),
      ),
    );
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([feeder, entries]) => ({ feeder, entries, status: status[feeder] || "In progress" }));
  }, [dates, dash, status]);

  const grand = daily.reduce((s, d) => s + (d.total as number), 0);
  const avg = daily.length ? Math.round(grand / daily.length) : 0;
  const zeroTotal = daily.reduce((s, d) => s + (d.zero as number), 0);

  if (err) return <div className="p-8 text-destructive">Could not load saved reports: {err}</div>;
  if (!dash) return <div className="grid gap-4 p-6 md:grid-cols-2">{[0, 1, 2, 3].map((i) => <div key={i} className="h-72 animate-pulse rounded-xl bg-muted" />)}</div>;

  const card = "rounded-xl border bg-card p-4 shadow-sm";
  const tick = { fontSize: 11, fill: "var(--muted-foreground)" };

  return (
    <div className="mx-auto max-w-[1600px] space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-2xl font-bold">Performance analytics</h1>
          <p className="text-sm text-muted-foreground">From {Object.keys(dash).length} saved daily reports</p>
        </div>
        <div className="ml-auto flex gap-2">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-md border bg-background px-2 py-1.5 text-sm" />
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-md border bg-background px-2 py-1.5 text-sm" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[["Total entries", grand], ["Days reported", daily.length], ["Avg per day", avg], ["Zero-entry cases", zeroTotal]].map(([l, v]) => (
          <div key={l as string} className={card}>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">{l}</div>
            <div className="font-mono text-2xl font-bold">{(v as number).toLocaleString()}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className={card}>
          <h2 className="mb-3 font-semibold">Team comparison</h2>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={teams}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="team" tick={tick} /><YAxis tick={tick} /><Tooltip /><Legend />
              <Bar dataKey="total" name="Total entries" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="avgPerEnumerator" name="Avg per enumerator" fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className={card}>
          <h2 className="mb-3 font-semibold">Daily velocity</h2>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={daily}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tick={tick} /><YAxis tick={tick} /><Tooltip /><Legend />
              <Line dataKey="AEDC" stroke="var(--chart-1)" dot={false} strokeWidth={2} />
              <Line dataKey="BSS" stroke="var(--chart-2)" dot={false} strokeWidth={2} />
              <Line dataKey="NYSC" stroke="var(--chart-3)" dot={false} strokeWidth={2} />
              <Line dataKey="total" name="All teams" stroke="var(--primary)" dot={false} strokeWidth={2.5} strokeDasharray="5 3" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className={card}>
          <h2 className="mb-3 font-semibold">Feeder target completion (top 15)</h2>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={feeders} layout="vertical" margin={{ left: 40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis type="number" tick={tick} /><YAxis type="category" dataKey="feeder" tick={tick} width={110} />
              <Tooltip formatter={(v, _n, p) => [`${v} entries — ${(p.payload as { status: string }).status}`, "Feeder"]} />
              <Bar dataKey="entries" fill="var(--chart-4)" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className={card}>
          <h2 className="mb-3 font-semibold">Zero-entry monitoring</h2>
          <ResponsiveContainer width="100%" height={320}>
            <AreaChart data={daily}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tick={tick} /><YAxis tick={tick} allowDecimals={false} /><Tooltip /><Legend />
              <Area dataKey="zero_aedc" name="AEDC" stackId="z" stroke="var(--chart-1)" fill="var(--chart-1)" fillOpacity={0.5} />
              <Area dataKey="zero_bss" name="BSS" stackId="z" stroke="var(--chart-2)" fill="var(--chart-2)" fillOpacity={0.5} />
              <Area dataKey="zero_nysc" name="NYSC" stackId="z" stroke="var(--chart-3)" fill="var(--chart-3)" fillOpacity={0.5} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className={`${card} lg:col-span-2`}>
          <h2 className="mb-3 font-semibold">Asset distribution per day</h2>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={daily}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tick={tick} /><YAxis tick={tick} /><Tooltip /><Legend />
              <Bar dataKey="DSS" stackId="a" fill="var(--chart-1)" />
              <Bar dataKey="HT" stackId="a" fill="var(--chart-2)" />
              <Bar dataKey="LT" stackId="a" fill="var(--chart-3)" />
              <Bar dataKey="Customers" stackId="a" fill="var(--chart-4)" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
