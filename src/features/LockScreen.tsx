import { Field, FieldLabel } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { AppDialog } from "../components/AppDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
        <Field><FieldLabel>{t("lock.devicePin")}<Input type="password" value={pin} onChange={(event) => setPin(event.target.value)} onKeyDown={submitFormOnEnter} enterKeyHint="done" autoFocus required /></FieldLabel></Field>
        {error && <Alert className="error" variant="destructive">{error}</Alert>}
        <Button type="submit" className="primary" disabled={busy}>{busy ? t("lock.unlocking") : t("lock.unlockWithPin")}</Button>
        {browserOnline && <Button type="button" disabled={busy} onClick={onPasswordLogin}>{t("lock.usePassword")}</Button>}
      </form>
      <div className="auth-ghost-actions">
        <Button className="auth-ghost" type="button" disabled={busy} onClick={() => setLogoutConfirming(true)}><AppIcon icon={LogOut} size={16} />{t("lock.logout")}</Button>
        {onSwitch && <Button className="auth-ghost" type="button" disabled={busy} onClick={onSwitch}><AppIcon icon={UserRoundCog} size={16} />{t("account.switch")}</Button>}
      </div>
    </section>
    {logoutConfirming && <AppDialog className="danger-confirm logout-confirm settings-section" title={t("settings.logoutTitle")} onClose={() => setLogoutConfirming(false)} dismissible={!busy}>
      <p>{t("settings.logoutWarning")}</p>
      <div className="settings-actions">
        <Button type="button" disabled={busy} onClick={() => setLogoutConfirming(false)}>{t("common.cancel")}</Button>
        <Button type="button" className="danger danger-solid" disabled={busy} onClick={() => void logout()}><AppIcon icon={LogOut} size={15} />{t("app.logout")}</Button>
      </div>
    </AppDialog>}
  </main>;
}
