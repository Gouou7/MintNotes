import { LockKeyhole } from "lucide-react";
import { AppIcon } from "./AppIcon";

export function ProtectionBadge({ label }: { label: string }) {
  return <span className="protection-badge" title={label}>
    <AppIcon icon={LockKeyhole} size={8} />
    <span className="sr-only">{label}</span>
  </span>;
}
