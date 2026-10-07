import { describe, expect, it } from "vitest";
import { calloutDefinition, editCalloutMarker, parseCalloutMarker } from "./calloutMarker";

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

  it("maps rendered titles to their source while excluding appearance attributes", () => {
    for (const source of ["[!note] Title", "  [!tip]+  标题 {color=red icon=bug}  ", "\\[!note\\] Escaped"]) {
      const marker = parseCalloutMarker(source)!;
      expect(marker.titleSource).toBeDefined();
      expect(source.slice(marker.titleSource!.from, marker.titleSource!.to)).toBe(marker.title);
    }
    expect(parseCalloutMarker("[!note]")?.titleSource).toBeUndefined();
    expect(parseCalloutMarker("[!note] {color=red}")?.titleSource).toBeUndefined();
  });
  it("changes only supported types, retaining literal titles and resetting type appearance", () => {
    expect(editCalloutMarker('[!note]- {color=red}', { type: 'warning' })).toBe('[!warning]-');
    expect(editCalloutMarker('[!NOTE]+ **Title** {icon=bug color=red}', { type: 'tip' })).toBe('[!tip]+ **Title**');
    expect(editCalloutMarker('[!note] Literal {future=value}', { type: 'example' })).toBe('[!example] Literal {future=value}');
    expect(editCalloutMarker('[!note] Styled {color=red}', { type: 'note' })).toBe('[!note] Styled {color=red}');
    expect(editCalloutMarker('[!note] Title', { type: 'not-supported' })).toBeNull();
  });
  it("edits and clears titles while preserving folds and appearance attributes", () => {
    expect(editCalloutMarker('[!note]+ Old {icon=bug color=red}', { title: 'New 标题' })).toBe('[!note]+ New 标题 {icon=bug color=red}');
    expect(editCalloutMarker('[!note]- Old {color=red}', { title: '' })).toBe('[!note]- {color=red}');
    expect(editCalloutMarker('==`[!note] Custom%20title`==', { type: 'warning' })).toBe('[!warning] Custom title');
    expect(editCalloutMarker('incomplete [!note', { title: 'New' })).toBeNull();
  });
});
