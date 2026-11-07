import { useContext, useRef, type CSSProperties, type ReactNode } from "react";
import { DialogContainer } from "../components/AppDialog";
import { Dialog, DialogContent } from "../components/ui/dialog";

export function SettingsDialog({ children, onClose, dismissible = true, style }: {
  children: ReactNode;
  onClose: () => void;
  dismissible?: boolean;
  style?: CSSProperties;
}) {
  const popup = useRef<HTMLDivElement>(null);
  const container = useContext(DialogContainer);
  return <Dialog open onOpenChange={(open) => { if (!open && dismissible) onClose(); }}>
    <DialogContent ref={popup} className="modal settings-modal" overlayClassName="settings-backdrop"
      style={style} showCloseButton={false} portalContainer={container}>
      <DialogContainer.Provider value={popup}>{children}</DialogContainer.Provider>
    </DialogContent>
  </Dialog>;
}
