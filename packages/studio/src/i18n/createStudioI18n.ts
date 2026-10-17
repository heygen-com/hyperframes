import { createInstance, type i18n } from "i18next";
import en from "./locales/en.json";
import zhCN from "./locales/zh-CN.json";
import { STUDIO_LANGUAGES, type StudioLanguage } from "./studioLanguage";

export type StudioTranslationKey = keyof typeof en;

export function createStudioI18n(language: StudioLanguage = "en"): i18n {
  const instance = createInstance();
  void instance.init({
    lng: language,
    fallbackLng: "en",
    supportedLngs: [...STUDIO_LANGUAGES],
    load: "currentOnly",
    ns: ["studio"],
    defaultNS: "studio",
    keySeparator: false,
    initAsync: false,
    interpolation: { escapeValue: false },
    resources: { en: { studio: en }, "zh-CN": { studio: zhCN } },
  });
  return instance;
}
