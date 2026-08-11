import { Schema, type NodeSpec, type MarkSpec } from "prosemirror-model";

import { collectMarks, collectNodes } from "./features/index";
import {
  SOURCE_FINGERPRINT_ATTR,
  SOURCE_FROM_ATTR,
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
    parseDOM: [{
      tag: "pre[data-source-gap]",
      preserveWhitespace: "full",
    }],
    toDOM: () => ["pre", { "data-source-gap": "1", "aria-hidden": "true" }, ["code", 0]],
  },

  // Line-ending characters inside a source gap need stable document
  // positions without letting <pre> turn the structural separators on both
  // sides of a Markdown block boundary into additional visible rows. Each
  // atom owns exactly one canonical character. Only atoms representing an
  // authored blank row render a <br>; boundary atoms remain zero-width.
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
    },
    parseDOM: [{
      tag: "pre[data-source-block]",
      preserveWhitespace: "full",
      getAttrs: (el) => ({
        kind: (el as HTMLElement).getAttribute("data-source-kind") ?? "block",
      }),
    }],
    toDOM: (node) => ["pre", {
      "data-source-block": "1",
      "data-source-kind": node.attrs.kind as string,
    }, ["code", 0]],
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
      // in textContent; activating Live source never replaces the node.
      sourceEditing: { default: false },
    },
    parseDOM: [{
      tag: "pre[data-source-blockquote]",
      preserveWhitespace: "full",
      getAttrs: (el) => ({
        sourceEditing: (el as HTMLElement).getAttribute("data-source-editing") === "1",
      }),
    }],
    toDOM: (node) => ["pre", {
      "data-source-blockquote": "1",
      ...(node.attrs.sourceEditing ? { "data-source-editing": "1" } : {}),
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
      sourceEditing: { default: false },
    },
    parseDOM: [
      {
        tag: "pre",
        preserveWhitespace: "full",
        getAttrs: (el) => ({
          lang: (el as HTMLElement).getAttribute("data-lang") ?? "",
          sourceEditing: (el as HTMLElement).getAttribute("data-source-editing") === "1",
        }),
      },
    ],
    toDOM: (node) => {
      const attrs: Record<string, string> = {};
      if (node.attrs.lang) attrs["data-lang"] = node.attrs.lang as string;
      if (node.attrs.sourceEditing) attrs["data-source-editing"] = "1";
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
    parseDOM: [{ tag: "li" }],
    toDOM: () => ["li", 0],
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
