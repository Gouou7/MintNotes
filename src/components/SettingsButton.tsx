import type { ButtonHTMLAttributes } from "react";
import type { LucideIcon } from "lucide-react";
import { AppIcon } from "./AppIcon";

interface SettingsButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  iconOnly?: boolean;
}

/** Shared icon or labeled action for settings, including native form submission behavior. */
export function SettingsButton({ icon, iconOnly = false, className = "", children, ...props }: SettingsButtonProps) {
  return <button {...props} className={`settings-action-button${iconOnly ? " settings-icon-button" : ""} ${className}`}>
    <AppIcon icon={icon} size={16} strokeWidth={1.5} />
    {!iconOnly && children}
  </button>;
}
