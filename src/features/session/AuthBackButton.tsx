import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { AppIcon } from "../../components/AppIcon";
import { useI18n } from "../../i18n";

export function AuthBackButton({ disabled, onClick }: { disabled: boolean; onClick(): void }) {
  const { t } = useI18n();
  return <Button className="justify-self-start" variant="secondary" size="lg" type="button" disabled={disabled} onClick={onClick}>
    <AppIcon icon={ArrowLeft} data-icon="inline-start" />
    {t("account.back")}
  </Button>;
}
