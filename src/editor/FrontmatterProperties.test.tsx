import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../i18n";
import { FrontmatterProperties } from "./FrontmatterProperties";

describe("FrontmatterProperties", () => {
  it("renders editable controls for simple values and protects complex values", () => {
    localStorage.setItem("webmd-notes-language", "en");
    const html = renderToStaticMarkup(
      <I18nProvider><FrontmatterProperties
        editable
        onChange={() => undefined}
        markdown={[
          "---",
          "created:",
          "enabled: true",
          "count: 2",
          "tags:",
          "  - one",
          "nested:",
          "  child: value",
          "---",
          "Body"
        ].join("\n")}
      /></I18nProvider>
    );

    expect(html).toContain("type=\"date\"");
    expect(html).toContain("type=\"checkbox\"");
    expect(html).toContain("type=\"number\"");
    expect(html).toContain("property-chip");
    expect(html).toContain("Complex YAML values are read-only here");
    expect(html).toContain("Add note property");
  });

  it("shows invalid YAML without attempting to render editors", () => {
    localStorage.setItem("webmd-notes-language", "en");
    const html = renderToStaticMarkup(
      <I18nProvider><FrontmatterProperties editable markdown={"---\nvalue: [\n---\nBody"} /></I18nProvider>
    );

    expect(html).toContain("has been left unchanged");
    expect(html).toContain("value: [");
    expect(html).not.toContain("Add note property");
  });
});
