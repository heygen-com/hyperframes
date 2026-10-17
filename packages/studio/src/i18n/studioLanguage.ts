export const STUDIO_LANGUAGES = ["en", "zh-CN"] as const;
export type StudioLanguage = (typeof STUDIO_LANGUAGES)[number];
const STORAGE_KEY = "hf-studio-language";

export function normalizeStudioLanguage(value: string | null | undefined): StudioLanguage | null {
  const language = value?.toLowerCase();
  if (language === "en" || language?.startsWith("en-")) return "en";
  if (
    language === "zh" ||
    language === "zh-cn" ||
    language === "zh-sg" ||
    language === "zh-hans" ||
    language?.startsWith("zh-hans-")
  )
    return "zh-CN";
  return null;
}

export function readStudioLanguage(): StudioLanguage | null {
  try {
    return normalizeStudioLanguage(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

export function writeStudioLanguage(language: StudioLanguage): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, language);
  } catch {
    /* Language switching also works when storage is unavailable. */
  }
}

export function detectStudioLanguage(languages: readonly string[]): StudioLanguage {
  for (const language of languages) {
    const supported = normalizeStudioLanguage(language);
    if (supported) return supported;
  }
  return "en";
}
