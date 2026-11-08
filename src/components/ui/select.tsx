import { Select as SelectPrimitive } from "@base-ui/react/select";
import { Check, ChevronDown, type LucideIcon } from "lucide-react";
import { useRef, useState } from "react";
import { AppIcon } from "../AppIcon";
import { overlayFont } from "../overlayFont";
import { buttonVariants } from "./button";

interface SelectProps<Value extends string | number> extends Pick<SelectPrimitive.Trigger.Props, "id" | "title" | "aria-label" | "aria-describedby"> {
  items: readonly { value: Value; label: string }[];
  value: Value;
  disabled?: boolean;
  triggerIcon?: LucideIcon;
  onValueChange: (value: Value) => void;
}

export function Select<Value extends string | number>({ items, value, disabled, triggerIcon, onValueChange, ...triggerProps }: SelectProps<Value>) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [font, setFont] = useState<ReturnType<typeof overlayFont>>();
  return <SelectPrimitive.Root items={items} value={value} disabled={disabled} onValueChange={(next) => {
    if (next !== null) onValueChange(next);
  }} onOpenChange={(open) => { if (open) setFont(overlayFont(trigger.current)); }}>
    <SelectPrimitive.Trigger ref={trigger} data-slot="select-trigger"
      className={triggerIcon ? buttonVariants({ variant: "ghost", size: "icon" }) : "inline-flex h-8 w-fit min-w-0 items-center justify-between gap-2 rounded-lg border border-input bg-popover px-2.5 text-sm text-popover-foreground outline-none transition-colors hover:bg-accent data-popup-open:bg-accent focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"}
      {...triggerProps}>
      <SelectPrimitive.Value className={triggerIcon ? "sr-only" : "truncate"} />
      {triggerIcon ? <AppIcon icon={triggerIcon} /> : <SelectPrimitive.Icon className="shrink-0 text-muted-foreground"><AppIcon icon={ChevronDown} className="size-4" /></SelectPrimitive.Icon>}
    </SelectPrimitive.Trigger>
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner align="start" alignItemWithTrigger={false} sideOffset={4} className="isolate z-50">
        <SelectPrimitive.Popup data-slot="select-content" style={font}
          className="flex max-h-(--available-height) w-(--anchor-width) min-w-32 max-w-(--available-width) flex-col rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-floating outline-none">
          <SelectPrimitive.List className="min-h-0 overflow-y-auto overscroll-contain">
            <SelectPrimitive.Group>
              {items.map((item) => <SelectPrimitive.Item key={item.value} value={item.value} data-slot="select-item"
                className="relative flex cursor-default items-center rounded-md py-1.5 pr-8 pl-2 outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground">
                <SelectPrimitive.ItemText className="min-w-0 wrap-anywhere">{item.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="absolute right-2 flex items-center" data-slot="select-item-indicator">
                  <AppIcon icon={Check} className="size-4" />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>)}
            </SelectPrimitive.Group>
          </SelectPrimitive.List>
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  </SelectPrimitive.Root>;
}
