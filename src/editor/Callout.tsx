import {
  Beaker,
  BookOpen,
  Bug,
  CircleCheck,
  CircleHelp,
  CircleX,
  ClipboardList,
  Info,
  Lightbulb,
  ListMinus,
  MessageSquareWarning,
  OctagonAlert,
  Quote,
  ShieldAlert,
  Sparkles,
  TriangleAlert,
  type LucideIcon
} from "lucide-react";
import type { ReactNode } from "react";
import { AppIcon } from "../components/AppIcon";
import type { CalloutFold, CalloutKind } from "./callouts";

const CALLOUT_ICONS: Record<CalloutKind, LucideIcon> = {
  note: BookOpen,
  abstract: ListMinus,
  info: Info,
  todo: ClipboardList,
  tip: Lightbulb,
  important: MessageSquareWarning,
  success: CircleCheck,
  question: CircleHelp,
  warning: TriangleAlert,
  caution: OctagonAlert,
  failure: CircleX,
  danger: ShieldAlert,
  bug: Bug,
  example: Beaker,
  quote: Quote,
  custom: Sparkles
};

export function CalloutHeader({ kind, title }: { kind: CalloutKind; title: string }) {
  return (
    <span className="callout-header">
      <span className="callout-icon"><AppIcon icon={CALLOUT_ICONS[kind]} size={19} /></span>
      <strong>{title}</strong>
    </span>
  );
}
export function CalloutBlock({
  kind,
  title,
  fold,
  children
}: {
  kind: CalloutKind;
  title: string;
  fold: CalloutFold;
  children: ReactNode;
}) {
  const className = `markdown-callout callout-${kind}`;
  if (fold) {
    return (
      <details className={className} open={fold === "+"}>
        <summary><CalloutHeader kind={kind} title={title} /></summary>
        <div className="callout-content">{children}</div>
      </details>
    );
  }
  return (
    <aside className={className} role="note" aria-label={title}>
      <CalloutHeader kind={kind} title={title} />
      <div className="callout-content">{children}</div>
    </aside>
  );
}
