import { createFileRoute } from "@tanstack/react-router";
import { WeeklyReportView } from "@/components/workspace/WeeklyReportView";

export const Route = createFileRoute("/weekly-report")({
  ssr: false,
  head: () => ({ meta: [
    { title: "Weekly Report — AEDC Enumeration" },
    { name: "description", content: "Compare weekly feeder captures and export performance reports." },
    { property: "og:title", content: "Weekly Report — AEDC Enumeration" },
    { property: "og:description", content: "Compare weekly feeder captures and export performance reports." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: WeeklyReportView,
});
