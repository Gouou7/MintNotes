import { describe, expect, it } from "vitest";
import { calloutDefinition, parseCalloutMarker } from "./callouts";

describe("callouts", () => {
  it("maps every official Obsidian type and alias while keeping unknown types usable", () => {
    const officialTypes = [
      ["note", "note"], ["abstract", "abstract"], ["summary", "abstract"],
      ["tldr", "abstract"], ["info", "info"], ["todo", "todo"],
      ["tip", "tip"], ["hint", "tip"], ["important", "tip"],
      ["success", "success"], ["check", "success"], ["done", "success"],
      ["question", "question"], ["help", "question"], ["faq", "question"],
      ["warning", "warning"], ["caution", "warning"], ["attention", "warning"],
      ["failure", "failure"], ["fail", "failure"], ["missing", "failure"],
      ["danger", "danger"], ["error", "danger"], ["bug", "bug"],
      ["example", "example"], ["quote", "quote"], ["cite", "quote"],
    ] as const;

    for (const [type, kind] of officialTypes) {
      expect(calloutDefinition(type).kind, type).toBe(kind);
    }
    expect(calloutDefinition("TIP")).toEqual({ kind: "tip", title: "Tip" });
    expect(calloutDefinition("tldr")).toEqual({ kind: "abstract", title: "TLDR" });
    expect(calloutDefinition("attention")).toEqual({ kind: "warning", title: "Attention" });
    expect(calloutDefinition("my-kind")).toEqual({ kind: "custom", title: "My Kind" });
  });

  it("parses titles, folds, and supported appearance attributes", () => {
    expect(parseCalloutMarker("[!IMPORTANT]")).toMatchObject({ kind: "tip", title: "Important", fold: "" });
    expect(parseCalloutMarker("[!faq]- Common question")).toMatchObject({
      kind: "question",
      title: "Common question",
      fold: "-",
    });
    expect(parseCalloutMarker("[!TIP]+ Styled {color=purple icon=important}")).toMatchObject({
      kind: "tip",
      title: "Styled",
      fold: "+",
      color: "purple",
      icon: "important",
    });
    expect(parseCalloutMarker("[!TIP] Literal {unknown=value}")).toMatchObject({
      title: "Literal {unknown=value}",
      color: undefined,
      icon: undefined,
    });
  });

  it("recognizes legacy presentation spellings without rewriting them", () => {
    expect(parseCalloutMarker("==`[!WARNING]`==")).toMatchObject({ kind: "warning" });
    expect(parseCalloutMarker("\\[!CAUTION\\]")).toMatchObject({ kind: "warning" });
    expect(parseCalloutMarker("[!INCOMPLETE")).toBeNull();
  });
});
