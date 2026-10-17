import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { i18n } from "i18next";
import { I18nextProvider, useTranslation } from "react-i18next";
import { createStudioI18n, type StudioTranslationKey } from "./createStudioI18n";
import {
  detectStudioLanguage,
  normalizeStudioLanguage,
  readStudioLanguage,
  writeStudioLanguage,
  type StudioLanguage,
} from "./studioLanguage";

interface StudioLanguageContextValue {
  instance: i18n;
  controlled: boolean;
  showLanguageSwitcher: boolean;
}
const StudioLanguageContext = createContext<StudioLanguageContextValue | null>(null);
const english = createStudioI18n();

export interface StudioI18nProviderProps {
  children: ReactNode;
  instance?: i18n;
  language?: StudioLanguage;
  detectBrowserLanguage?: boolean;
  persistLanguage?: boolean;
  /** Shows the header language menu. Hidden while `language` controls the choice. */
  showLanguageSwitcher?: boolean;
}

function initialLanguage(props: StudioI18nProviderProps): StudioLanguage {
  if (props.language) return props.language;
  if (props.persistLanguage) {
    const saved = readStudioLanguage();
    if (saved) return saved;
  }
  return props.detectBrowserLanguage && typeof navigator !== "undefined"
    ? detectStudioLanguage(navigator.languages.length ? navigator.languages : [navigator.language])
    : "en";
}

export function StudioI18nProvider(props: StudioI18nProviderProps) {
  const {
    children,
    instance: supplied,
    language,
    persistLanguage = false,
    showLanguageSwitcher = false,
  } = props;
  const [owned] = useState(() => supplied ?? createStudioI18n(initialLanguage(props)));
  const instance = supplied ?? owned;
  useEffect(() => {
    if (language) void instance.changeLanguage(language);
  }, [instance, language]);
  useEffect(() => {
    if (!persistLanguage || language) return;
    const save = (next: string) => {
      const supported = normalizeStudioLanguage(next);
      if (supported) writeStudioLanguage(supported);
    };
    instance.on("languageChanged", save);
    return () => {
      instance.off("languageChanged", save);
    };
  }, [instance, language, persistLanguage]);
  return (
    <StudioLanguageContext.Provider
      value={{ instance, controlled: language !== undefined, showLanguageSwitcher }}
    >
      <I18nextProvider i18n={instance} defaultNS="studio">
        {children}
      </I18nextProvider>
    </StudioLanguageContext.Provider>
  );
}

export function StudioI18nBoundary({ children }: { children: ReactNode }) {
  const context = useContext(StudioLanguageContext);
  return context ? children : <StudioI18nProvider>{children}</StudioI18nProvider>;
}

export function useStudioTranslation() {
  const context = useContext(StudioLanguageContext);
  const { t: translate, i18n: instance } = useTranslation("studio", {
    i18n: context?.instance ?? english,
    useSuspense: false,
  });
  const t = (key: StudioTranslationKey, options?: Record<string, string | number>): string =>
    translate(key, options);
  return {
    t,
    instance,
    language: normalizeStudioLanguage(instance.resolvedLanguage ?? instance.language) ?? "en",
    canSwitchLanguage: Boolean(context?.showLanguageSwitcher && !context.controlled),
  };
}
