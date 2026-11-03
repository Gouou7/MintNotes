import { useId, type ReactNode } from "react";

export function SettingsSection({ title, description, actions, className = "", children }: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  const titleId = useId();
  return <section className="settings-group" aria-labelledby={titleId}>
    <h3 className="settings-group-title" id={titleId}>{title}</h3>
    <div className={`settings-section settings-card ${className}`.trim()}>
      {(description || actions) && <div className="settings-card-intro">
        {description && <div className="settings-card-description">{description}</div>}
        {actions && <div className="settings-actions">{actions}</div>}
      </div>}
      {children}
    </div>
  </section>;
}
