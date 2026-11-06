import { ArrowLeft, LockKeyhole, UserRound, UserRoundPlus } from "lucide-react";
import { AppIcon } from "../../components/AppIcon";
import { hasDevicePin } from "../../crypto/deviceUnlock";
import { useI18n } from "../../i18n";
import type { DeviceUnlockCredential } from "../../storage/database";
import type { AuthEndpoint, User } from "../../types";

export interface AccountOption {
  user: User;
  endpoint: AuthEndpoint;
  credential: DeviceUnlockCredential | null;
}

interface AccountListProps {
  accounts: AccountOption[];
  currentId: string | null;
  busy: boolean;
  onChoose(account: AccountOption): void;
}

export function AccountList({ accounts, currentId, currentAvatarUrl, busy, onChoose }: AccountListProps & { currentAvatarUrl?: string | null }) {
  const { locale, t } = useI18n();
  const sortedAccounts = [...accounts].sort((a, b) =>
    a.user.displayName.localeCompare(b.user.displayName, locale, { sensitivity: "accent" })
    || a.user.username.localeCompare(b.user.username, locale)
  );
  return <div className="account-picker-list">
    {sortedAccounts.map((account) => {
      const isCurrent = account.user.id === currentId;
      return <button key={account.user.id} className="account-picker-row" type="button"
        aria-current={isCurrent || undefined} disabled={busy} onClick={() => onChoose(account)}>
        {isCurrent && currentAvatarUrl
          ? <img className="account-picker-avatar" src={currentAvatarUrl} alt="" />
          : <AppIcon icon={UserRound} />}
        <span className="account-picker-name">{account.user.displayName}</span>
        {hasDevicePin(account.credential) && <span className="account-picker-pin" role="img"
          aria-label={t("lock.devicePin")} title={t("lock.devicePin")}><AppIcon icon={LockKeyhole} size={14} /></span>}
        {isCurrent && <small className="account-picker-current">{t("account.current")}</small>}
      </button>;
    })}
  </div>;
}

export function AccountChooser({ accounts, currentId, busy, error, onChoose, onLogin, onBack }: AccountListProps & {
  error: "switchFailed" | "reauth" | null;
  onLogin(): void;
  onBack?: () => void;
}) {
  const { t } = useI18n();
  return <main className="auth-shell">
    <section className="auth-card account-picker" aria-labelledby="account-picker-title" aria-busy={busy}>
      <img className="brand-mark" src="/icon.svg" alt="Mint Notes" />
      <h1 id="account-picker-title">{t("account.switch")}</h1>
      <AccountList accounts={accounts} currentId={currentId} busy={busy} onChoose={onChoose} />
      {error && <p className="error" role="alert">{t(error === "reauth" ? "account.reauth" : "account.switchFailed")}</p>}
      <div className="auth-ghost-actions">
        {onBack && <button type="button" className="auth-ghost" disabled={busy} onClick={onBack}><AppIcon icon={ArrowLeft} size={16} />{t("account.back")}</button>}
        <button type="button" className="auth-ghost" disabled={busy} onClick={onLogin}><AppIcon icon={UserRoundPlus} size={16} />{t("account.otherLogin")}</button>
      </div>
    </section>
  </main>;
}
