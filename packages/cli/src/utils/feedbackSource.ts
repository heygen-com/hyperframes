/** Who wrote a report: a person who typed and sent it, or an agent that ran the command. */
export type FeedbackSource = "person" | "agent";

const SOURCES: readonly string[] = ["person", "agent"];

/** The `--source` value, undefined when absent, null when it is neither. */
export function parseFeedbackSource(raw: string | undefined): FeedbackSource | null | undefined {
  if (raw === undefined) return undefined;
  const source = raw.trim();
  return SOURCES.includes(source) ? (source as FeedbackSource) : null;
}

/** Set only by the app that launched the CLI: never a flag, and never read from a project `.env` (dotEnv.ts). */
export const FEEDBACK_EMAIL_ENV = "HYPERFRAMES_FEEDBACK_EMAIL";

/** The signed-in person's email the launching app attached, unverified: the backend must not treat it as identity. */
export function feedbackEmail(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env[FEEDBACK_EMAIL_ENV]?.trim() || undefined;
}
