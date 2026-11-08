import { Field, FieldLabel } from "@/components/ui/field";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { type FormEvent, useEffect, useState } from "react";
import { ArrowLeft, Check, Copy, Download } from "lucide-react";
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
  backDestination?: "app" | "accounts";
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
  onUnlocked, getWorker: worker, runAuthentication: authenticate, initialUsername = "", initialRememberDevice = false,
  onBack, backDestination = "app", offlineUnavailable = false
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
          <Textarea readOnly value={newRecovery.code} rows={3} />
          <div className="recovery-actions">
            <Button variant="secondary" onClick={() => void copyRecoveryKey()}>
              <AppIcon icon={recoveryCopyState === "copied" ? Check : Copy} data-icon="inline-start" />
              {recoveryCopyState === "copied" ? t("auth.recovery.copied") : t("auth.recovery.copy")}
            </Button>
            <Button variant="secondary" onClick={() => downloadRecoveryKey(newRecovery.session.user.username, newRecovery.code)}>
              <AppIcon icon={Download} data-icon="inline-start" />
              {t("auth.recovery.download")}
            </Button>
          </div>
          {recoveryCopyState === "failed" && <p className="error recovery-feedback" role="alert">{t("auth.recovery.copyFailed")}</p>}
          <label className="recovery-confirm">
            <Checkbox  checked={recoveryConfirmed} onCheckedChange={(checked) => setRecoveryConfirmed(checked)} />
            <span>{t("auth.recovery.confirm")}</span>
          </label>
          {error && <p className="error recovery-feedback" role="alert">{error}</p>}
          <Button size="lg" disabled={!recoveryConfirmed || busy} onClick={() => void confirmRecovery()}>{t("auth.recovery.saved")}</Button>
          {error && <Button variant="ghost" type="button" disabled={busy} onClick={() => {
            setNewRecovery(null);
            setMode("login");
            setError("");
          }}>{t("auth.backToLogin")}</Button>}
        </section>
      </main>
    );
  }

  const config = authConfig.status === "ready" ? authConfig.value : null;
  const publicRegistrationClosed = Boolean(config && !config.bootstrapAllowed && !config.allowRegistration);
  return (
    <main className="auth-shell auth-entry">
      {onBack && (
        <Button className="justify-self-start" variant="secondary" type="button" disabled={busy} onClick={onBack}>
          <AppIcon icon={ArrowLeft} data-icon="inline-start" />
          {t(backDestination === "app" ? "account.backToApp" : "account.back")}
        </Button>
      )}
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
          <Field><FieldLabel>{t("auth.username")}<Input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required /></FieldLabel></Field>
          {mode === "register" && <Field><FieldLabel>{t("auth.displayName")}<Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} required /></FieldLabel></Field>}
          {mode === "activate" && <Field><FieldLabel>{t("auth.activationCode")}<Input type="text" value={activationCode} onChange={(event) => setActivationCode(event.target.value)} autoCapitalize="none" spellCheck={false} required /></FieldLabel></Field>}
          {mode === "recover" && <Field><FieldLabel>{t("auth.recoveryKey")}<Textarea value={recoveryCode} onChange={(event) => setRecoveryCode(event.target.value)} rows={3} required /></FieldLabel></Field>}
          <Field><FieldLabel>{mode === "recover" ? t("auth.newMasterPassword") : t("auth.masterPassword")}<Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={submitFormOnEnter} autoComplete={mode === "login" ? "current-password" : "new-password"} enterKeyHint={mode === "login" ? "done" : "next"} required /></FieldLabel></Field>
          {mode === "login" && <label className="remember-device"><Checkbox checked={rememberDevice} onCheckedChange={setRememberDevice} /><span>{t("auth.rememberDevice")}</span></label>}
          {mode !== "login" && <Field><FieldLabel>{t("auth.confirmPassword")}<Input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} onKeyDown={submitFormOnEnter} autoComplete="new-password" enterKeyHint="done" required /></FieldLabel></Field>}
          {error && <p className={notice ? "notice" : "error"}>{error}</p>}
          <Button type="submit" size="lg" disabled={busy}>{busy ? t("auth.processingKeys") : mode === "login" ? t("auth.login") : mode === "register" ? t("auth.createAccount") : mode === "activate" ? t("auth.activateCreate") : t("auth.resetPassword")}</Button>
        </form>
        {mode === "login" && offlineUnavailable && <p className="auth-config-error">{t("auth.offlineUnavailable")}</p>}
        {mode === "login" && !offlineUnavailable && authConfig.status === "error" && <p className="auth-config-error">{t("auth.configError")}</p>}
        <div className="auth-actions">
          {mode !== "login" && <Button variant="ghost" size="sm" onClick={() => setMode("login")}>{t("auth.backToLogin")}</Button>}
          {mode === "login" && <Button variant="ghost" size="sm" disabled={authConfig.status === "loading"} onClick={() => void openRegistration()}>{t("auth.register")}</Button>}
          {mode === "login" && <Button variant="ghost" size="sm" onClick={() => setMode("recover")}>{t("auth.forgotPassword")}</Button>}
          {mode === "register" && Boolean(config?.allowRegistration && !config.bootstrapAllowed) && <Button variant="ghost" size="sm" onClick={() => setMode("activate")}>{t("auth.activate.title")}</Button>}
          {mode === "activate" && Boolean(config?.allowRegistration && !config.bootstrapAllowed) && <Button variant="ghost" size="sm" onClick={() => setMode("register")}>{t("auth.normalRegistration")}</Button>}
        </div>
      </section>
    </main>
  );
}
