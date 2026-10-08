/** whisper.cpp hears 30 s to decide a language; it decides once, from the start of what it is given. */
export const WINDOW_SECONDS = 30;
/** A music or noise window comes back near p = 0.5; speech in a language comes back above 0.9. */
const CONFIDENT = 0.7;

export const requestedLanguage = (language?: string) =>
  language?.trim().toLowerCase() === "auto" ? undefined : language;

export function detectionWindows(seconds: number, onset: number | null): number[] {
  const from = onset ?? 0;
  const span = seconds - from;
  if (span < WINDOW_SECONDS || (onset === null && span < 2 * WINDOW_SECONDS)) return [];
  return [1 / 6, 1 / 2, 5 / 6].map((at) => {
    const start = from + span * at - WINDOW_SECONDS / 2;
    return Math.min(Math.max(start, from), seconds - WINDOW_SECONDS);
  });
}

export interface LanguageVote {
  language: string;
  p: number;
}

export function pickLanguage(votes: readonly LanguageVote[]): string | null {
  const sure = votes.filter((vote) => vote.p >= CONFIDENT).map((vote) => vote.language);
  return sure.find((language, i) => sure.indexOf(language) !== i) ?? null;
}

export const confidentLanguage = (vote: LanguageVote | null) =>
  vote && vote.p >= CONFIDENT ? vote.language : null;

/** whisper-cli --detect-language prints `auto-detected language: es (p = 0.983324)`. */
export function parseDetection(line: string): LanguageVote | null {
  const match = /auto-detected language: ([a-z]+) \(p = ([\d.]+)\)/.exec(line);
  return match ? { language: match[1]!, p: Number(match[2]) } : null;
}
