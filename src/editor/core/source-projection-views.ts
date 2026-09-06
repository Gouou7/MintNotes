import { DOMSerializer, type Node as PMNode, type Schema } from "prosemirror-model";
import { Plugin } from "prosemirror-state";
import type { NodeView } from "prosemirror-view";

/** Source provenance changes on every edit; it must not replace a native text surface. */
export function sourceProjectionViews(schema: Schema): Plugin {
  const names = ["paragraph", "heading", "bullet_list", "ordered_list", "list_item", "quote_container", "table", "table_row", "table_cell", "source_block", "source_gap", "front_matter"];
  return new Plugin({ props: { nodeViews: Object.fromEntries(names.map((name) => [name, (node: PMNode): NodeView => {
    const render = (value: PMNode) => DOMSerializer.renderSpec(document, schema.nodes[name]!.spec.toDOM!(value));
    const initial = render(node);
    let previous = new Map(initial.dom instanceof HTMLElement ? initial.dom.getAttributeNames().map((name) => [name, (initial.dom as HTMLElement).getAttribute(name)!]) : []);
    return {
      dom: initial.dom, contentDOM: initial.contentDOM,
      update(next) {
        if (next.type !== node.type) return false;
        const nextDOM = render(next).dom;
        if (!(initial.dom instanceof HTMLElement) || !(nextDOM instanceof HTMLElement) || initial.dom.tagName !== nextDOM.tagName) return false;
        const attributes = new Map(nextDOM.getAttributeNames().map((name) => [name, nextDOM.getAttribute(name)!]));
        for (const name of previous.keys()) if (!attributes.has(name)) initial.dom.removeAttribute(name);
        for (const [name, value] of attributes) if (previous.get(name) !== value) initial.dom.setAttribute(name, value);
        previous = attributes;
        node = next;
        return true;
      },
    };
  }])) } });
}
