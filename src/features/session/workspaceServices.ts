import { createContext, useContext } from "react";
import type { ApiClient } from "../../api";
import type { CryptoClient } from "../../crypto/client";

export interface WorkspaceServices {
  transport: ApiClient;
  generation?: string;
  cryptoClient: CryptoClient;
}

export const WorkspaceServicesContext = createContext<WorkspaceServices | null>(null);

export function useWorkspaceServices(): WorkspaceServices {
  const services = useContext(WorkspaceServicesContext);
  if (!services) throw new Error("Workspace services are unavailable");
  return services;
}
