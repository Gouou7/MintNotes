import { createContext, useContext, type ReactNode, type RefObject } from "react";
import { X } from "lucide-react";
import { useI18n } from "../i18n";
import { AppIcon } from "./AppIcon";
import { Button } from "./ui/button";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "./ui/dialog";

export const DialogContainer = createContext<RefObject<HTMLDivElement | null> | undefined>(undefined);

export function AppDialog({ title, className, onClose, dismissible = true, children }: {
  title: string;
  className?: string;
  onClose: () => void;
  dismissible?: boolean;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const container = useContext(DialogContainer);
  return <Dialog open disablePointerDismissal onOpenChange={(open) => {
    if (!open && dismissible) onClose();
  }}>
    <DialogContent className={className} showCloseButton={false} portalContainer={container}>
      <header>
        <DialogTitle render={<h3 />}>{title}</DialogTitle>
        {dismissible && <DialogClose render={<Button variant="ghost" size="icon" aria-label={t("common.close")} />}>
          <AppIcon icon={X} />
        </DialogClose>}
      </header>
      {children}
    </DialogContent>
  </Dialog>;
}
