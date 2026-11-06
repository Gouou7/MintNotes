import { type FormEvent, useState } from "react";
import { LockKeyhole, LogOut, UserRoundCog, X } from "lucide-react";
import { AppIcon } from "../components/AppIcon";
import { translateError, useI18n } from "../i18n";
import { submitFormOnEnter } from "./formKeyboard";
import type { User } from "../types";

interface Props {
  user: User;
  browserOnline: boolean;
  onPin: (pin: string) => Promise<"ok" | "invalid" | "exhausted" | undefined>;
  onPasswordLogin: () => void;
  onSwitch?: () => void;
  onLogout: () => Promise<void>;
}

export function LockScreen({ user, browserOnline, onPin, onPasswordLogin, onSwitch, onLogout }: Props) {
  const { t } = useI18n();
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [logoutConfirming, setLogoutConfirming] = useState(false);

  const unlock = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (await onPin(pin) === "invalid") setError(t("lock.invalidPin"));
    } catch (reason) {
      setError(translateError(reason, t, "lock.cannotUnlock"));
    } finally { setBusy(false); }
  };

  const logout = async () => {
    setBusy(true);
    try { await onLogout(); }
    finally { setBusy(false); }
  };

  return <main className="auth-shell">
    <section className="auth-card lock-card">
      <img className="brand-mark" src="/icon.svg" alt="Mint Notes" />
      <h1 className="lock-user-name" title={user.displayName}>{user.displayName}</h1>
      <p className="lock-status"><AppIcon icon={LockKeyhole} size={16} />{t("lock.title")}</p>
      {!browserOnline && <p className="auth-guidance warning">{t("lock.offline")}</p>}
      <form onSubmit={unlock}>
        <label>{t("lock.devicePin")}<input type="password" value={pin} onChange={(event) => setPin(event.target.value)} onKeyDown={submitFormOnEnter} enterKeyHint="done" autoFocus required /></label>
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" className="primary" disabled={busy}>{busy ? t("lock.unlocking") : t("lock.unlockWithPin")}</button>
        {browserOnline && <button type="button" disabled={busy} onClick={onPasswordLogin}>{t("lock.usePassword")}</button>}
      </form>
      <div className="auth-ghost-actions">
        <button className="auth-ghost" type="button" disabled={busy} onClick={() => setLogoutConfirming(true)}><AppIcon icon={LogOut} size={16} />{t("lock.logout")}</button>
        {onSwitch && <button className="auth-ghost" type="button" disabled={busy} onClick={onSwitch}><AppIcon icon={UserRoundCog} size={16} />{t("account.switch")}</button>}
      </div>
    </section>
    {logoutConfirming && <div className="danger-confirm logout-confirm settings-section" role="dialog" aria-modal="true" aria-label={t("settings.logoutTitle")}>
      <header><h3>{t("settings.logoutTitle")}</h3><button type="button" disabled={busy} onClick={() => setLogoutConfirming(false)} aria-label={t("common.close")}><AppIcon icon={X} size={16} /></button></header>
      <p>{t("settings.logoutWarning")}</p>
      <div className="settings-actions">
        <button type="button" disabled={busy} onClick={() => setLogoutConfirming(false)}>{t("common.cancel")}</button>
        <button type="button" className="danger danger-solid" disabled={busy} onClick={() => void logout()}><AppIcon icon={LogOut} size={15} />{t("app.logout")}</button>
      </div>
    </div>}
  </main>;
}
