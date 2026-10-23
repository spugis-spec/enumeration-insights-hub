import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { feederStats, type Model } from "@/lib/field/data";
import { Section, Stat } from "./common";

export function OverviewTab({ m, goTo }: { m: Model; goTo: (t: string) => void }) {
  const s = feederStats(m);
  const chart = m.feeders.map((f) => {
    const fs = feederStats(m, f.feeder_id);
    return { name: f.feeder_name.slice(0, 18), Assigned: fs.assigned, "Not assigned": fs.unassigned, Completed: fs.completed, Problem: fs.problematic + fs.access_denied };
  });
  const allocatedPct = s.total ? Math.round(((s.assigned + s.completed) / s.total) * 100) : 0;

  if (!m.feeders.length)
    return (
      <Section title="Welcome">
        <p className="text-muted-foreground">No feeder data yet. The admin should upload the feeder lookup file under <b>Data Uploads</b>.</p>
      </Section>
    );

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <button onClick={() => goTo("uploads")} className="rounded-md border px-3 py-1.5 text-sm font-bold hover:bg-muted">Manage / clear data &rarr;</button>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Stat label="Feeders" value={m.feeders.length} />
        <Stat label="Total DTs" value={s.total} />
        <Stat label="Assigned (Ongoing)" value={s.assigned} tone="success" sub={`${allocatedPct}% allocated or done`} />
        <Stat label="Not assigned" value={s.unassigned} tone="danger" />
        <Stat label="Completed" value={s.completed} tone="accent" />
        <Stat label="Problem / denied" value={s.problematic + s.access_denied} tone="warning" />
        <Stat label="DTs with no capture" value={s.noCapture} tone="danger" />
        <Stat label="Captures" value={m.customerSubmissions.reduce((n, x) => n + x.count, 0).toLocaleString()} />
      </div>

      {m.alerts.length > 0 && (
        <button onClick={() => goTo("alerts")} className="w-full rounded-lg border-2 border-destructive bg-destructive/10 p-4 text-left font-bold text-destructive">
          ⚠ {m.alerts.length} capture warning{m.alerts.length > 1 ? "s" : ""} found: DTs captured by someone not allocated to them. Click to review.
        </button>
      )}

      <Section title="DT status by feeder">
        <div className="h-80">
          <ResponsiveContainer>
            <BarChart data={chart}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="name" fontSize={11} />
              <YAxis allowDecimals={false} fontSize={11} />
              <Tooltip />
              <Legend />
              <Bar dataKey="Assigned" stackId="a" fill="var(--chart-1)" />
              <Bar dataKey="Completed" stackId="a" fill="var(--chart-3)" />
              <Bar dataKey="Problem" stackId="a" fill="var(--chart-4)" />
              <Bar dataKey="Not assigned" stackId="a" fill="var(--chart-2)" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Section>

      <Section title="Feeder summary">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground">
              <tr><th className="p-2">Feeder</th><th>Area</th><th>DTs</th><th>Assigned</th><th>Not assigned</th><th>Completed</th><th>Problem</th><th>No capture</th><th>Captures</th></tr>
            </thead>
            <tbody>
              {m.feeders.map((f) => {
                const fs = feederStats(m, f.feeder_id);
                return (
                  <tr key={f.feeder_id} className="border-t">
                    <td className="p-2 font-bold">{f.feeder_name}<div className="text-xs font-normal text-muted-foreground">{f.feeder_id}</div></td>
                    <td>{f.area}</td><td>{fs.total}</td>
                    <td className="font-bold text-success">{fs.assigned}</td>
                    <td className="font-bold text-destructive">{fs.unassigned}</td>
                    <td>{fs.completed}</td><td>{fs.problematic + fs.access_denied}</td><td>{fs.noCapture}</td><td>{fs.captures}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
