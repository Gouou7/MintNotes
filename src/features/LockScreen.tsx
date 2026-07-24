import { type FormEvent, useState } from "react";
import { LockKeyhole, LogOut, X } from "lucide-react";
import { api } from "../api";
import { AppIcon } from "../components/AppIcon";
import { cryptoClient } from "../crypto/client";
import { markEndpointRevocationPending, restoreDeviceUnlock, verifyDevicePin } from "../crypto/deviceUnlock";
import { translateError, useI18n } from "../i18n";
import { submitFormOnEnter } from "./formKeyboard";
import type { DeviceUnlockCredential } from "../storage/database";
import type { AuthEndpoint, KdfParams, User } from "../types";

interface Props {
  user: User;
  endpoint: AuthEndpoint;
  credential: DeviceUnlockCredential;
  onUnlocked: (refreshCredential?: boolean) => Promise<void>;
  onTrustExhausted: () => Promise<void>;
  onLogout: () => Promise<void>;
}

export function LockScreen({ user, endpoint, credential, onUnlocked, onTrustExhausted, onLogout }: Props) {
  const { t } = useI18n();
  const [pin, setPin] = useState("");
  const [password, setPassword] = useState("");
  const [usePassword, setUsePassword] = useState(!credential.pinVerifier);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [logoutConfirming, setLogoutConfirming] = useState(false);

  const unlockWithPin = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await verifyDevicePin(user.id, endpoint.id, pin);
      if (result === "exhausted") {
        await markEndpointRevocationPending(user.id, endpoint.id);
        await onTrustExhausted();
        return;
      }
      if (result !== "ok" || !await restoreDeviceUnlock(user.id, endpoint.id)) throw new Error(t("lock.invalidPin"));
      await onUnlocked(false);
    } catch (value) {
      setError(translateError(value, t, "lock.cannotUnlock"));
    } finally {
      setBusy(false);
    }
  };

  const unlockWithPassword = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const parameters = await api<{ kdfSalt: string; kdfParams: KdfParams }>(`/api/auth/parameters/${encodeURIComponent(user.username)}`);
      const derived = await cryptoClient.prepareLogin(password, parameters.kdfSalt, parameters.kdfParams);
      const wrapped = await api<{ wrappedVaultKey: string; wrappedVaultNonce: string }>("/api/auth/reauth", {
        method: "POST",
        body: JSON.stringify({ authSecret: derived.authSecret })
      });
      await cryptoClient.unlockVault(user.username, wrapped.wrappedVaultKey, wrapped.wrappedVaultNonce);
      await onUnlocked(true);
    } catch (value) {
      setError(translateError(value, t, "lock.invalidPassword"));
    } finally {
      setBusy(false);
    }
  };

  return <main className="auth-shell">
    <section className="auth-card lock-card">
      <img className="brand-mark" src="/icon.svg" alt="Mint Notes" />
      <h1><AppIcon icon={LockKeyhole} />{t("lock.title")}</h1>
      <p className="auth-subtitle">{t("lock.subtitle")}</p>
      {!usePassword && credential.pinVerifier ? <form onSubmit={unlockWithPin}>
        <label>{t("lock.devicePin")}<input type="password" value={pin} onChange={(event) => setPin(event.target.value)} onKeyDown={submitFormOnEnter} enterKeyHint="done" autoFocus required /></label>
        {error && <p className="error">{error}</p>}
        <button type="submit" className="primary" disabled={busy}>{busy ? t("lock.unlocking") : t("lock.unlockWithPin")}</button>
        <button type="button" onClick={() => { setUsePassword(true); setError(""); }}>{t("lock.usePassword")}</button>
      </form> : <form onSubmit={unlockWithPassword}>
        <label>{t("auth.masterPassword")}<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={submitFormOnEnter} autoComplete="current-password" enterKeyHint="done" autoFocus required /></label>
        {error && <p className="error">{error}</p>}
        <button type="submit" className="primary" disabled={busy}>{busy ? t("lock.verifying") : t("lock.unlockWithPassword")}</button>
        {credential.pinVerifier && <button type="button" onClick={() => { setUsePassword(false); setError(""); }}>{t("lock.backToPin")}</button>}
      </form>}
      <button className="danger-text" onClick={() => setLogoutConfirming(true)}><AppIcon icon={LogOut} size={16} />{t("lock.logout")}</button>
    </section>
    {logoutConfirming && <div className="danger-confirm logout-confirm settings-section" role="dialog" aria-modal="true" aria-label={t("settings.logoutTitle")}><header><h3>{t("settings.logoutTitle")}</h3><button type="button" onClick={() => setLogoutConfirming(false)} aria-label={t("common.close")}><AppIcon icon={X} /></button></header><p>{t("settings.logoutWarning")}</p><div className="settings-actions"><button type="button" onClick={() => setLogoutConfirming(false)}>{t("common.cancel")}</button><button type="button" className="danger danger-solid" onClick={() => void onLogout()}><AppIcon icon={LogOut} size={15} />{t("app.logout")}</button></div></div>}
  </main>;
}
