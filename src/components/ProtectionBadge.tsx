import { LockKeyhole, type LucideIcon } from "lucide-react";
import { AppIcon } from "./AppIcon";

export function ProtectionBadge({ label, icon = LockKeyhole }: { label: string; icon?: LucideIcon }) {
  return <span className="protection-badge" title={label}>
    <AppIcon icon={icon} size={8} />
    <span className="sr-only">{label}</span>
  </span>;
}
