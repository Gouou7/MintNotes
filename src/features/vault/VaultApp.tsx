import type { DeviceUnlockCredential } from "../../storage/database";
import type { AuthEndpoint, User } from "../../types";
import { VaultWorkspace } from "./VaultWorkspace";

export interface VaultAppProps {
  user: User;
  endpoint: AuthEndpoint;
  credential: DeviceUnlockCredential | null;
  serverSessionVerified: boolean;
  onCredentialChange: (credential: DeviceUnlockCredential | null) => void;
  onDisplayNameChange: (displayName: string) => void;
  onUsernameChange: (username: string) => void;
  onLocked: (logout: boolean) => void;
}

export function VaultApp(props: VaultAppProps) {
  return <VaultWorkspace {...props} />;
}
