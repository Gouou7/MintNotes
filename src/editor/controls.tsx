import { AlignCenter, AlignLeft, AlignRight, Beaker, BookOpen, Bug, ChevronDown, ChevronRight, CircleCheck, CircleHelp, CircleX, ClipboardList, Copy, CornerUpLeft, Image, ImageOff, Info, Lightbulb, ListMinus, MessageSquareWarning, OctagonAlert, Quote, ShieldAlert, Sparkles, TableProperties, Trash2, TriangleAlert, type LucideIcon } from "lucide-react";
import { createRoot } from "react-dom/client";
import { AppIcon } from "../components/AppIcon";
import type { MessageKey, Translate } from "../i18n";
import type { EditorOptions } from "./engine";
import { parseCalloutMarker } from "./callouts";
import { renderMathInto, renderMermaidInto } from "./richRenderers";

const icons: Record<string, LucideIcon> = {
  copy: Copy, "footnote-back": CornerUpLeft, image: Image, "image-unavailable": ImageOff, "table-size": TableProperties, "table-delete": Trash2,
  "align-left": AlignLeft, "align-center": AlignCenter, "align-right": AlignRight, "chevron-right": ChevronRight, "chevron-down": ChevronDown,
  "callout-note": BookOpen, "callout-abstract": ListMinus, "callout-info": Info, "callout-todo": ClipboardList, "callout-tip": Lightbulb,
  "callout-important": MessageSquareWarning, "callout-success": CircleCheck, "callout-question": CircleHelp, "callout-warning": TriangleAlert,
  "callout-caution": OctagonAlert, "callout-failure": CircleX, "callout-danger": ShieldAlert, "callout-bug": Bug, "callout-example": Beaker, "callout-quote": Quote, "callout-custom": Sparkles,
};
const labels: Record<string, MessageKey> = {
  copyCode: "editor.copyCode", codeCopied: "editor.codeCopied", codeCopyFailed: "editor.codeCopyFailed",
  backToFootnote: "editor.backToFootnote", sourceLabel: "editor.sourceLabel", toggleCallout: "editor.toggleCallout", tableSize: "editor.tableSize", tableDelete: "editor.tableDelete",
  alignLeft: "editor.alignLeft", alignCenter: "editor.alignCenter", alignRight: "editor.alignRight", rows: "editor.rows", columns: "editor.columns", codeLanguage: "editor.codeLanguage",
};
export function editorPresentation(getTranslate: () => Translate): Pick<EditorOptions, "icon" | "label" | "renderMath" | "renderMermaid" | "parseCallout"> {
  return {
    icon(name) {
      const element = document.createElement("span"), root = createRoot(element);
      root.render(<AppIcon icon={icons[name] ?? Sparkles} size={16} />);
      return { element, destroy: () => queueMicrotask(() => root.unmount()) };
    },
    label: name => labels[name] ? getTranslate()(labels[name]) : name,
    renderMath: renderMathInto,
    renderMermaid: (host, source) => renderMermaidInto(host, source, { rendering: getTranslate()("editor.diagramRendering"), failed: getTranslate()("editor.diagramFailed"), alt: getTranslate()("editor.diagramAlt") }),
    parseCallout: parseCalloutMarker,
  };
}
