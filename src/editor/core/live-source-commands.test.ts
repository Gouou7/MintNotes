import { describe, expect, it } from "vitest";

import { liveSourceKeyTransaction } from "./live-source-commands";
import { CanonicalSource } from "./source";

function press(
  source: string,
  offset: number,
  key: "Enter" | "Backspace" | "Delete" | "Tab",
  shiftKey = false,
): string {
  const transaction = liveSourceKeyTransaction(
    source,
    { anchor: offset, head: offset },
    key,
    shiftKey,
  );
  return transaction ? new CanonicalSource(source).apply(transaction).source.value : source;
}

describe("canonical Live source commands", () => {
  it("inserts one soft source line break and a Markdown hard break for Shift+Enter", () => {
    expect(press("ab", 1, "Enter")).toBe("a\nb");
    expect(press("ab", 1, "Enter", true)).toBe("a  \nb");
  });

  it("deletes exactly one authored character across line boundaries", () => {
    expect(press("a\nb", 2, "Backspace")).toBe("ab");
    expect(press("a\n\nb", 1, "Delete")).toBe("a\nb");
    expect(press("a\n\nb", 3, "Backspace")).toBe("a\nb");
  });

  it.each([
    ["- item", "- item\n- "],
    ["* item", "* item\n* "],
    ["+ item", "+ item\n+ "],
    ["7. item", "7. item\n8. "],
    ["7) item", "7) item\n8) "],
    ["- [x] item", "- [x] item\n- [ ] "],
  ])("continues the authored list spelling for %s", (source, expected) => {
    expect(press(source, source.length, "Enter")).toBe(expected);
  });

  it("exits empty lists and quotes by removing only their current prefix", () => {
    expect(press("- ", 2, "Enter")).toBe("");
    expect(press("3. ", 3, "Enter")).toBe("");
    expect(press("- [ ] ", 6, "Enter")).toBe("");
    expect(press("> ", 2, "Enter")).toBe("");
  });

  it("continues quotes with their exact authored nesting prefix", () => {
    expect(press("> quote", 7, "Enter")).toBe("> quote\n> ");
    expect(press("> > nested", 10, "Enter")).toBe("> > nested\n> > ");
    expect(press(">", 1, "Enter")).toBe(">\n>");
  });

  it("indents and outdents list source instead of applying presentation-only margins", () => {
    expect(press("- item", 6, "Tab")).toBe("  - item");
    expect(press("  - item", 8, "Tab", true)).toBe("- item");
    expect(press("1. item", 7, "Tab")).toBe("   1. item");
  });
});
