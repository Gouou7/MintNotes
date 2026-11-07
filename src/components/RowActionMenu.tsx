import { useState, type ReactElement, type ReactNode } from "react";
import { overlayFont } from "./overlayFont";
import {
  ContextMenu, ContextMenuContent, ContextMenuGroup, ContextMenuItem,
  ContextMenuSeparator, ContextMenuTrigger
} from "./ui/context-menu";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger
} from "./ui/dropdown-menu";

export type RowMenuItems = (Item: typeof ContextMenuItem | typeof DropdownMenuItem,
  Separator: typeof ContextMenuSeparator | typeof DropdownMenuSeparator) => ReactNode;

function Items({ render, dropdown = false }: { render: RowMenuItems; dropdown?: boolean }) {
  return dropdown ? <DropdownMenuGroup>{render(DropdownMenuItem, DropdownMenuSeparator)}</DropdownMenuGroup>
    : <ContextMenuGroup>{render(ContextMenuItem, ContextMenuSeparator)}</ContextMenuGroup>;
}

export function RowActionMenu({ row, trigger, items, onOpen, className = "context-menu", contextDisabled }: {
  row: (more: ReactNode) => ReactElement;
  trigger: ReactElement;
  items: RowMenuItems;
  onOpen?: () => void;
  className?: string;
  contextDisabled?: boolean;
}) {
  const [menu, setMenu] = useState<"context" | "dropdown" | null>(null);
  const [font, setFont] = useState<ReturnType<typeof overlayFont>>();
  const change = (kind: "context" | "dropdown", open: boolean, target: EventTarget | null) => {
    if (open) {
      onOpen?.();
      setFont(overlayFont(target));
      setMenu(kind);
    } else setMenu((current) => current === kind ? null : current);
  };
  const content = row(<DropdownMenu open={menu === "dropdown"} onOpenChange={(open, { event }) => change("dropdown", open, event.target)}>
    <DropdownMenuTrigger render={trigger} />
    <DropdownMenuContent className={className} style={font} align="end">
      <Items render={items} dropdown />
    </DropdownMenuContent>
  </DropdownMenu>);
  if (contextDisabled) return content;
  return <ContextMenu open={menu === "context"} onOpenChange={(open, { event }) => change("context", open, event.target)}>
    <ContextMenuTrigger render={content} />
    <ContextMenuContent className={className} style={font}>
      <Items render={items} />
    </ContextMenuContent>
  </ContextMenu>;
}
