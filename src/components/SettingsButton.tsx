import type { ComponentProps } from "react";
import type { LucideIcon } from "lucide-react";
import { AppIcon } from "./AppIcon";
import { cn } from "cn";
import { Button } from "./ui/button";

interface SettingsButtonProps extends Omit<ComponentProps<typeof Button>, "size"> {
  icon: LucideIcon;
  iconOnly?: boolean;
}

/** Shared icon or labeled action for settings, including native form submission behavior. */
export function SettingsButton({ icon, iconOnly = false, className, children, type = "button", variant = iconOnly ? "ghost" : "outline", ...props }: SettingsButtonProps) {
  return <Button {...props} type={type} variant={variant} size={iconOnly ? "icon" : "default"}
    className={cn("settings-action-button", iconOnly && "settings-icon-button", className)}>
    <AppIcon icon={icon} data-icon={iconOnly ? undefined : "inline-start"} />
    {!iconOnly && children}
  </Button>;
}
