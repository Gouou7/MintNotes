import { afterEach, describe, expect, it } from "vitest";
import {
  detectBrowserLocale,
  getLanguagePreference,
  resolveLocale,
  translateMessage
} from "./index";

afterEach(() => localStorage.clear());

describe("i18n language resolution", () => {
  it("matches supported browser language families", () => {
    expect(detectBrowserLocale(["zh-Hans-SG"])).toBe("zh-CN");
    expect(detectBrowserLocale(["zh-Hant-HK"])).toBe("zh-TW");
    expect(detectBrowserLocale(["en-GB"])).toBe("en");
  });

  it("checks the browser language list and falls back to English", () => {
    expect(detectBrowserLocale(["fr-FR", "zh-TW"])).toBe("zh-TW");
    expect(detectBrowserLocale(["fr-FR", "de-DE"])).toBe("en");
  });

  it("uses system mode by default and accepts an explicit locale", () => {
    expect(getLanguagePreference()).toBe("system");
    expect(resolveLocale("system", ["zh-CN"])).toBe("zh-CN");
    expect(resolveLocale("en", ["zh-CN"])).toBe("en");
  });

  it("translates placeholders in all supported locales", () => {
    expect(translateMessage("en", "app.selectedCount", { count: 3 })).toBe("3 items selected");
    expect(translateMessage("zh-CN", "app.selectedCount", { count: 3 })).toBe("已选择 3 个项目");
    expect(translateMessage("zh-TW", "app.selectedCount", { count: 3 })).toBe("已選擇 3 個項目");
  });
});
