import { createJsonStore } from "./jsonStore";

/**
 * Which agent answers the user has already seen.
 *
 * A finished run's reply is worth surfacing once, next to the element it is
 * about — and never again after it is dismissed, including across the reloads
 * the agent's own edits trigger.
 */

const store = createJsonStore<string[]>({
  key: "hf-studio-agent-answers-read",
  fallback: [],
  parse: (raw) => (Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : []),
});

/** Keeps the list from growing with every run of every session. */
const MAX_REMEMBERED = 100;

export function isAnswerDismissed(jobId: string): boolean {
  return store.read().includes(jobId);
}

export function dismissAnswer(jobId: string): void {
  const seen = store.read();
  if (seen.includes(jobId)) return;
  store.write([...seen, jobId].slice(-MAX_REMEMBERED));
}
