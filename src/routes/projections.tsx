import { createFileRoute } from "@tanstack/react-router";
import { ProjectionsView } from "@/components/workspace/ProjectionsView";

export const Route = createFileRoute("/projections")({
  ssr: false,
  head: () => ({ meta: [
    { title: "Projections & Targets — AEDC Enumeration" },
    { name: "description", content: "Plan customer captures, daily targets and feeder completion estimates." },
    { property: "og:title", content: "Projections & Targets — AEDC Enumeration" },
    { property: "og:description", content: "Plan customer captures, daily targets and feeder completion estimates." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: ProjectionsView,
});
