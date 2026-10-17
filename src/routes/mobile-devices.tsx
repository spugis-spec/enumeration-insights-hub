import { createFileRoute } from "@tanstack/react-router";
import { MobileDevicesView } from "@/components/workspace/MobileDevicesView";

export const Route = createFileRoute("/mobile-devices")({
  ssr: false,
  head: () => ({ meta: [
    { title: "Mobile Devices — AEDC Enumeration" },
    { name: "description", content: "Manage temporary mobile device inventory, collection and returns." },
    { property: "og:title", content: "Mobile Devices — AEDC Enumeration" },
    { property: "og:description", content: "Manage temporary mobile device inventory, collection and returns." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: MobileDevicesView,
});
