import { Schema, type NodeSpec, type MarkSpec } from "prosemirror-model";

import { collectMarks, collectNodes } from "./features/index";
import { LIVE_SYNTAX_EDITING, LIVE_SYNTAX_RENDERING } from "./live-syntax-state";
import {
  SOURCE_FINGERPRINT_ATTR,
  SOURCE_FROM_ATTR,
  SOURCE_LAYOUT_HEIGHT_ATTR,
  SOURCE_TEXT_ATTR,
  SOURCE_TO_ATTR,
} from "./source";

const coreNodes: Record<string, NodeSpec> = {
  doc: { content: "block+" },

  paragraph: {
    group: "block",
    content: "inline*",
    parseDOM: [{ tag: "p" }],
    toDOM: () => ["p", 0],
  },

  source_gap: {
    group: "block",
    content: "(text | source_gap_eol)*",
    marks: "",
    code: true,
    defining: true,
    attrs: {
      // A single line ending between adjacent Markdown blocks is only their
      // structural separator. It remains source-addressable but must not
      // create an editable blank row in Live presentation.
      structuralOnly: { default: false },
    },
    parseDOM: [{
      tag: "pre[data-source-gap]",
      preserveWhitespace: "full",
      getAttrs: (el) => ({
        structuralOnly: (el as HTMLElement).hasAttribute("data-source-gap-structural"),
      }),
    }],
    toDOM: (node) => ["pre", {
      "data-source-gap": "1",
      ...(node.attrs.structuralOnly ? { "data-source-gap-structural": "1" } : {}),
      "aria-hidden": "true",
    }, ["code", 0]],
  },

  // Line-ending characters inside a source gap need stable document
  // positions without letting <pre> turn the structural separator after the
  // preceding Markdown block into an additional visible row. Each atom owns
  // exactly one canonical character. Atoms ending authored blank rows render
  // a <br>; the preceding block's boundary atom remains zero-width.
  source_gap_eol: {
    group: "inline",
    inline: true,
    atom: true,
    selectable: false,
    attrs: {
      character: { default: "\n" },
      visible: { default: true },
    },
    parseDOM: [
      {
        tag: "br[data-source-gap-eol]",
        getAttrs: (el) => ({
          character: (el as HTMLElement).getAttribute("data-source-gap-eol") === "cr" ? "\r" : "\n",
          visible: true,
        }),
      },
      {
        tag: "span[data-source-gap-eol]",
        getAttrs: (el) => ({
          character: (el as HTMLElement).getAttribute("data-source-gap-eol") === "cr" ? "\r" : "\n",
          visible: false,
        }),
      },
    ],
    toDOM: (node) => {
      const kind = node.attrs.character === "\r" ? "cr" : "lf";
      return node.attrs.visible
        ? ["br", { "data-source-gap-eol": kind }]
        : ["span", {
            "data-source-gap-eol": kind,
            "data-source-gap-hidden": "1",
            contenteditable: "false",
          }];
    },
  },

  // Exact authored Markdown for a structured block whose delimiter position
  // has no concrete position in the derived rich node. The controller swaps
  // to this text-backed presentation only while that source range is being
  // navigated or edited, then reparses the canonical string on exit.
  source_block: {
    group: "block",
    content: "text*",
    marks: "",
    code: true,
    defining: true,
    attrs: {
      kind: { default: "block" },
      [SOURCE_LAYOUT_HEIGHT_ATTR]: { default: null },
    },
    parseDOM: [{
      tag: "pre[data-source-block]",
      preserveWhitespace: "full",
      getAttrs: (el) => ({
        kind: (el as HTMLElement).getAttribute("data-source-kind") ?? "block",
        [SOURCE_LAYOUT_HEIGHT_ATTR]: (() => {
          const value = Number.parseFloat(
            (el as HTMLElement).getAttribute("data-source-layout-height") ?? "",
          );
          return Number.isFinite(value) && value > 0 ? value : null;
        })(),
      }),
    }],
    toDOM: (node) => {
      const sourceLayoutHeight = Number(node.attrs[SOURCE_LAYOUT_HEIGHT_ATTR]);
      const hasReservedHeight = Number.isFinite(sourceLayoutHeight) && sourceLayoutHeight > 0;
      return ["pre", {
        "data-source-block": "1",
        "data-source-kind": node.attrs.kind as string,
        ...(hasReservedHeight ? {
          "data-source-layout-height": String(sourceLayoutHeight),
          style: `min-height: ${sourceLayoutHeight}px`,
        } : {}),
      }, ["code", 0]];
    },
  },

  heading: {
    group: "block",
    content: "inline*",
    // style: "atx" → `# H`, "setext" → `H\n===` (level 1) / `H\n---` (level 2).
    // Captured at parse time from markdown-it's `markup` token field; new
    // headings created via input rule default to "atx".
    attrs: { level: { default: 1 }, style: { default: "atx" } },
    defining: true,
    parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({
      tag: `h${level}`,
      attrs: { level },
    })),
    toDOM: (node) => [`h${node.attrs.level as number}`, 0],
  },

  blockquote: {
    group: "block",
    content: "text*",
    marks: "",
    // The node contains authored multiline Markdown rather than rendered
    // inline content. This makes DOM change parsing preserve native
    // <div>/<br> line boundaries produced while editing an empty quote line.
    code: true,
    defining: true,
    attrs: {
      // Presentation-only. The complete authored quote source always stays
      // in textContent; entering the Live editing state never replaces the node.
      liveSyntaxState: { default: LIVE_SYNTAX_RENDERING },
    },
    parseDOM: [{
      tag: "pre[data-source-blockquote]",
      preserveWhitespace: "full",
      getAttrs: (el) => ({
        liveSyntaxState: (el as HTMLElement).getAttribute("data-live-syntax-state") === LIVE_SYNTAX_EDITING
          ? LIVE_SYNTAX_EDITING
          : LIVE_SYNTAX_RENDERING,
      }),
    }],
    toDOM: (node) => ["pre", {
      "data-source-blockquote": "1",
      "data-live-syntax-state": node.attrs.liveSyntaxState,
    }, ["code", 0]],
  },

  code_block: {
    group: "block",
    content: "text*",
    marks: "",
    code: true,
    defining: true,
    attrs: {
      lang: { default: "" },
      // Transient Live-mode presentation state only. textContent always keeps
      // the complete fenced Markdown source regardless of this value.
      liveSyntaxState: { default: LIVE_SYNTAX_RENDERING },
    },
    parseDOM: [
      {
        tag: "pre",
        preserveWhitespace: "full",
        getAttrs: (el) => ({
          lang: (el as HTMLElement).getAttribute("data-lang") ?? "",
          liveSyntaxState: (el as HTMLElement).getAttribute("data-live-syntax-state") === LIVE_SYNTAX_EDITING
            ? LIVE_SYNTAX_EDITING
            : LIVE_SYNTAX_RENDERING,
        }),
      },
    ],
    toDOM: (node) => {
      const attrs: Record<string, string> = {};
      if (node.attrs.lang) attrs["data-lang"] = node.attrs.lang as string;
      attrs["data-live-syntax-state"] = node.attrs.liveSyntaxState as string;
      return ["pre", attrs, ["code", 0]];
    },
  },

  horizontal_rule: {
    group: "block",
    attrs: { markup: { default: "---" } },
    parseDOM: [{ tag: "hr" }],
    toDOM: () => ["hr"],
  },

  bullet_list: {
    group: "block",
    content: "list_item+",
    parseDOM: [{ tag: "ul" }],
    toDOM: () => ["ul", 0],
  },

  ordered_list: {
    group: "block",
    content: "list_item+",
    attrs: { start: { default: 1 } },
    parseDOM: [
      {
        tag: "ol",
        getAttrs: (el) => {
          const start = (el as HTMLElement).getAttribute("start");
          return { start: start ? Number(start) : 1 };
        },
      },
    ],
    toDOM: (node) => {
      const start = node.attrs.start as number;
      return ["ol", start === 1 ? {} : { start }, 0];
    },
  },

  list_item: {
    content: "paragraph block*",
    defining: true,
    attrs: {
      // Presentation-only count of authored blank rows immediately before
      // this item. CommonMark keeps blank-line-separated bullets in one list,
      // so the derived list tree needs this hint to display those rows rather
      // than visually collapsing every item together.
      sourceGapBefore: { default: 0 },
    },
    parseDOM: [{
      tag: "li",
      getAttrs: (el) => ({
        sourceGapBefore: Number.parseInt(
          (el as HTMLElement).getAttribute("data-source-gap-before") ?? "0",
          10,
        ) || 0,
      }),
    }],
    toDOM: (node) => {
      const sourceGapBefore = Math.max(0, Number(node.attrs.sourceGapBefore) || 0);
      return ["li", sourceGapBefore > 0 ? {
        "data-source-gap-before": String(sourceGapBefore),
        style: `--source-gap-before: ${sourceGapBefore}`,
      } : {}, 0];
    },
  },

  text: { group: "inline" },

  hard_break: {
    group: "inline",
    inline: true,
    selectable: false,
    attrs: { eol: { default: "\n" } },
    parseDOM: [{ tag: "br" }],
    toDOM: () => ["br"],
  },
};

const coreMarks: Record<string, MarkSpec> = {};

function withSourceRangeAttrs(nodes: Record<string, NodeSpec>): Record<string, NodeSpec> {
  return Object.fromEntries(Object.entries(nodes).map(([name, spec]) => {
    if (!(spec.group ?? "").split(/\s+/).includes("block")) return [name, spec];
    return [name, {
      ...spec,
      attrs: {
        ...(spec.attrs ?? {}),
        [SOURCE_FROM_ATTR]: { default: null },
        [SOURCE_TO_ATTR]: { default: null },
        [SOURCE_TEXT_ATTR]: { default: null },
        [SOURCE_FINGERPRINT_ATTR]: { default: null },
      },
    } satisfies NodeSpec];
  }));
}

const nodes = withSourceRangeAttrs({ ...coreNodes, ...collectNodes() });
const marks = { ...coreMarks, ...collectMarks() };

export const schema = new Schema({ nodes, marks });
