import { markConsumed, markExtRanges, type InlineSpan } from "../inline-parse";
import type { FeatureSpec, InlineFeatureSpec } from "./_types";

const HTML_BREAK_RE = /<br\s*\/?>/gi;

const scan: InlineFeatureSpec["scan"] = (text, consumed) => {
  const spans: InlineSpan[] = [];
  HTML_BREAK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = HTML_BREAK_RE.exec(text))) {
    const from = match.index;
    const to = from + match[0].length;
    let blocked = false;
    for (let index = from; index < to; index += 1) {
      if (consumed[index]) {
        blocked = true;
        break;
      }
    }
    if (blocked) continue;
    markConsumed(consumed, from, to);
    spans.push({
      type: "html_break",
      from,
      to,
      openFrom: from,
      openTo: to,
      closeFrom: to,
      closeTo: to,
      delimRanges: [{ from, to }],
      widgetDecorations: [{
        pos: to,
        when: "outside",
        kind: "html-break",
        key: match[0],
        side: 1,
      }],
    });
  }
  return spans;
};

/** The one explicitly supported raw-HTML construct: a source-backed hard break. */
export const htmlBreak: FeatureSpec = {
  name: "html-break",
  marks: {
    html_break: {
      inclusive: false,
      parseDOM: [{ tag: "span[data-html-break-source]" }],
      toDOM: () => ["span", { "data-html-break-source": "1" }, 0],
    },
  },
  markDelims: { html_break: { open: "", close: "" } },
  inline: {
    priority: 0.25,
    scan,
    markNames: ["html_break"],
    extRanges: (parent) => markExtRanges(parent, "html_break", 0),
  },
};
