import { lazy, Suspense } from "react";
import { AuthScreen } from "./features/AuthScreen";
import { LockScreen } from "./features/LockScreen";
import { useSessionController } from "./features/session/useSessionController";
import { useI18n } from "./i18n";

const VaultApp = lazy(() => import("./features/vault/VaultApp").then((module) => ({ default: module.VaultApp })));

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
      serverSessionVerified={session.serverSessionVerified}
      onUnlocked={session.unlockStoredSession}
      onTrustExhausted={session.handleTrustExhausted}
      onLogout={session.logoutLockedSession}
    />;
  }
  if (!session.user) return <AuthScreen onUnlocked={session.handleUnlocked} offlineUnavailable={session.offlineUnavailable} />;
  return <Suspense fallback={<main className="loading-shell"><div className="spinner" /><p>{t("app.loadingNotes")}</p></main>}>
    <VaultApp
      key={session.user.id}
      user={session.user}
      endpoint={session.session!.endpoint}
      credential={session.credential}
      serverSessionVerified={session.serverSessionVerified}
      onCredentialChange={session.setCredential}
      onDisplayNameChange={session.updateDisplayName}
      onUsernameChange={session.updateUsername}
      onLocked={session.handleVaultLocked}
    />
  </Suspense>;
}
