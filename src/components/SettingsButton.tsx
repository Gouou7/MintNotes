import type { ButtonHTMLAttributes } from "react";
import type { LucideIcon } from "lucide-react";
import { AppIcon } from "./AppIcon";

interface SettingsButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: LucideIcon;
}

/** Shared text action for settings, including native form submission behavior. */
export function SettingsButton({ icon, className = "", children, ...props }: SettingsButtonProps) {
  return <button {...props} className={`settings-action-button ${className}`}>
    {icon && <AppIcon icon={icon} size={16} strokeWidth={1.5} />}
    {children}
  </button>;
}
