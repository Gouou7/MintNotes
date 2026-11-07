import type { ReactNode, RefObject } from "react";
import { Sheet, SheetContent, SheetTitle } from "../../components/ui/sheet";

export function WorkspaceDrawer({ compact, open, side, title, container, onClose, children }: {
  compact: boolean;
  open: boolean;
  side: "left" | "right";
  title: string;
  container: RefObject<HTMLDivElement | null>;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!compact) return children;
  return <Sheet open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
    <SheetContent side={side} portalContainer={container} keepMounted showCloseButton={false} className="workspace-drawer">
      <SheetTitle className="sr-only">{title}</SheetTitle>
      {children}
    </SheetContent>
  </Sheet>;
}
