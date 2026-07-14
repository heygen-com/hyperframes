import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import zh from "./locales/zh.json";

const SUPPORTED_LANGS = ["en", "zh"] as const;
export type SupportedLocale = (typeof SUPPORTED_LANGS)[number];

function detectLanguage(): SupportedLocale {
  try {
    const stored = localStorage.getItem("hf-studio-lang");
    if (stored === "en" || stored === "zh") return stored;
  } catch {
    // localStorage unavailable
  }

  try {
    const navLang = (navigator.language || "").toLowerCase();
    if (navLang.startsWith("zh")) return "zh";
  } catch {
    // navigator unavailable
  }

  return "en";
}

export function isValidLocale(locale: string): locale is SupportedLocale {
  return SUPPORTED_LANGS.includes(locale as SupportedLocale);
}

const detectedLang = detectLanguage();

function isDevMode(): boolean {
  try {
    return import.meta.env.DEV === true;
  } catch {
    return false;
  }
}

// Set initial html lang attribute
if (typeof document !== "undefined") {
  document.documentElement.lang = detectedLang === "zh" ? "zh-CN" : "en";
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    zh: { translation: zh },
  },
  lng: detectedLang,
  fallbackLng: "en",
  interpolation: {
    escapeValue: false,
  },
  ...(isDevMode()
    ? {
        missingKeyHandler: (_lngs: readonly string[], _ns: string, key: string) => {
          console.warn(`[i18n] Missing translation key: ${key}`);
        },
      }
    : {}),
  react: {
    useSuspense: false,
  },
});

export default i18n;
