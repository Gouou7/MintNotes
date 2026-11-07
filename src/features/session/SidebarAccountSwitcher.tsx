import { Button } from "@/components/ui/button";
import { useState } from "react";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Alert } from "@/components/ui/alert";
import { UserRoundPlus, UsersRoundCollaboration } from "lucide-react";
import { AppIcon } from "../../components/AppIcon";
import { overlayFont } from "../../components/overlayFont";
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
  const [font, setFont] = useState<ReturnType<typeof overlayFont>>();
  const changeOpen = (next: boolean, { event }: { event: Event }) => {
    setOpen(next);
    if (next) {
      setFont(overlayFont(event.target));
      setLoadFailed(false);
      void onOpen().catch(() => setLoadFailed(true));
    }
  };

  return <Popover open={open} onOpenChange={changeOpen}>
    <PopoverTrigger render={<Button variant="ghost" size="icon" type="button" title={t("account.switch")} aria-label={t("account.switch")} disabled={busy}>
      <AppIcon icon={UsersRoundCollaboration} />
    </Button>} />
    <PopoverContent className="account-switch-popover" style={font} align="end" side="top" aria-busy={busy}>
      <PopoverTitle render={<h2 />}>{t("account.switch")}</PopoverTitle>
      <AccountList accounts={[current, ...accounts.filter((account) => account.user.id !== current.user.id)]}
        currentId={current.user.id} currentAvatarUrl={currentAvatarUrl} busy={busy} onChoose={(account) => {
          if (account.user.id === current.user.id) {
            setOpen(false);
          } else onChoose(account);
        }} />
      {loadFailed && <Alert className="error" variant="destructive">{t("account.switchFailed")}</Alert>}
      <div className="account-switch-actions">
        <Button type="button" className="account-picker-row" disabled={busy} onClick={() => {
          setOpen(false);
          onLogin();
        }}><AppIcon icon={UserRoundPlus} /><span className="account-picker-name">{t("account.otherLogin")}</span></Button>
      </div>
    </PopoverContent>
  </Popover>;
}
