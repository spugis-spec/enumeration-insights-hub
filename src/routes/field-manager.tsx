import { createFileRoute } from "@tanstack/react-router";
import { FieldManagerView } from "@/components/workspace/FieldManagerView";

export const Route = createFileRoute("/field-manager")({
  ssr: false,
  head: () => ({ meta: [
    { title: "Field Manager — AEDC Enumeration" },
    { name: "description", content: "Track distribution transformers, staff allocations and field uploads." },
    { property: "og:title", content: "Field Manager — AEDC Enumeration" },
    { property: "og:description", content: "Track distribution transformers, staff allocations and field uploads." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: FieldManagerView,
});
