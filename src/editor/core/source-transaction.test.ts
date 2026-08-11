import { describe, expect, it } from "vitest";
import { EditorState, TextSelection, type Transaction } from "prosemirror-state";
import { splitBlock } from "prosemirror-commands";

import { parse } from "./parser";
import { schema } from "./schema";
import { SourcePositionMap } from "./source-position-map";
import { transactionSourceEffect } from "./source-transaction";

function stateFor(source: string): EditorState {
  return EditorState.create({ schema, doc: parse(source) });
}

describe("ProseMirror to canonical source transactions", () => {
  it("maps a paragraph split to one canonical blank-line insertion", () => {
    const source = "abc";
    let state = stateFor(source);
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 2)));
    let transaction: Transaction | undefined;
    expect(splitBlock(state, (next) => { transaction = next; })).toBe(true);
    expect(transaction).toBeDefined();
    expect(transactionSourceEffect(transaction!, source)).toEqual({
      kind: "source",
      transaction: {
        edits: [{ from: 1, to: 1, insert: "\n\n" }],
        selection: { anchor: 3, head: 3 },
        origin: "input",
      },
      reparseDerivedDocument: true,
    });
  });
  it("infers one exact text insertion in repeated source", () => {
    const source = "repeat\n\nrepeat";
    const state = stateFor(source);
    const sourceOffset = source.lastIndexOf("peat") + 2;
    const position = SourcePositionMap.fromDocument(state.doc, source).sourceToDocument(sourceOffset);
    const transaction = state.tr.insertText("X", position);
    expect(transactionSourceEffect(transaction, source)).toEqual({
      kind: "source",
      transaction: {
        edits: [{ from: sourceOffset, to: sourceOffset, insert: "X" }],
        selection: { anchor: sourceOffset + 1, head: sourceOffset + 1 },
        origin: "input",
      },
    });
  });

  it.each([
    ["#  heading ##", "heading", 4],
    ["* first\n+ second", "second", 3],
    ["| a | b |\n| --- | --- |\n| x | y |", "y", 0],
  ] as const)("isolates an insertion in %s", (source, needle, offsetInNeedle) => {
    const state = stateFor(source);
    const sourceOffset = source.indexOf(needle) + offsetInNeedle;
    const position = SourcePositionMap.fromDocument(state.doc, source)
      .sourceToDocument(sourceOffset);
    const effect = transactionSourceEffect(state.tr.insertText("X", position), source);
    expect(effect).toMatchObject({
      kind: "source",
      transaction: {
        edits: [{ from: sourceOffset, to: sourceOffset, insert: "X" }],
      },
    });
  });

  it("infers deletion inside an authored whitespace gap", () => {
    const source = "a\n \n\tb";
    const state = stateFor(source);
    const from = source.indexOf(" ");
    const positions = SourcePositionMap.fromDocument(state.doc, source);
    const transaction = state.tr.delete(
      positions.sourceToDocument(from),
      positions.sourceToDocument(from + 1),
    );
    expect(transactionSourceEffect(transaction, source)).toMatchObject({
      kind: "source",
      transaction: { edits: [{ from, to: from + 1, insert: "" }] },
      reparseDerivedDocument: true,
    });
  });

  it("reparses text inserted into an authored blank line", () => {
    const source = "a\n\nb";
    const state = stateFor(source);
    const sourceOffset = 2;
    const position = SourcePositionMap.fromDocument(state.doc, source)
      .sourceToDocument(sourceOffset);
    expect(transactionSourceEffect(state.tr.insertText("x", position), source)).toEqual({
      kind: "source",
      transaction: {
        edits: [{ from: sourceOffset, to: sourceOffset, insert: "x" }],
        selection: { anchor: sourceOffset + 1, head: sourceOffset + 1 },
        origin: "input",
      },
      reparseDerivedDocument: true,
    });
  });

  it("treats mark-only normalization as presentation state", () => {
    const source = "plain";
    const state = stateFor(source);
    const mark = schema.marks.em.create();
    expect(transactionSourceEffect(state.tr.addMark(1, 3, mark), source)).toEqual({
      kind: "presentation",
    });
  });
});
