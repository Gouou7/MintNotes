import { describe, expect, it } from "vitest";
import type { Node as PMNode } from "prosemirror-model";

import { parse, ParserState } from "./parser";
import { schema } from "./schema";
import { serialize } from "./serializer";
import { withLineEndingVariants } from "./source-fidelity-fixtures";
import { SourcePositionMap } from "./source-position-map";

const quotedBlocks = [
  "> -", "> - ", "> *", "> +", "> 1.", "> 1)",
  "> - body", "> 07) body", "> - [ ] task",
  "> - first\n> - second",
  "> - first\n>     - nested\n>     - ",
  "> first\n> - item\n> continued\n>\n> last",
  ">\n> - item\n>",
  "> ```", "> ```ts\n> body\n> ```",
  "> ```ts\n> body\n>\n>",
  ">     code\n>     next",
  "> ---", "> ***", "> # heading", "> title\n> ===",
  "> | a | b |\n> | --- | --- |\n> | x | y |",
];

const containerSources = quotedBlocks.flatMap((quote) => [
  quote,
  `before\n\n${quote}\n\nafter`,
  quote.split("\n").map((line) => `> ${line}`).join("\n"),
  `- ${quote.split("\n").join("\n  ")}`,
]).flatMap(withLineEndingVariants);

function assertQuoteOwnership(node: PMNode, source: string): void {
  if (["quote_container", "list_item"].includes(node.type.name)) {
    let cursor = node.attrs.sourceFrom as number;
    node.forEach((child) => {
      if (child.type.name === "paragraph" && !child.content.size && child.attrs.sourceFrom === null) return;
      expect(child.attrs.sourceFrom, `${child.type.name} in ${source}`).toBe(cursor);
      expect(child.attrs.sourceTo).toBeGreaterThanOrEqual(cursor);
      expect(child.attrs.sourceText).toBe(source.slice(cursor, child.attrs.sourceTo));
      cursor = child.attrs.sourceTo as number;
    });
    expect(cursor).toBe(node.attrs.sourceTo);
  }
  node.forEach((child) => assertQuoteOwnership(child, source));
}

describe("container source ownership", () => {
  it.each(["missing", "overlapping", "outside"])(
    "falls back to one exact source surface when child provenance is %s",
    (invalidRange) => {
      const source = "> first\n> second";
      const state = new ParserState();
      state.openNode(schema.nodes.quote_container, { sourceFrom: 0, sourceTo: source.length, sourceText: source });
      state.push(schema.nodes.paragraph.createChecked(
        { sourceFrom: 0, sourceTo: 7, sourceText: "> first" }, schema.text("> first"),
      ));
      const attrs = invalidRange === "missing" ? {}
        : { sourceFrom: invalidRange === "overlapping" ? 0 : 8, sourceTo: source.length + (invalidRange === "outside" ? 1 : 0) };
      state.push(schema.nodes.paragraph.createChecked(attrs, schema.text("> second")));
      state.closeNode();
      const doc = state.finish();
      expect(doc.firstChild?.type.name).toBe("source_block");
      expect(doc.textContent).toBe(source);
      const positions = SourcePositionMap.fromDocument(doc, source);
      for (let offset = 0; offset <= source.length; offset++) {
        expect(positions.hasExactSourceBoundary(offset)).toBe(true);
        expect(positions.documentToSource(positions.sourceToDocument(offset))).toBe(offset);
      }
    },
  );

  it.each(containerSources)("assigns each quoted source range once for %j", (source) => {
    const doc = parse(source);
    assertQuoteOwnership(doc, source);
    expect(serialize(doc)).toBe(source);
  });

  it.each([
    "> -", "> - ", "> 1.", "> 1)", "> - body", "> > -", "- > -",
    ">\n> - item\n>", "> - first\n>\n> - second",
    "> first\n> - item\n> continued\n>\n> last",
    "> - first\n>     - nested\n>     - ",
  ].flatMap(withLineEndingVariants))(
    "projects one copy of list text and maps every authored boundary for %j",
    (source) => {
      const doc = parse(source);
      let projectedSource = "";
      doc.descendants((node) => {
        if (node.isText) projectedSource += node.text;
        if (node.type.name === "source_gap_eol") projectedSource += node.attrs.character;
      });
      // Adjacent list items are separate block rows; their sole separating
      // line ending may be represented by the neighboring source boundaries.
      expect(projectedSource.replaceAll(/\r\n|\r|\n/g, "")).toBe(source.replaceAll(/\r\n|\r|\n/g, ""));
      const positions = SourcePositionMap.fromDocument(doc, source);
      for (let offset = 0; offset <= source.length; offset++) {
        expect(positions.hasExactSourceBoundary(offset)).toBe(true);
        for (const affinity of ["left", "right"] as const) {
          expect(positions.documentToSource(positions.sourceToDocument(offset, affinity))).toBe(offset);
        }
      }
    },
  );
});
