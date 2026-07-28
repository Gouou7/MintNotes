import { AuthScreen } from "./features/AuthScreen";
import { LockScreen } from "./features/LockScreen";
import { useSessionController } from "./features/session/useSessionController";
import { VaultApp } from "./features/vault/VaultApp";
import { useI18n } from "./i18n";

export default function App() {
  const { t } = useI18n();
  const session = useSessionController();

  if (session.restoringDevice) {
    return <main className="loading-shell"><div className="spinner" /><p>{t("lock.restoring")}</p></main>;
  }
  if (!session.user && session.session && session.credential) {
    return <LockScreen
      user={session.session.user}
      endpoint={session.session.endpoint}
      credential={session.credential}
      onUnlocked={session.unlockStoredSession}
      onTrustExhausted={session.handleTrustExhausted}
      onLogout={session.logoutLockedSession}
    />;
  }
  if (!session.user) return <AuthScreen onUnlocked={session.handleUnlocked} />;
  return <VaultApp
    key={session.user.id}
    user={session.user}
    endpoint={session.session!.endpoint}
    credential={session.credential}
    onCredentialChange={session.setCredential}
    onDisplayNameChange={session.updateDisplayName}
    onLocked={session.handleVaultLocked}
  />;
}
