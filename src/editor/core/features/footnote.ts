import type { Node as PMNode } from "prosemirror-model";
import { Plugin, type EditorState } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

import { navigateToDocumentFragment } from "../fragment-navigation";
import type { FeatureSpec } from "./_types";

const DEFINITION_RE = /(^|\n)( {0,3})\[\^([^\]\r\n]+)\]:[\t ]*/g;
const REFERENCE_RE = /\[\^([^\]\r\n]+)\]/g;
let nextFootnoteScope = 0;

interface Definition {
  label: string;
  markerFrom: number;
  markerTo: number;
  contentTo: number;
}

interface Reference {
  label: string;
  from: number;
  to: number;
  number: number;
  occurrence: number;
  id: string;
}

function normalizeLabel(label: string): string {
  return label.trim().replace(/[\t\n\r ]+/g, " ").toLowerCase();
}

function isEscaped(text: string, offset: number): boolean {
  let slashes = 0;
  for (let index = offset - 1; index >= 0 && text[index] === "\\"; index -= 1) slashes += 1;
  return slashes % 2 === 1;
}

function rangeHasMark(doc: PMNode, from: number, to: number, markName: string): boolean {
  let found = false;
  doc.nodesBetween(from, to, (node) => {
    if (node.isText && node.marks.some((mark) => mark.type.name === markName)) found = true;
    return !found;
  });
  return found;
}

function textblocks(doc: PMNode): Array<{ node: PMNode; position: number }> {
  const found: Array<{ node: PMNode; position: number }> = [];
  doc.descendants((node, position) => {
    if (node.isTextblock && !["code_block", "source_block", "source_gap"].includes(node.type.name)) {
      found.push({ node, position });
      return false;
    }
    return true;
  });
  return found;
}

function collectDefinitions(doc: PMNode): Map<string, Definition> {
  const definitions = new Map<string, Definition>();
  for (const { node, position } of textblocks(doc)) {
    const matches: Array<{ label: string; markerFrom: number; markerTo: number }> = [];
    DEFINITION_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = DEFINITION_RE.exec(node.textContent))) {
      const label = normalizeLabel(match[3]!);
      if (!label || definitions.has(label)) continue;
      const localFrom = match.index + match[1]!.length + match[2]!.length;
      matches.push({
        label,
        markerFrom: position + 1 + localFrom,
        markerTo: position + 1 + match.index + match[0].length,
      });
    }
    matches.forEach((definition, index) => {
      definitions.set(definition.label, {
        ...definition,
        contentTo: index + 1 < matches.length
          ? matches[index + 1]!.markerFrom - 1
          : position + 1 + node.content.size,
      });
    });
  }
  return definitions;
}

function collectReferences(
  doc: PMNode,
  definitions: ReadonlyMap<string, Definition>,
  scope: string,
): { references: Reference[]; numbers: Map<string, number> } {
  const references: Reference[] = [];
  const numbers = new Map<string, number>();
  const occurrences = new Map<string, number>();

  for (const { node, position } of textblocks(doc)) {
    REFERENCE_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = REFERENCE_RE.exec(node.textContent))) {
      if (isEscaped(node.textContent, match.index)) continue;
      const label = normalizeLabel(match[1]!);
      const definition = definitions.get(label);
      if (!definition) continue;
      const from = position + 1 + match.index;
      const to = from + match[0].length;
      if (from === definition.markerFrom || rangeHasMark(doc, from, to, "code")) continue;
      const number = numbers.get(label) ?? numbers.size + 1;
      numbers.set(label, number);
      const occurrence = (occurrences.get(label) ?? 0) + 1;
      occurrences.set(label, occurrence);
      references.push({
        label,
        from,
        to,
        number,
        occurrence,
        id: `${scope}-fnref-${number}${occurrence > 1 ? `-${occurrence}` : ""}`,
      });
    }
  }
  return { references, numbers };
}

function navigationLink(
  rootClass: string,
  href: string,
  text: string,
  attributes: Record<string, string>,
): HTMLAnchorElement {
  const link = document.createElement("a");
  link.href = href;
  link.textContent = text;
  for (const [name, value] of Object.entries(attributes)) link.setAttribute(name, value);
  link.addEventListener("mousedown", (event) => event.preventDefault());
  link.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const root = link.closest<HTMLElement>(rootClass);
    if (root) navigateToDocumentFragment(root, href);
  });
  return link;
}

function referenceWidget(scope: string, reference: Reference, definitionId: string): HTMLElement {
  const sup = document.createElement("sup");
  sup.className = "live-footnote-reference";
  sup.setAttribute("contenteditable", "false");
  sup.appendChild(navigationLink(
    ".ProseMirror",
    `#${definitionId}`,
    String(reference.number),
    {
      id: reference.id,
      "data-footnote-ref": "true",
      "aria-label": `Footnote ${reference.number}`,
      "data-footnote-scope": scope,
    },
  ));
  return sup;
}

function definitionWidget(
  scope: string,
  definitionId: string,
  number: number,
  firstReferenceId: string,
  sourceActive: boolean,
): HTMLElement {
  const target = document.createElement("span");
  target.id = definitionId;
  target.className = "live-footnote-definition";
  target.setAttribute("data-footnote-definition", "true");
  target.setAttribute("data-footnote-number", String(number));
  target.setAttribute("data-footnote-scope", scope);
  target.setAttribute("contenteditable", "false");
  if (!sourceActive) {
    target.appendChild(navigationLink(
      ".ProseMirror",
      `#${firstReferenceId}`,
      `${number}.`,
      { class: "live-footnote-definition-number" },
    ));
  }
  return target;
}

function backlinksWidget(references: readonly Reference[]): HTMLElement {
  const sup = document.createElement("sup");
  sup.className = "live-footnote-backlinks";
  sup.setAttribute("contenteditable", "false");
  references.forEach((reference, index) => {
    sup.appendChild(navigationLink(
      ".ProseMirror",
      `#${reference.id}`,
      "↩",
      {
        "data-footnote-backref": "",
        "aria-label": `Back to reference ${index + 1}`,
      },
    ));
  });
  return sup;
}

function buildFootnoteDecorations(state: EditorState, scope: string): DecorationSet {
  const definitions = collectDefinitions(state.doc);
  const { references, numbers } = collectReferences(state.doc, definitions, scope);
  if (references.length === 0) return DecorationSet.empty;
  const cursor = state.selection.empty ? state.selection.from : null;
  const decorations: Decoration[] = [];

  for (const reference of references) {
    const definitionId = `${scope}-fn-${reference.number}`;
    const sourceActive = cursor !== null && cursor >= reference.from && cursor <= reference.to;
    decorations.push(Decoration.inline(reference.from, reference.to, {
      class: sourceActive ? "syntax-hint" : "syntax-hidden",
    }));
    if (!sourceActive) {
      decorations.push(Decoration.widget(
        reference.from,
        () => referenceWidget(scope, reference, definitionId),
        {
          side: -1,
          key: `${reference.id}-widget`,
          ignoreSelection: true,
          stopEvent: () => true,
        },
      ));
    }
  }

  for (const [label, number] of numbers) {
    const definition = definitions.get(label)!;
    const calls = references.filter((reference) => reference.label === label);
    const sourceActive = cursor !== null
      && cursor >= definition.markerFrom
      && cursor <= definition.contentTo;
    const definitionId = `${scope}-fn-${number}`;
    decorations.push(Decoration.inline(definition.markerFrom, definition.markerTo, {
      class: sourceActive ? "syntax-hint" : "syntax-hidden",
    }));
    decorations.push(Decoration.widget(
      definition.markerFrom,
      () => definitionWidget(scope, definitionId, number, calls[0]!.id, sourceActive),
      {
        side: -1,
        key: `${definitionId}-target-${sourceActive ? "source" : "rendered"}`,
        ignoreSelection: true,
        stopEvent: () => true,
      },
    ));
    if (!sourceActive) {
      decorations.push(Decoration.widget(
        definition.contentTo,
        () => backlinksWidget(calls),
        {
          side: 1,
          key: `${definitionId}-backlinks`,
          ignoreSelection: true,
          stopEvent: () => true,
        },
      ));
    }
  }

  return DecorationSet.create(state.doc, decorations);
}

function footnotePresentationPlugin(): Plugin<DecorationSet> {
  const scope = `mint-live-footnote-${++nextFootnoteScope}`;
  return new Plugin<DecorationSet>({
    state: {
      init: (_, state) => buildFootnoteDecorations(state, scope),
      apply: (_transaction, _previous, _oldState, newState) => buildFootnoteDecorations(newState, scope),
    },
    props: {
      decorations(state) {
        return this.getState(state);
      },
    },
  });
}

export const footnote: FeatureSpec = {
  name: "footnote",
  protectParserSource: (line) => {
    const definition = /^( {0,3})\[\^([^\]\r\n]+)\]:/.exec(line);
    return definition ? [definition[1]!.length] : [];
  },
  plugins: () => [footnotePresentationPlugin()],
};
