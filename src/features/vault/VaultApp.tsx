import type { ReactNode } from "react";
import type { DeviceUnlockCredential } from "../../storage/database";
import type { AuthEndpoint, User } from "../../types";
import { VaultWorkspace } from "./VaultWorkspace";
import { useWorkspaceViewport } from "./useWorkspaceViewport";

export interface VaultAppProps {
  user: User;
  endpoint: AuthEndpoint;
  credential: DeviceUnlockCredential | null;
  serverSessionVerified: boolean;
  onCredentialChange: (credential: DeviceUnlockCredential | null) => void;
  onDisplayNameChange: (displayName: string) => void;
  onUsernameChange: (username: string) => void;
  onLock: () => void;
  onLogout: () => Promise<void>;
  renderAccountSwitcher?: (avatarUrl: string | null) => ReactNode;
  registerClose: (handler: ((discard: boolean) => Promise<boolean>) | null) => void;
}

export function VaultApp(props: VaultAppProps) {
  useWorkspaceViewport();
  return <VaultWorkspace {...props} />;
}
