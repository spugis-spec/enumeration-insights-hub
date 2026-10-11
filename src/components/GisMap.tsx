import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { convexHull, ASSET_LABELS, type GisPoint } from "@/lib/gis";

const COLORS: Record<string, string> = {
  dss: "var(--chart-1)",
  ht: "var(--chart-2)",
  lt: "var(--chart-3)",
  cust: "var(--chart-4)",
};

function resolve(cssVar: string) {
  const name = cssVar.slice(4, -1);
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#2563eb";
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export default function GisMap({ points, showBoundaries }: { points: GisPoint[]; showBoundaries: boolean }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!el.current || map.current) return;
    map.current = L.map(el.current, { preferCanvas: true }).setView([9.0765, 7.3986], 11); // Abuja
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 19,
    }).addTo(map.current);
    layer.current = L.layerGroup().addTo(map.current);
    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    const g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    const colors = Object.fromEntries(Object.entries(COLORS).map(([k, v]) => [k, resolve(v)]));
    const renderer = L.canvas({ padding: 0.5 });

    if (showBoundaries) {
      const byFeeder = new Map<string, [number, number][]>();
      points.forEach((p) => {
        if (!p.feeder) return;
        if (!byFeeder.has(p.feeder)) byFeeder.set(p.feeder, []);
        byFeeder.get(p.feeder)!.push([p.lat, p.lng]);
      });
      const fc = resolve("var(--primary)");
      byFeeder.forEach((pts, feeder) => {
        if (pts.length < 3) return;
        L.polygon(convexHull(pts), { color: fc, weight: 1.5, fillOpacity: 0.06, dashArray: "4 4" })
          .bindTooltip(`${esc(feeder)} — ${pts.length} assets`, { sticky: true })
          .addTo(g);
      });
    }

    points.forEach((p) => {
      L.circleMarker([p.lat, p.lng], {
        renderer,
        radius: p.type === "dss" ? 6 : 4,
        color: colors[p.type],
        fillColor: colors[p.type],
        fillOpacity: 0.8,
        weight: 1,
      })
        .bindPopup(
          `<div style="font-family:inherit;min-width:180px">
            <strong>${ASSET_LABELS[p.type]}</strong><br/>
            <b>Enumerator:</b> ${esc(p.user || "—")}<br/>
            <b>Feeder:</b> ${esc(p.feeder || "—")}<br/>
            <b>Date:</b> ${esc(p.date || "—")}<br/>
            <b>FID:</b> ${esc(p.fid || "—")}<br/>
            <b>Location:</b> ${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}
          </div>`,
        )
        .addTo(g);
    });

    if (points.length) {
      const b = L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number]));
      m.fitBounds(b, { padding: [30, 30], maxZoom: 16 });
    }
  }, [points, showBoundaries]);

  return <div ref={el} className="h-full w-full rounded-lg" />;
}
