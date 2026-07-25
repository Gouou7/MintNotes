import { describe, expect, it } from "vitest";
import {
  calloutDefinition,
  canonicalizeCalloutsFromLive,
  materializeCalloutsForLive,
  parseCalloutMarker,
  removeCalloutAtIndex
} from "./callouts";

describe("callouts", () => {
  it("maps common aliases and keeps unknown types usable", () => {
    expect(calloutDefinition("TIP")).toEqual({ kind: "tip", title: "Tip" });
    expect(calloutDefinition("tldr")).toEqual({ kind: "abstract", title: "Abstract" });
    expect(calloutDefinition("attention")).toEqual({ kind: "warning", title: "Warning" });
    expect(calloutDefinition("my-kind")).toEqual({ kind: "custom", title: "My Kind" });
  });

  it("parses titles and fold markers case-insensitively", () => {
    expect(parseCalloutMarker("[!IMPORTANT]")).toMatchObject({ kind: "important", title: "Important", fold: "" });
    expect(parseCalloutMarker("[!faq]- Common question")).toMatchObject({
      kind: "question",
      title: "Common question",
      fold: "-"
    });
    expect(parseCalloutMarker("[!TIP]+ Expanded")).toMatchObject({
      kind: "tip",
      title: "Expanded",
      fold: "+"
    });
  });

  it("round-trips canonical live markers without highlight or backslash syntax", () => {
    const source = [
      "> [!TIP]",
      "> Tip",
      "",
      "> > [!WARNING]- Nested",
      "> > Body",
      "",
      "> ```md",
      "> [!NOTE]",
      "> ```"
    ].join("\n");
    const materialized = materializeCalloutsForLive(source);
    expect(materialized).toContain("> [!TIP]\n>\n> Tip");
    expect(materialized).toContain("> > [!WARNING]- Nested\n> >\n> > Body");
    expect(materialized).toContain("> [!NOTE]");
    expect(materialized).not.toContain("==`");
    expect(canonicalizeCalloutsFromLive(materialized)).toBe(source);
    expect(canonicalizeCalloutsFromLive("> \\[!CAUTION\\]\n> Body")).toBe("> [!CAUTION]\n> Body");
    expect(canonicalizeCalloutsFromLive("\\> \\[!NOTE\\]")).toBe("> [!NOTE]\n> ");

    const backtickTitle = "> [!NOTE] Use `code`\n> Body";
    expect(canonicalizeCalloutsFromLive(materializeCalloutsForLive(backtickTitle))).toBe(backtickTitle);
  });

  it("keeps an editable empty body after the last live callout line is deleted", () => {
    const deletedLiveBody = "> [!NOTE]";
    const canonical = canonicalizeCalloutsFromLive(deletedLiveBody);

    expect(canonical).toBe("> [!NOTE]\n> ");
    expect(materializeCalloutsForLive(canonical)).toBe("> [!NOTE]\n>\n> \u2060");
    expect(canonicalizeCalloutsFromLive(materializeCalloutsForLive(canonical))).toBe(canonical);
  });

  it("repairs the removed highlight workaround without ever generating it", () => {
    expect(canonicalizeCalloutsFromLive("> ==`[!WARNING]`=")).toBe("> [!WARNING]\n> ");
    expect(canonicalizeCalloutsFromLive("> ==`[!WARNING]`==")).toBe("> [!WARNING]\n> ");
    expect(materializeCalloutsForLive("> ==`[!WARNING]`=\n> Body")).toBe("> [!WARNING]\n>\n> Body");
    expect(materializeCalloutsForLive("> [!WARNING]\n> Body")).not.toContain("==`");
  });

  it("preserves authored blank quote lines and leaves ordinary blockquotes unchanged", () => {
    const callout = "> [!NOTE]\n> \n> Body";
    expect(canonicalizeCalloutsFromLive(materializeCalloutsForLive(callout))).toBe(callout);
    expect(materializeCalloutsForLive("> Ordinary\n> quote")).toBe("> Ordinary\n> quote");
  });

  it("removes a selected callout block and returns the next caret offset", () => {
    const source = [
      "Before",
      "",
      "> [!NOTE]",
      "> Body",
      "",
      "After"
    ].join("\n");

    expect(removeCalloutAtIndex(source, 0)).toEqual({
      markdown: "Before\n\nAfter",
      offset: "Before\n\n".length
    });
    expect(removeCalloutAtIndex(source, 1)).toBeNull();
  });

  it("removes only the selected nested callout", () => {
    const source = [
      "> [!NOTE]",
      "> Outer",
      "> > [!WARNING]",
      "> > Nested",
      "> Tail"
    ].join("\n");

    expect(removeCalloutAtIndex(source, 1)?.markdown).toBe([
      "> [!NOTE]",
      "> Outer",
      "> Tail"
    ].join("\n"));
  });
});
