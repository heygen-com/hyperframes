import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./i18n/locales/en.json";

try {
  i18n.use(initReactI18next).init({
    resources: {
      en: { translation: en },
    },
    lng: "en",
    fallbackLng: "en",
    interpolation: { escapeValue: false },
    returnObjects: true,
    react: {
      useSuspense: false,
    },
  });
} catch {
  // i18n init skipped — tests referencing useTranslation will fall back to
  // react-i18next's default key prefix and not crash.
}

if (typeof globalThis.CSS === "undefined") {
  (globalThis as Record<string, unknown>).CSS = {};
}
if (typeof CSS.escape !== "function") {
  CSS.escape = (value: string) => value.replace(/([^\w-])/g, "\\$1");
}
