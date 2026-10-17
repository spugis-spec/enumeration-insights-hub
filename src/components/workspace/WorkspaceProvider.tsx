import { createContext, useContext, useState, type ReactNode } from "react";
import type { Device, FieldAsset, Projection, WeeklyRow } from "@/lib/workspace-model";

function useWorkspaceState() {
  const [assets, setAssets] = useState<FieldAsset[]>([]);
  const [projections, setProjections] = useState<Projection[]>([]);
  const [weekly, setWeekly] = useState<WeeklyRow[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  return { assets, setAssets, projections, setProjections, weekly, setWeekly, devices, setDevices };
}

const WorkspaceContext = createContext<ReturnType<typeof useWorkspaceState> | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const state = useWorkspaceState();
  return <WorkspaceContext.Provider value={state}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const state = useContext(WorkspaceContext);
  if (!state) throw new Error("WorkspaceProvider is required");
  return state;
}