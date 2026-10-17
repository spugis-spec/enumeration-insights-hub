import { createFileRoute } from "@tanstack/react-router";
import { RequireAuth } from "@/components/RequireAuth";
import { WeeklyReportApp } from "@/components/weekly/WeeklyReportApp";

export const Route = createFileRoute("/weekly-report")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Weekly Report — AEDC Enumeration" },
      { name: "description", content: "Upload asset files, generate the weekly feeder capture report, save weeks and compare them." },
      { property: "og:title", content: "Weekly Report — AEDC Enumeration" },
      { property: "og:description", content: "Weekly feeder capture reporting and week-over-week comparison." },
    ],
  }),
  component: () => (
    <RequireAuth what="the Weekly Report">
      <WeeklyReportApp />
    </RequireAuth>
  ),
});
