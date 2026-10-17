import { createFileRoute, Navigate } from "@tanstack/react-router";

// Field Manager no longer has its own login. Old links land on the home page,
// where the single sign-in lives in the top bar.
export const Route = createFileRoute("/field-sign-in")({
  component: () => <Navigate to="/field" replace />,
});
