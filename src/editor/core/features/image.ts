import type { Mark } from "prosemirror-model";
import { Plugin } from "prosemirror-state";

import {
  INLINE_PRESENTATION_META,
  markConsumed,
  type InlineSpan,
} from "../inline-parse";
import type { FeatureSpec, InlineFeatureSpec } from "./_types";

// image in Typora-pilot (method B) mode.
//
// Source `![alt](src "title")` lives verbatim in the textblock text:
//   open delim  = `![`            (2 chars)
//   content     = alt             (image mark covers this range)
//   close delim = `](src "title")` or `](src)`
//
// Visibility model (different from link, matches Typora):
//   - cursor outside span: source chars hidden, an <img> widget at closeTo
//     renders the loaded image
//   - cursor inside span:  source chars visible (plain), an icon widget at
//     openFrom flags the line as image; empty sources stay editable.
//
// We piggy-back on the existing softInside delim path to flip the source
// chars on and off, and on widgetDecorations to swap the img/icon UI.

const IMAGE_RE = /!\[([^\]]*?)\]\(([^\s)]*)(?:\s+"([^"]*)")?\)/g;

// Per-src load result. We only need to remember confirmed errors —
// "loading" and "ok" both render as a loaded image (optimistic), so we
// track only the negative case explicitly.
//
// Keyed by src string. Module-level so the scanner (run from normalize's
// computePlan) can read it without plumbing extra context, and the probe
// plugin can write it. setMeta on a state-only tr tells PM to re-run
// state.apply / appendTransaction so decorations re-emit.
type LoadStatus = "loading" | "ok" | "error";
const imageLoadStatus = new Map<string, LoadStatus>();
const scan: InlineFeatureSpec["scan"] = (text, consumed, _parentBlock, presentation) => {
  const out: InlineSpan[] = [];
  IMAGE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = IMAGE_RE.exec(text))) {
    const fullStart = m.index;
    const fullEnd = fullStart + m[0].length;
    let blocked = false;
    for (let i = fullStart; i < fullEnd; i++) {
      if (consumed[i]) {
        blocked = true;
        break;
      }
    }
    if (blocked) continue;

    const openFrom = fullStart;
    const openTo = fullStart + 2; // after `![`
    const contentFrom = openTo;
    const contentTo = openTo + m[1]!.length;
    const closeFrom = contentTo;
    const closeTo = fullEnd;

    markConsumed(consumed, fullStart, fullEnd);
    const src = m[2]!;
    const resolvedSource = presentation?.resolveImageSource?.(src);
    const pendingSource = resolvedSource === null;
    const displaySource = pendingSource ? "" : resolvedSource ?? src;
    const presentationKey = pendingSource ? "pending" : resolvedSource;
    const title = m[3] ?? null;
    const alt = m[1]!;
    const span: InlineSpan = {
      type: "image",
      from: contentFrom,
      to: contentTo,
      openFrom,
      openTo,
      closeFrom,
      closeTo,
      attrs: { src, title },
      widgetDecorations: [],
    };

    // Source visible always when:
    //   - src is empty
    //   - probe has confirmed src fails to load
    // Otherwise (probe pending or confirmed ok) render optimistically —
    // shows the image and only flashes back to edit-mode if a real load
    // error comes in. Avoids a long edit-mode delay on every valid image.
    const status = src === ""
      ? null
      : pendingSource
        ? "loading"
        : imageLoadStatus.get(displaySource) ?? null;
    const editMode = src === "" || status === "error";
    // Icon side=1: caret at openFrom renders to the LEFT of the icon, so
    // ArrowLeft from inside the source can park the cursor before the icon
    // widget. With side=-1 the caret ended up between icon and `!`, with no
    // way to navigate further left while still inside the textblock.
    const iconWidget = {
      pos: openFrom,
      kind: "image-icon",
      side: 1,
      attrs: status === "error" ? { broken: "1" } : undefined,
    };

    if (!editMode) {
      // Loaded image: <img> renders ALWAYS, placed at the END of the
      // source range so display:block puts it on a new line BELOW the
      // markdown text. softInside delim hides the source chars when the
      // cursor is outside; cursor inside reveals source for editing while
      // the image stays put underneath.
      span.delimRanges = [{ from: openFrom, to: closeTo, softInside: true }];
      span.widgetDecorations!.push(
        { ...iconWidget, when: "inside" } as never,
        {
          pos: closeTo,
          when: "always",
          kind: "image-render",
          attrs: { src: displaySource, alt, ...(title ? { title } : {}) },
          ...(presentationKey !== undefined ? { key: presentationKey } : {}),
        },
      );
    } else {
      span.delimRanges = [];
      span.widgetDecorations!.push(
        { ...iconWidget, when: "always" } as never,

      );
    }
    out.push(span);
  }
  return out;
};

// Probes every image src found in the doc. On load/error, updates the
// shared status map and dispatches a meta-only tx to retrigger normalize/
// decorations so the span flips between image-mode and edit-mode.
function imageLoadProbePlugin(
  resolveImageSource?: (source: string) => string | null | undefined,
): Plugin {
  return new Plugin({
    view(editorView) {
      let destroyed = false;
      const owned = new Set<string>();
      const probe = (src: string): void => {
        if (imageLoadStatus.has(src)) return;
        imageLoadStatus.set(src, "loading");
        owned.add(src);
        const probeImg = new Image();
        const finish = (status: LoadStatus): void => {
          if (destroyed) return;
          imageLoadStatus.set(src, status);
          // setMeta-only tx: nothing in doc changes, but state.apply runs
          // for normalize+decorations and the per-span editMode flag re-
          // evaluates with the new status.
          editorView.dispatch(editorView.state.tr.setMeta(INLINE_PRESENTATION_META, status));
        };
        probeImg.onload = (): void => finish("ok");
        probeImg.onerror = (): void => finish("error");
        probeImg.src = src;
      };
      const scanDoc = (): void => {
        editorView.state.doc.descendants((node) => {
          if (!node.isTextblock) return true;
          const text = node.textContent;
          IMAGE_RE.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = IMAGE_RE.exec(text))) {
            const authoredSource = m[2];
            if (!authoredSource) continue;
            const resolvedSource = resolveImageSource?.(authoredSource);
            if (resolvedSource === null) continue;
            probe(resolvedSource ?? authoredSource);
          }
          return false;
        });
      };
      scanDoc();
      return {
        update: () => scanDoc(),
        destroy: () => { destroyed = true; for (const src of owned) imageLoadStatus.delete(src); },
      };
    },
  });
}

function closeDelimText(mark: Mark): string {
  const src = String(mark.attrs.src ?? "");
  const title = mark.attrs.title as string | null;
  return title
    ? `](${src} "${title}")`
    : `](${src})`;
}

export const image: FeatureSpec = {
  name: "image",

  marks: {
    image: {
      attrs: {
        src: { default: "" },
        title: { default: null },
      },
      inclusive: false,
      // toDOM/parseDOM must be a stable round-trip: PM's mutation observer
      // re-reads the DOM after every transaction, and if a toDOM-produced
      // element doesn't match any parseDOM rule, the mark is silently
      // dropped — normalize then re-applies it next tick, infinite loop.
      // We use a distinct `data-image-mark` marker so it can't collide
      // with anything else.
      parseDOM: [
        {
          tag: "span[data-image-mark]",
          getAttrs: (el) => ({
            src: (el as HTMLElement).getAttribute("data-src") ?? "",
            title: (el as HTMLElement).getAttribute("data-title"),
          }),
        },
      ],
      toDOM: (mark) => {
        const { src, title } = mark.attrs as { src: string; title: string | null };
        const attrs: Record<string, string> = { "data-image-mark": "" };
        if (src) attrs["data-src"] = src;
        if (title) attrs["data-title"] = title;
        return ["span", attrs, 0];
      },
    },
  },

  parserTokens: {
    image: (state, tok, schema) => {
      const src = tok.attrGet("src") ?? "";
      const title = tok.attrGet("title");
      // tok.content is the alt text (md-it joins child token text).
      const alt = tok.content;
      state.addText("![");
      state.openMark(schema.marks.image.create({ src, title: title || null }));
      state.addText(alt);
      state.closeMarkType(schema.marks.image);
      state.addText(
        title ? `](${src} "${title}")` : `](${src})`,
      );
    },
  },

  markDelims: {
    image: { open: "", close: "" },
  },

  plugins: (_schema, context) => [
    imageLoadProbePlugin(context.resolveImageSource),
  ],

  inline: {
    // Before link: image's `![alt](url)` strictly contains link's `[alt](url)`
    // shape. Running image first lets it consume the whole match (including
    // the `!`) before link's regex sees the inner brackets. priority < link's 3.
    priority: 2.5,
    scan,
    markNames: ["image"],
    extRanges: (parent) => {
      const ranges: Array<[number, number]> = [];
      const imageType = parent.type.schema.marks.image;
      if (!imageType) return ranges;
      let start = -1;
      let currentMark: Mark | null = null;
      let off = 0;
      const flush = (end: number): void => {
        if (start < 0 || !currentMark) return;
        // open delim is `![` (2 chars), close varies.
        ranges.push([start - 2, end + closeDelimText(currentMark).length]);
        start = -1;
        currentMark = null;
      };
      parent.forEach((child) => {
        if (child.isText) {
          const m = child.marks.find((mk) => mk.type === imageType) ?? null;
          if (m) {
            if (start < 0) {
              start = off;
              currentMark = m;
            } else if (currentMark && !m.eq(currentMark)) {
              flush(off);
              start = off;
              currentMark = m;
            }
          } else {
            flush(off);
          }
        }
        off += child.nodeSize;
      });
      flush(off);
      return ranges;
    },
  },

};
