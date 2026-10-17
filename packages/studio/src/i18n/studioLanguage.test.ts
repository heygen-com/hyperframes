import { describe, expect, it } from "vitest";
import { detectStudioLanguage, normalizeStudioLanguage } from "./studioLanguage";
import { createStudioI18n } from "./createStudioI18n";
import { PANEL_DEFINITIONS, PANEL_IDS } from "../components/dock/panelRegistry";
import en from "./locales/en.json";
import zhCN from "./locales/zh-CN.json";

describe("Studio language resolution", () => {
  it.each(["zh", "zh-CN", "zh-SG", "zh-Hans", "zh-Hans-CN"])(
    "maps %s to Simplified Chinese",
    (language) => {
      expect(normalizeStudioLanguage(language)).toBe("zh-CN");
    },
  );
  it.each(["zh-TW", "zh-HK", "zh-Hant", "fr", "", null])(
    "does not silently map %s to Simplified Chinese",
    (language) => {
      expect(normalizeStudioLanguage(language)).toBeNull();
    },
  );
  it("uses browser preference order among supported languages and falls back to English", () => {
    expect(detectStudioLanguage(["fr", "zh-Hans-CN", "en-US"])).toBe("zh-CN");
    expect(detectStudioLanguage(["en-GB", "zh-CN"])).toBe("en");
    expect(detectStudioLanguage(["zh-TW", "ja"])).toBe("en");
  });
  it("ships matching keys and interpolation parameters", () => {
    expect(Object.keys(zhCN).sort()).toEqual(Object.keys(en).sort());
    for (const key of Object.keys(en)) {
      const english = Object.entries(en).find(([name]) => name === key)?.[1] ?? "";
      const chinese = Object.entries(zhCN).find(([name]) => name === key)?.[1] ?? "";
      expect(chinese.trim(), key).not.toBe("");
      expect(chinese.match(/{{[^}]+}}/g) ?? [], key).toEqual(english.match(/{{[^}]+}}/g) ?? []);
    }
  });
  it("keeps English panel labels identical to the dock registry titles", () => {
    for (const id of PANEL_IDS) expect(en[`panels.${id}`], id).toBe(PANEL_DEFINITIONS[id].title);
  });
  it("renders synchronously, interpolates, and falls back when a translation is missing", () => {
    const instance = createStudioI18n("zh-CN");
    expect(instance.isInitialized).toBe(true);
    expect(instance.t("toolbar.export")).toBe("导出");
    expect(instance.t("navigation.closePanel", { title: "素材" })).toBe("关闭素材");
    instance.addResource("en", "studio", "fallbackProbe", "English fallback");
    expect(instance.t("fallbackProbe")).toBe("English fallback");
  });
});
