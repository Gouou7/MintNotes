import { describe, expect, it } from "vitest";
import {
  calloutDefinition,
  canonicalizeCalloutsFromLive,
  materializeCalloutsForLive,
  parseCalloutMarker
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
    expect(parseCalloutMarker("==`[!TIP]+ Expanded`==")).toMatchObject({
      kind: "tip",
      title: "Expanded",
      fold: "+"
    });
  });

  it("round-trips live markers without leaking highlight or backslash syntax", () => {
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
    expect(materialized).toContain("> ==`[!TIP]`==");
    expect(materialized).toContain("> > ==`[!WARNING]- Nested`==");
    expect(materialized).toContain("> [!NOTE]");
    expect(canonicalizeCalloutsFromLive(materialized)).toBe(source);
    expect(canonicalizeCalloutsFromLive("> \\[!CAUTION\\]\n> Body")).toBe("> [!CAUTION]\n> Body");

    const backtickTitle = "> [!NOTE] Use `code`\n> Body";
    expect(canonicalizeCalloutsFromLive(materializeCalloutsForLive(backtickTitle))).toBe(backtickTitle);
  });
});
