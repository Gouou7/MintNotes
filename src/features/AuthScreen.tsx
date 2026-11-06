import { type FormEvent, useEffect, useState } from "react";
import { Check, Copy, Download } from "lucide-react";
import { api } from "../api";
import { AppIcon } from "../components/AppIcon";
import { LanguageSelect } from "../components/LanguageSelect";
import type { CryptoClient, RegistrationCrypto } from "../crypto/client";
import { translateError, useI18n } from "../i18n";
import { submitFormOnEnter } from "./formKeyboard";
import { downloadRecoveryKey } from "./recoveryKey";
import type { AuthParameters, BrowserSession } from "../types";

interface Props {
  onUnlocked: (session: BrowserSession, worker: CryptoClient, authSecret?: string) => Promise<void>;
  getWorker: () => CryptoClient;
  runAuthentication: <T>(task: () => Promise<T>) => Promise<T>;
  initialUsername?: string;
  initialRememberDevice?: boolean;
  onBack?: () => void;
  offlineUnavailable?: boolean;
}

type Mode = "login" | "register" | "activate" | "recover";

interface AuthConfig {
  allowRegistration: boolean;
  bootstrapAllowed: boolean;
}

type AuthConfigState =
  | { status: "loading" }
  | { status: "ready"; value: AuthConfig }
  | { status: "error" };

export function AuthScreen({
  onUnlocked, getWorker: worker, runAuthentication: authenticate, initialUsername = "", initialRememberDevice = false, onBack, offlineUnavailable = false
}: Props) {
  const open = (session: BrowserSession, authSecret?: string) => onUnlocked(session, worker(), authSecret);
  const { languagePreference, setLanguagePreference, t } = useI18n();
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState(initialUsername);
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [activationCode, setActivationCode] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [rememberDevice, setRememberDevice] = useState(initialRememberDevice);
  const [authConfig, setAuthConfig] = useState<AuthConfigState>({ status: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(false);
  const [newRecovery, setNewRecovery] = useState<{ code: string; session: BrowserSession } | null>(null);
  const [recoveryConfirmed, setRecoveryConfirmed] = useState(false);
  const [recoveryCopyState, setRecoveryCopyState] = useState<"idle" | "copied" | "failed">("idle");

  const loadAuthConfig = async (): Promise<AuthConfig | null> => {
    setAuthConfig({ status: "loading" });
    try {
      const value = await api<AuthConfig>("/api/auth/config");
      setAuthConfig({ status: "ready", value });
      return value;
    } catch {
      setAuthConfig({ status: "error" });
      return null;
    }
  };

  useEffect(() => {
    if (!offlineUnavailable) void loadAuthConfig();
  }, [offlineUnavailable]);

  const openRegistration = async () => {
    if (authConfig.status === "loading") return;
    const config = authConfig.status === "ready" ? authConfig.value : await loadAuthConfig();
    if (!config) return;
    setError("");
    setNotice(false);
    setMode(config.bootstrapAllowed || config.allowRegistration ? "register" : "activate");
  };

  const login = async () => {
    const parameters = await api<AuthParameters>(`/api/auth/parameters/${encodeURIComponent(username.trim().toLowerCase())}`);
    const derived = await worker().prepareLogin(password, parameters.kdfSalt, parameters.kdfParams);
    const result = await api<BrowserSession & { wrappedVaultKey: string; wrappedVaultNonce: string }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, authSecret: derived.authSecret, rememberDevice })
    });
    await worker().unlockVault(parameters.envelopeBinding, result.wrappedVaultKey, result.wrappedVaultNonce);
    await open(result, derived.authSecret);
  };

  const register = async () => {
    if (password.length < 10) throw new Error(t("auth.passwordMin"));
    if (password !== confirmPassword) throw new Error(t("auth.passwordMismatch"));
    const normalizedUsername = username.trim().toLowerCase();
    const encrypted: RegistrationCrypto = await worker().createRegistration(normalizedUsername, password);
    const result = await api<BrowserSession>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        username: normalizedUsername,
        displayName,
        ...encrypted,
        envelopeVersion: encrypted.envelopeBinding.version,
        envelopeContext: encrypted.envelopeBinding.context,
        recoveryCode: undefined
      })
    });
    setNewRecovery({ code: encrypted.recoveryCode, session: result });
  };

  const activate = async () => {
    if (password.length < 10) throw new Error(t("auth.passwordMin"));
    if (password !== confirmPassword) throw new Error(t("auth.passwordMismatch"));
    const normalizedUsername = username.trim().toLowerCase();
    const encrypted = await worker().createRegistration(normalizedUsername, password);
    const result = await api<BrowserSession>("/api/auth/activate", {
      method: "POST",
      body: JSON.stringify({
        username: normalizedUsername,
        displayName: "activation",
        activationCode,
        ...encrypted,
        envelopeVersion: encrypted.envelopeBinding.version,
        envelopeContext: encrypted.envelopeBinding.context,
        recoveryCode: undefined
      })
    });
    setNewRecovery({ code: encrypted.recoveryCode, session: result });
  };

  const recover = async () => {
    if (password.length < 10) throw new Error(t("auth.newPasswordMin"));
    if (password !== confirmPassword) throw new Error(t("auth.newPasswordMismatch"));
    const normalizedUsername = username.trim().toLowerCase();
    const parameters = await api<AuthParameters>(`/api/auth/parameters/${encodeURIComponent(normalizedUsername)}`);
    const recovery = await worker().unlockRecovery(
      parameters.envelopeBinding,
      recoveryCode,
      parameters.recoveryWrappedVaultKey,
      parameters.recoveryWrappedVaultNonce
    );
    const next = await worker().rewrapPassword(parameters.envelopeBinding, password);
    await api("/api/auth/recover", {
      method: "POST",
      body: JSON.stringify({
        username: normalizedUsername,
        recoveryAuthSecret: recovery.recoveryAuthSecret,
        newAuthSecret: next.authSecret,
        newKdfSalt: next.kdfSalt,
        newKdfParams: next.kdfParams,
        newWrappedVaultKey: next.wrappedVaultKey,
        newWrappedVaultNonce: next.wrappedVaultNonce
      })
    });
    await worker().lock();
    setMode("login");
    setRecoveryCode("");
    setConfirmPassword("");
    setError(t("auth.passwordReset"));
    setNotice(true);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice(false);
    try {
      await authenticate(async () => {
        if (mode === "login") await login();
        else if (mode === "register") await register();
        else if (mode === "activate") await activate();
        else await recover();
      });
    } catch (value) {
      setError(translateError(value, t, "auth.operationFailed"));
      await worker().lock().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  const copyRecoveryKey = async () => {
    if (!newRecovery) return;
    try {
      await navigator.clipboard.writeText(newRecovery.code);
      setRecoveryCopyState("copied");
    } catch {
      setRecoveryCopyState("failed");
    }
  };

  const confirmRecovery = async () => {
    if (!newRecovery || !recoveryConfirmed || busy) return;
    setBusy(true);
    setError("");
    try { await authenticate(() => open(newRecovery.session)); }
    catch (reason) { setError(translateError(reason, t, "auth.operationFailed")); }
    finally { setBusy(false); }
  };

  if (newRecovery) {
    return (
      <main className="auth-shell">
        <section className="auth-card recovery-card">
          <div className="auth-language"><LanguageSelect value={languagePreference} onChange={setLanguagePreference} /></div>
          <img className="brand-mark" src="/icon.svg" alt="Mint Notes" />
          <h1>{t("auth.recovery.title")}</h1>
          <p>{t("auth.recovery.description")}</p>
          <textarea readOnly value={newRecovery.code} rows={3} />
          <div className="recovery-actions">
            <button onClick={() => void copyRecoveryKey()}>
              <AppIcon icon={recoveryCopyState === "copied" ? Check : Copy} size={16} />
              {recoveryCopyState === "copied" ? t("auth.recovery.copied") : t("auth.recovery.copy")}
            </button>
            <button onClick={() => downloadRecoveryKey(newRecovery.session.user.username, newRecovery.code)}>
              <AppIcon icon={Download} size={16} />
              {t("auth.recovery.download")}
            </button>
          </div>
          {recoveryCopyState === "failed" && <p className="error recovery-feedback" role="alert">{t("auth.recovery.copyFailed")}</p>}
          <label className="recovery-confirm">
            <input type="checkbox" checked={recoveryConfirmed} onChange={(event) => setRecoveryConfirmed(event.target.checked)} />
            <span>{t("auth.recovery.confirm")}</span>
          </label>
          {error && <p className="error recovery-feedback" role="alert">{error}</p>}
          <button className="primary" disabled={!recoveryConfirmed || busy} onClick={() => void confirmRecovery()}>{t("auth.recovery.saved")}</button>
          {error && <button className="auth-ghost" type="button" disabled={busy} onClick={() => {
            setNewRecovery(null);
            setMode("login");
            setError("");
          }}>{t("auth.backToLogin")}</button>}
        </section>
      </main>
    );
  }

  const config = authConfig.status === "ready" ? authConfig.value : null;
  const publicRegistrationClosed = Boolean(config && !config.bootstrapAllowed && !config.allowRegistration);
  return (
    <main className="auth-shell">
      <section className="auth-card">
        {onBack && <button className="auth-ghost" type="button" disabled={busy} onClick={onBack}>{t("account.back")}</button>}
        <div className="auth-language"><LanguageSelect value={languagePreference} onChange={setLanguagePreference} /></div>
        <img className="brand-mark" src="/icon.svg" alt="Mint Notes" />
        <h1>{mode === "login" ? "Mint Notes" : mode === "register" ? t("auth.register.title") : mode === "activate" ? t("auth.activate.title") : t("auth.recover.title")}</h1>
        {mode === "register" && config?.bootstrapAllowed && <p className="auth-guidance">{t("auth.bootstrap.guidance")}</p>}
        {mode === "activate" && publicRegistrationClosed && <p className="auth-guidance warning">{t("auth.registration.closed")}</p>}
          {mode === "recover" && (
            <p className="auth-guidance">{t("auth.recover.guidance")}</p>
          )}
        <form onSubmit={submit}>
          <label>{t("auth.username")}<input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required /></label>
          {mode === "register" && <label>{t("auth.displayName")}<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} required /></label>}
          {mode === "activate" && <label>{t("auth.activationCode")}<textarea value={activationCode} onChange={(event) => setActivationCode(event.target.value)} rows={2} required /></label>}
          {mode === "recover" && <label>{t("auth.recoveryKey")}<textarea value={recoveryCode} onChange={(event) => setRecoveryCode(event.target.value)} rows={3} required /></label>}
          <label>{mode === "recover" ? t("auth.newMasterPassword") : t("auth.masterPassword")}<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={submitFormOnEnter} autoComplete={mode === "login" ? "current-password" : "new-password"} enterKeyHint={mode === "login" ? "done" : "next"} required /></label>
          {mode === "login" && <label className="remember-device"><input type="checkbox" checked={rememberDevice} onChange={(event) => setRememberDevice(event.target.checked)} />{t("auth.rememberDevice")}</label>}
          {mode !== "login" && <label>{t("auth.confirmPassword")}<input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} onKeyDown={submitFormOnEnter} autoComplete="new-password" enterKeyHint="done" required /></label>}
          {error && <p className={notice ? "notice" : "error"}>{error}</p>}
          <button type="submit" className="primary" disabled={busy}>{busy ? t("auth.processingKeys") : mode === "login" ? t("auth.login") : mode === "register" ? t("auth.createAccount") : mode === "activate" ? t("auth.activateCreate") : t("auth.resetPassword")}</button>
        </form>
        {mode === "login" && offlineUnavailable && <p className="auth-config-error">{t("auth.offlineUnavailable")}</p>}
        {mode === "login" && !offlineUnavailable && authConfig.status === "error" && <p className="auth-config-error">{t("auth.configError")}</p>}
        <div className="auth-actions">
          {mode !== "login" && <button onClick={() => setMode("login")}>{t("auth.backToLogin")}</button>}
          {mode === "login" && <button disabled={authConfig.status === "loading"} onClick={() => void openRegistration()}>{t("auth.register")}</button>}
          {mode === "login" && <button onClick={() => setMode("recover")}>{t("auth.forgotPassword")}</button>}
          {mode === "register" && Boolean(config?.allowRegistration && !config.bootstrapAllowed) && <button onClick={() => setMode("activate")}>{t("auth.activate.title")}</button>}
          {mode === "activate" && Boolean(config?.allowRegistration && !config.bootstrapAllowed) && <button onClick={() => setMode("register")}>{t("auth.normalRegistration")}</button>}
        </div>
      </section>
    </main>
  );
}
