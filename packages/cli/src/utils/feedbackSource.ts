export type FeedbackSource = "person" | "agent";

const SOURCES: readonly string[] = ["person", "agent"];

/** The `--source` value, undefined when absent, null when it is neither. */
export function parseFeedbackSource(raw: string | undefined): FeedbackSource | null | undefined {
  if (raw === undefined) return undefined;
  const source = raw.trim();
  return SOURCES.includes(source) ? (source as FeedbackSource) : null;
}

export const FEEDBACK_EMAIL_ENV = "HYPERFRAMES_FEEDBACK_EMAIL";

/** Set only by the launching app (never a flag or a project `.env`); unverified, so never proof of identity. */
export function feedbackEmail(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env[FEEDBACK_EMAIL_ENV]?.trim() || undefined;
}
