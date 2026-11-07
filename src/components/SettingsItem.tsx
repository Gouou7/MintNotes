import { cn } from "cn";
import { Field, FieldLabel } from "./ui/field";
import { useId, type ReactNode } from "react";

interface SettingsControlProps {
  id: string;
  "aria-describedby"?: string;
}

/** A named setting with optional supporting text and a trailing control or actions. */
export function SettingsItem({ title, description, className = "", children }: {
  title: string;
  description?: ReactNode;
  className?: string;
  children: ReactNode | ((props: SettingsControlProps) => ReactNode);
}) {
  const id = useId();
  const descriptionId = description ? `${id}-description` : undefined;
  const hasControl = typeof children === "function";
  return <Field orientation="horizontal" className={cn("settings-item", className)}>
    <div className="settings-item-copy">
      {hasControl ? <FieldLabel className="settings-item-title" htmlFor={id}>{title}</FieldLabel> : <span className="settings-item-title">{title}</span>}
      {description && <div className="settings-help settings-item-description" id={descriptionId}>{description}</div>}
    </div>
    <div className="settings-item-control">
      {hasControl ? children({ id, "aria-describedby": descriptionId }) : children}
    </div>
  </Field>;
}
