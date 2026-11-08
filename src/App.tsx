import { Spinner } from "@/components/ui/spinner";
import { lazy, Suspense, useEffect } from "react";
import { AuthScreen } from "./features/AuthScreen";
import { LockScreen } from "./features/LockScreen";
import { AccountChooser } from "./features/session/AccountChooser";
import { SidebarAccountSwitcher } from "./features/session/SidebarAccountSwitcher";
import { useSessionController } from "./features/session/useSessionController";
import { WorkspaceServicesContext } from "./features/session/workspaceServices";
import { useToastNotifications } from "./features/vault/useToastNotifications";
import { useI18n } from "./i18n";
import { useDatabaseUpgrade } from "./storage/useDatabaseUpgrade";

const VaultApp = lazy(() => import("./features/vault/VaultApp").then((module) => ({ default: module.VaultApp })));

export default function App() {
  const { t } = useI18n();
  const databaseBlocked = useDatabaseUpgrade();
  const session = useSessionController();
  const { workspace, locked } = session;
  const { showMessage, clearMessages } = useToastNotifications();
  const transitionError = !databaseBlocked && !session.restoring && !session.chooser ? session.error : null;
  useEffect(() => {
    if (!transitionError) return;
    showMessage(t(transitionError === "reauth" ? "account.reauth" : "account.switchFailed"), "critical");
    return clearMessages;
  }, [transitionError, t, showMessage, clearMessages]);
  if (databaseBlocked) return <main className="loading-shell"><p role="status">{t("storage.upgradeBlocked")}</p></main>;
  if (session.restoring) return <main className="loading-shell"><Spinner className="spinner" aria-hidden="true" /><p>{t("lock.restoring")}</p></main>;

  const selection = session.chooser && <AccountChooser
    accounts={session.accounts} currentId={session.selectedId} busy={session.busy} error={session.error}
    onChoose={session.choose} onLogin={session.beginLogin} onBack={workspace || locked ? session.cancelChooser : undefined}
  />;

  return <>
    {workspace && <div hidden={session.chooser || session.login}>
      <WorkspaceServicesContext.Provider value={workspace}>
        <Suspense fallback={<main className="loading-shell"><Spinner className="spinner" aria-hidden="true" /><p>{t("app.loadingNotes")}</p></main>}>
          <VaultApp key={workspace.id} {...workspace.account} serverSessionVerified={session.online} visible={!session.chooser && !session.login}
            onCredentialChange={(credential) => session.updateAccount(credential, true)}
            onDisplayNameChange={(displayName) => session.updateAccount({ displayName })}
            onUsernameChange={(username) => session.updateAccount({ username })}
            onLock={() => void session.close("lock")} onLogout={() => session.close("logout")}
            renderAccountSwitcher={session.canSwitch && !session.chooser && !session.login ? (avatarUrl) => <SidebarAccountSwitcher
              accounts={session.accounts} current={workspace.account} currentAvatarUrl={avatarUrl} busy={session.busy}
              onOpen={session.refreshAccounts} onChoose={session.choose} onLogin={session.beginLogin}
            /> : undefined}
            registerClose={session.registerClose}
          />
        </Suspense>
      </WorkspaceServicesContext.Provider>
    </div>}
    {selection}
    {(!workspace || session.login) && !session.chooser && (locked?.credential && !session.login
      ? <LockScreen key={locked.user.id} user={locked.user}
          browserOnline={session.browserOnline} onPin={session.unlock} onPasswordLogin={session.beginLogin}
          onSwitch={session.canSwitch ? session.showChooser : undefined}
          onLogout={() => session.close("logout")} />
      : <AuthScreen onUnlocked={session.handleUnlocked} getWorker={session.getAuthWorker}
          runAuthentication={session.runAuthentication} initialUsername={locked?.user.username} initialRememberDevice={locked?.endpoint.remembered}
          onBack={session.canSwitch && (workspace || locked || session.accounts.length) ? session.cancelLogin : undefined}
          backDestination={workspace ? "app" : "accounts"}
          offlineUnavailable={!session.browserOnline} />)}
  </>;
}
