import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/devices")({
  head: () => ({
    meta: [
      { title: "Mobile Devices — AEDC Enumeration" },
      { name: "description", content: "Mobile device collection and tracking portal." },
      { property: "og:title", content: "Mobile Devices — AEDC Enumeration" },
      { property: "og:description", content: "Sign mobile devices out and in, track what is outstanding." },
    ],
  }),
  component: Devices,
});

// The original Mobile Device Collection & Tracking Portal, unchanged, served from
// /device-portal/index.html (same file field staff open directly on their phones).
function Devices() {
  return (
    <iframe
      src="/device-portal/index.html"
      title="Mobile Device Collection & Tracking Portal"
      className="block h-[calc(100vh-3.5rem)] w-full border-0"
    />
  );
}
