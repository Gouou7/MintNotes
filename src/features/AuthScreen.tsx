import { type FormEvent, useEffect, useState } from "react";
import { Check, Copy, Download } from "lucide-react";
import { api } from "../api";
import { AppIcon } from "../components/AppIcon";
import { LanguageSelect } from "../components/LanguageSelect";
import { cryptoClient, type RegistrationCrypto } from "../crypto/client";
import { translateError, useI18n } from "../i18n";
import { submitFormOnEnter } from "./formKeyboard";
import { downloadRecoveryKey } from "./recoveryKey";
import type { AuthEndpoint, KdfParams, User } from "../types";

interface Props {
  onUnlocked: (user: User, endpoint: AuthEndpoint) => Promise<void>;
}

type Mode = "login" | "register" | "activate" | "recover";

interface ParametersResponse {
  kdfSalt: string;
  kdfParams: KdfParams;
  recoveryWrappedVaultKey: string;
  recoveryWrappedVaultNonce: string;
}

interface AuthConfig {
  allowRegistration: boolean;
  bootstrapAllowed: boolean;
}

type AuthConfigState =
  | { status: "loading" }
  | { status: "ready"; value: AuthConfig }
  | { status: "error" };

export function AuthScreen({ onUnlocked }: Props) {
  const { languagePreference, setLanguagePreference, t } = useI18n();
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [activationCode, setActivationCode] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [rememberDevice, setRememberDevice] = useState(false);
  const [authConfig, setAuthConfig] = useState<AuthConfigState>({ status: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(false);
  const [newRecovery, setNewRecovery] = useState<{ code: string; user: User; endpoint: AuthEndpoint } | null>(null);
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

  useEffect(() => { void loadAuthConfig(); }, []);

  const openRegistration = async () => {
    if (authConfig.status === "loading") return;
    const config = authConfig.status === "ready" ? authConfig.value : await loadAuthConfig();
    if (!config) return;
    setError("");
    setNotice(false);
    setMode(config.bootstrapAllowed || config.allowRegistration ? "register" : "activate");
  };

  const login = async () => {
    const parameters = await api<ParametersResponse>(`/api/auth/parameters/${encodeURIComponent(username.trim().toLowerCase())}`);
    const derived = await cryptoClient.prepareLogin(password, parameters.kdfSalt, parameters.kdfParams);
    const result = await api<{ user: User; endpoint: AuthEndpoint; wrappedVaultKey: string; wrappedVaultNonce: string }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, authSecret: derived.authSecret, rememberDevice })
    });
    await cryptoClient.unlockVault(username, result.wrappedVaultKey, result.wrappedVaultNonce);
    await onUnlocked(result.user, result.endpoint);
  };

  const register = async () => {
    if (password.length < 10) throw new Error(t("auth.passwordMin"));
    if (password !== confirmPassword) throw new Error(t("auth.passwordMismatch"));
    const normalizedUsername = username.trim().toLowerCase();
    const encrypted: RegistrationCrypto = await cryptoClient.createRegistration(normalizedUsername, password);
    const result = await api<{ user: User; endpoint: AuthEndpoint }>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        username: normalizedUsername,
        displayName,
        ...encrypted,
        recoveryCode: undefined
      })
    });
    setNewRecovery({ code: encrypted.recoveryCode, user: result.user, endpoint: result.endpoint });
  };

  const activate = async () => {
    if (password.length < 10) throw new Error(t("auth.passwordMin"));
    if (password !== confirmPassword) throw new Error(t("auth.passwordMismatch"));
    const normalizedUsername = username.trim().toLowerCase();
    const encrypted = await cryptoClient.createRegistration(normalizedUsername, password);
    const result = await api<{ user: User; endpoint: AuthEndpoint }>("/api/auth/activate", {
      method: "POST",
      body: JSON.stringify({
        username: normalizedUsername,
        displayName: "activation",
        activationCode,
        ...encrypted,
        recoveryCode: undefined
      })
    });
    setNewRecovery({ code: encrypted.recoveryCode, user: result.user, endpoint: result.endpoint });
  };

  const recover = async () => {
    if (password.length < 10) throw new Error(t("auth.newPasswordMin"));
    if (password !== confirmPassword) throw new Error(t("auth.newPasswordMismatch"));
    const normalizedUsername = username.trim().toLowerCase();
    const parameters = await api<ParametersResponse>(`/api/auth/parameters/${encodeURIComponent(normalizedUsername)}`);
    const recovery = await cryptoClient.unlockRecovery(
      normalizedUsername,
      recoveryCode,
      parameters.recoveryWrappedVaultKey,
      parameters.recoveryWrappedVaultNonce
    );
    const next = await cryptoClient.rewrapPassword(normalizedUsername, password);
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
    await cryptoClient.lock();
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
      if (mode === "login") await login();
      else if (mode === "register") await register();
      else if (mode === "activate") await activate();
      else await recover();
    } catch (value) {
      setError(translateError(value, t, "auth.operationFailed"));
      await cryptoClient.lock().catch(() => undefined);
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
            <button onClick={() => downloadRecoveryKey(newRecovery.user.username, newRecovery.code)}>
              <AppIcon icon={Download} size={16} />
              {t("auth.recovery.download")}
            </button>
          </div>
          {recoveryCopyState === "failed" && <p className="error recovery-feedback" role="alert">{t("auth.recovery.copyFailed")}</p>}
          <label className="recovery-confirm">
            <input type="checkbox" checked={recoveryConfirmed} onChange={(event) => setRecoveryConfirmed(event.target.checked)} />
            <span>{t("auth.recovery.confirm")}</span>
          </label>
          <button className="primary" disabled={!recoveryConfirmed} onClick={() => void onUnlocked(newRecovery.user, newRecovery.endpoint)}>{t("auth.recovery.saved")}</button>
        </section>
      </main>
    );
  }

  const config = authConfig.status === "ready" ? authConfig.value : null;
  const publicRegistrationClosed = Boolean(config && !config.bootstrapAllowed && !config.allowRegistration);
  return (
    <main className="auth-shell">
      <section className="auth-card">
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
        {mode === "login" && authConfig.status === "error" && <p className="auth-config-error">{t("auth.configError")}</p>}
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
