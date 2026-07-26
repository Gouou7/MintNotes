import { describe, expect, it } from "vitest";
import {
  calloutTitleSourceRange,
  calloutDefinition,
  canonicalizeCalloutsFromLive,
  collapseEmptyCalloutBodyForMarkerEdit,
  materializeCalloutsForLive,
  parseCalloutMarker
} from "./callouts";

describe("callouts", () => {
  it("maps every official Obsidian type and alias while keeping unknown types usable", () => {
    const officialTypes = [
      ["note", "note"],
      ["abstract", "abstract"],
      ["summary", "abstract"],
      ["tldr", "abstract"],
      ["info", "info"],
      ["todo", "todo"],
      ["tip", "tip"],
      ["hint", "tip"],
      ["important", "tip"],
      ["success", "success"],
      ["check", "success"],
      ["done", "success"],
      ["question", "question"],
      ["help", "question"],
      ["faq", "question"],
      ["warning", "warning"],
      ["caution", "warning"],
      ["attention", "warning"],
      ["failure", "failure"],
      ["fail", "failure"],
      ["missing", "failure"],
      ["danger", "danger"],
      ["error", "danger"],
      ["bug", "bug"],
      ["example", "example"],
      ["quote", "quote"],
      ["cite", "quote"]
    ] as const;

    for (const [type, kind] of officialTypes) {
      expect(calloutDefinition(type).kind, type).toBe(kind);
    }
    expect(calloutDefinition("TIP")).toEqual({ kind: "tip", title: "Tip" });
    expect(calloutDefinition("tldr")).toEqual({ kind: "abstract", title: "TLDR" });
    expect(calloutDefinition("attention")).toEqual({ kind: "warning", title: "Attention" });
    expect(calloutDefinition("my-kind")).toEqual({ kind: "custom", title: "My Kind" });
  });

  it("parses titles and fold markers case-insensitively", () => {
    expect(parseCalloutMarker("[!IMPORTANT]")).toMatchObject({ kind: "tip", title: "Important", fold: "" });
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
    expect(parseCalloutMarker("[!TIP]+ Styled {color=purple icon=important}")).toMatchObject({
      kind: "tip",
      title: "Styled",
      fold: "+",
      color: "purple",
      icon: "important"
    });
    expect(parseCalloutMarker("[!TIP] Literal {unknown=value}")).toMatchObject({
      title: "Literal {unknown=value}",
      color: undefined,
      icon: undefined
    });
  });

  it("locates only the visible authored title inside a marker line", () => {
    expect(calloutTitleSourceRange("[!NOTE] Related")).toEqual({ start: 8, end: 15 });
    expect(calloutTitleSourceRange("[!TIP]+ Styled {color=purple icon=important}")).toEqual({
      start: 8,
      end: 14
    });
    expect(calloutTitleSourceRange("[!TIP] Literal {unknown=value}")).toEqual({
      start: 7,
      end: 30
    });
    expect(calloutTitleSourceRange("[!NOTE]")).toBeNull();
    expect(calloutTitleSourceRange("[!NOTE]   ")).toBeNull();
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
    const appearance = "> [!TIP] Styled {color=purple icon=important}\n> Body";
    expect(canonicalizeCalloutsFromLive(materializeCalloutsForLive(appearance))).toBe(appearance);
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

  it("collapses only a generated empty live body and returns the marker-end offset", () => {
    const canonical = [
      "Before",
      "",
      "> [!NOTE]",
      "> ",
      "",
      "After"
    ].join("\n");
    const live = materializeCalloutsForLive(canonical);

    expect(collapseEmptyCalloutBodyForMarkerEdit(live, 0)).toEqual({
      markdown: "Before\n\n> [!NOTE]\n\nAfter",
      offset: "Before\n\n> [!NOTE]".length
    });
    expect(collapseEmptyCalloutBodyForMarkerEdit(live, 1)).toBeNull();
    expect(collapseEmptyCalloutBodyForMarkerEdit(materializeCalloutsForLive("> [!NOTE]\n> Body"), 0)).toBeNull();
  });

  it("collapses only the selected nested empty live body", () => {
    const canonical = [
      "> [!NOTE]",
      "> Outer",
      "> > [!WARNING]",
      "> > ",
      "> Tail"
    ].join("\n");
    const live = materializeCalloutsForLive(canonical);

    expect(collapseEmptyCalloutBodyForMarkerEdit(live, 1)).toEqual({
      markdown: [
        "> [!NOTE]",
        ">",
        "> Outer",
        "> > [!WARNING]",
        "> Tail"
      ].join("\n"),
      offset: [
        "> [!NOTE]",
        ">",
        "> Outer",
        "> > [!WARNING]"
      ].join("\n").length
    });
    expect(collapseEmptyCalloutBodyForMarkerEdit(live, 0)).toBeNull();
    expect(canonicalizeCalloutsFromLive(live)).toBe([
      "> [!NOTE]",
      "> Outer",
      "> > [!WARNING]",
      "> > ",
      "> Tail"
    ].join("\n"));
  });
});
