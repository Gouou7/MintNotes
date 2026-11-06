import { useEffect, useId, useRef, useState } from "react";
import { UserRoundPlus, UsersRoundCollaboration } from "lucide-react";
import { AppIcon } from "../../components/AppIcon";
import { useI18n } from "../../i18n";
import { AccountList, type AccountOption } from "./AccountChooser";

interface Props {
  accounts: AccountOption[];
  current: AccountOption;
  currentAvatarUrl: string | null;
  busy: boolean;
  onOpen(): Promise<unknown>;
  onChoose(account: AccountOption): void;
  onLogin(): void;
}

export function SidebarAccountSwitcher({ accounts, current, currentAvatarUrl, busy, onOpen, onChoose, onLogin }: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    panel.current?.focus();

    const dismissOutside = (event: Event) => {
      if (event.target instanceof Node && !trigger.current?.contains(event.target) && !panel.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("focusin", dismissOutside);
    document.addEventListener("keydown", dismissOnEscape, true);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("focusin", dismissOutside);
      document.removeEventListener("keydown", dismissOnEscape, true);
    };
  }, [open]);

  const toggle = () => {
    setOpen(!open);
    if (!open) {
      setLoadFailed(false);
      void onOpen().catch(() => setLoadFailed(true));
    }
  };

  return <>
    <button ref={trigger} type="button" title={t("account.switch")} aria-label={t("account.switch")}
      aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? panelId : undefined} disabled={busy} onClick={toggle}>
      <AppIcon icon={UsersRoundCollaboration} size={16} />
    </button>
    {open && <div ref={panel} id={panelId} className="account-switch-popover" role="dialog"
      aria-labelledby={panelId + "-title"} aria-busy={busy} tabIndex={-1}>
      <h2 id={panelId + "-title"}>{t("account.switch")}</h2>
      <AccountList accounts={[current, ...accounts.filter((account) => account.user.id !== current.user.id)]}
        currentId={current.user.id} currentAvatarUrl={currentAvatarUrl} busy={busy} onChoose={(account) => {
          if (account.user.id === current.user.id) {
            setOpen(false);
            trigger.current?.focus();
          } else onChoose(account);
        }} />
      {loadFailed && <p className="error" role="alert">{t("account.switchFailed")}</p>}
      <div className="account-switch-actions">
        <button type="button" className="account-picker-row" disabled={busy} onClick={() => {
          setOpen(false);
          onLogin();
        }}><AppIcon icon={UserRoundPlus} /><span className="account-picker-name">{t("account.otherLogin")}</span></button>
      </div>
    </div>}
  </>;
}
