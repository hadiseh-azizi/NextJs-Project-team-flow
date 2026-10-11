"use client";

import RouteError from "@/components/RouteError";

// Catches a failing dashboard page (a database error while loading the
// overview, say) while keeping the navbar from the dashboard layout.
export default function DashboardError(props) {
  return <RouteError {...props} />;
}
