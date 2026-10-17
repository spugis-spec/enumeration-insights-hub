import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "AEDC GIS Enumeration Performance Dashboard" },
      { name: "description", content: "Upload GIS enumeration data, generate daily reports, track enumerators and export styled Excel reports." },
      { property: "og:title", content: "AEDC GIS Enumeration Performance Dashboard" },
      { property: "og:description", content: "Daily and monthly GIS enumeration performance reporting for AEDC." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

// The full report workflow (uploads, rosters, pairings, report generation,
// monthly tracking, Excel export) runs unchanged from the original dashboard.
function Index() {
  return (
    <iframe
      src="/legacy/index.html"
      title="AEDC GIS Enumeration Performance Report Dashboard"
      className="block h-[calc(100vh-3.5rem)] w-full border-0"
    />
  );
}
