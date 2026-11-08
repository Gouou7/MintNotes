import { useRef, useState, type ReactElement, type ReactNode } from "react";
import { overlayFont } from "./overlayFont";
import {
  ContextMenu, ContextMenuContent, ContextMenuGroup, ContextMenuItem,
  ContextMenuSeparator, ContextMenuTrigger
} from "./ui/context-menu";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger
} from "./ui/dropdown-menu";

type MenuKind = "context" | "dropdown";
type MenuActions = { kind: MenuKind; runAfterContextClose: (action: () => void) => void };

export type RowMenuItems = (Item: typeof ContextMenuItem | typeof DropdownMenuItem,
  Separator: typeof ContextMenuSeparator | typeof DropdownMenuSeparator, menu: MenuActions) => ReactNode;

function Items({ render, menu }: { render: RowMenuItems; menu: MenuActions }) {
  return menu.kind === "dropdown" ? <DropdownMenuGroup>{render(DropdownMenuItem, DropdownMenuSeparator, menu)}</DropdownMenuGroup>
    : <ContextMenuGroup>{render(ContextMenuItem, ContextMenuSeparator, menu)}</ContextMenuGroup>;
}

export function RowActionMenu({ row, trigger, items, onOpen, className = "context-menu", contextDisabled }: {
  row: (more: ReactNode) => ReactElement;
  trigger: ReactElement;
  items: RowMenuItems;
  onOpen?: () => void;
  className?: string;
  contextDisabled?: boolean;
}) {
  const [menu, setMenu] = useState<MenuKind | null>(null);
  const [font, setFont] = useState<ReturnType<typeof overlayFont>>();
  const pendingContextAction = useRef<(() => void) | null>(null);
  const change = (kind: MenuKind, open: boolean, target: EventTarget | null) => {
    if (open) {
      pendingContextAction.current = null;
      onOpen?.();
      setFont(overlayFont(target));
      setMenu(kind);
    } else setMenu((current) => current === kind ? null : current);
  };
  const content = row(<DropdownMenu open={menu === "dropdown"} onOpenChange={(open, { event }) => change("dropdown", open, event.target)}>
    <DropdownMenuTrigger render={trigger} />
    <DropdownMenuContent className={className} style={font} align="end">
      <Items render={items} menu={{ kind: "dropdown", runAfterContextClose: (action) => action() }} />
    </DropdownMenuContent>
  </DropdownMenu>);
  if (contextDisabled) return content;
  return <ContextMenu open={menu === "context"} onOpenChange={(open, { event }) => change("context", open, event.target)}
    onOpenChangeComplete={(open) => {
      if (open) return;
      const action = pendingContextAction.current;
      pendingContextAction.current = null;
      // Start editing after Base UI commits the menu unmount and queues focus restoration.
      if (action) queueMicrotask(action);
    }}>
    <ContextMenuTrigger render={content} />
    <ContextMenuContent className={className} style={font}>
      <Items render={items} menu={{ kind: "context", runAfterContextClose: (action) => { pendingContextAction.current = action; } }} />
    </ContextMenuContent>
  </ContextMenu>;
}
