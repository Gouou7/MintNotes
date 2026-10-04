import { describe, expect, it } from "vitest";

import { SourceComposition } from "./source-composition";

describe("IME source composition", () => {
  it("collapses changing Pinyin candidates into one exact source insertion", () => {
    const composition = new SourceComposition("前后", { anchor: 1, head: 1 });
    composition.apply({
      edits: [{ from: 1, to: 1, insert: "n" }],
      selection: { anchor: 2, head: 2 },
      origin: "input",
    });
    composition.apply({
      edits: [{ from: 1, to: 2, insert: "ni" }],
      selection: { anchor: 3, head: 3 },
      origin: "input",
    });
    composition.apply({
      edits: [{ from: 1, to: 3, insert: "你" }],
      selection: { anchor: 2, head: 2 },
      origin: "input",
    });

    expect(composition.source).toBe("前你后");
    expect(composition.transaction()).toEqual({
      edits: [{ from: 1, to: 1, insert: "你" }],
      selection: { anchor: 2, head: 2 },
      origin: "input",
    });
  });

  it("tracks replacement compositions in original canonical coordinates", () => {
    const composition = new SourceComposition("旧文字", { anchor: 0, head: 2 });
    composition.apply({
      edits: [{ from: 0, to: 2, insert: "xin" }],
      selection: { anchor: 3, head: 3 },
      origin: "input",
    });
    composition.apply({
      edits: [{ from: 0, to: 3, insert: "新" }],
      selection: { anchor: 1, head: 1 },
      origin: "input",
    });

    expect(composition.source).toBe("新字");
    expect(composition.transaction(true)).toEqual({
      edits: [{ from: 0, to: 2, insert: "新" }],
      selection: { anchor: 1, head: 1 },
      origin: "input",
      reparseDerivedDocument: true,
    });
  });

  it("produces no source edit when a composition is cancelled", () => {
    const composition = new SourceComposition("保留", { anchor: 2, head: 2 });
    composition.apply({
      edits: [{ from: 2, to: 2, insert: "x" }],
      selection: { anchor: 3, head: 3 },
      origin: "input",
    });
    composition.apply({
      edits: [{ from: 2, to: 3, insert: "" }],
      selection: { anchor: 2, head: 2 },
      origin: "delete",
    });

    expect(composition.source).toBe("保留");
    expect(composition.transaction()).toEqual({
      edits: [],
      selection: { anchor: 2, head: 2 },
      origin: "input",
    });
  });

  it("does not grant a DOM replacement ownership of the adjacent newline", () => {
    const composition = new SourceComposition("\n后文", { anchor: 0, head: 0 });
    composition.apply({ edits: [{ from: 0, to: 1, insert: "ni" }], selection: { anchor: 2, head: 2 }, origin: "input" });
    composition.confirm("你");
    expect(composition.transaction()).toEqual({
      edits: [{ from: 0, to: 0, insert: "你" }], selection: { anchor: 1, head: 1 }, origin: "input",
    });
  });

  it("uses the confirmed text even when the projected mutation cannot be mapped", () => {
    const composition = new SourceComposition("前后", { anchor: 1, head: 1 });
    composition.rejectNative();
    composition.confirm("确认");
    expect(composition.transaction().edits).toEqual([{ from: 1, to: 1, insert: "确认" }]);
    expect(composition.selection).toEqual({ anchor: 3, head: 3 });
  });

  it("keeps an explicit native deletion of the selected composition range", () => {
    const composition = new SourceComposition("前旧文后", { anchor: 1, head: 3 });
    composition.apply({ edits: [{ from: 1, to: 3, insert: "" }], selection: { anchor: 1, head: 1 }, origin: "delete" });
    composition.confirm("");
    expect(composition.transaction().edits).toEqual([{ from: 1, to: 3, insert: "" }]);
  });

  it("does not commit an unconfirmed projection repair without event text", () => {
    const composition = new SourceComposition("\n后文", { anchor: 0, head: 0 });
    composition.apply({ edits: [{ from: 0, to: 1, insert: "" }], selection: { anchor: 0, head: 0 }, origin: "delete" });
    expect(composition.transaction().edits).toEqual([]);
  });
});
