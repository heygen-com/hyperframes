import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { SupportedLocale } from "./index";

const STORAGE_KEY = "hf-studio-lang";

export function useLanguage() {
  const { i18n } = useTranslation();

  const currentLanguage = i18n.language as SupportedLocale;

  const setLanguage = useCallback(
    (lang: SupportedLocale) => {
      i18n.changeLanguage(lang);
      try {
        localStorage.setItem(STORAGE_KEY, lang);
      } catch {
        // localStorage unavailable
      }
      document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
    },
    [i18n],
  );

  const toggleLanguage = useCallback(() => {
    const next = currentLanguage === "en" ? "zh" : "en";
    setLanguage(next);
  }, [currentLanguage, setLanguage]);

  return {
    currentLanguage,
    setLanguage,
    toggleLanguage,
    isZh: currentLanguage === "zh",
    isEn: currentLanguage === "en",
  };
}
