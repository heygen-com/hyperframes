import { MAX_MESSAGE_LIST, refuseMessageList } from "@hyperframes/core/runtime/protocol";

const WARN_EVERY_MS = 10_000;
const lastWarnedAt = new Map<string, number>();

/** The film's list, or none when it is refused; a refusal is logged at most once per list every 10 s. */
export function readFrameList(name: string, value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  const refusal = refuseMessageList(value);
  if (!refusal) return value;
  const now = Date.now();
  const last = lastWarnedAt.get(name);
  const warnedLately = last !== undefined && now >= last && now - last < WARN_EVERY_MS;
  if (!warnedLately) {
    lastWarnedAt.set(name, now);
    const why =
      refusal.reason === "length"
        ? `${refusal.length} entries, over the ${MAX_MESSAGE_LIST} it reads`
        : `a missing entry among ${refusal.length}`;
    console.warn(`[hyperframes-player] ignored the film's ${name} list: ${why}`);
  }
  return [];
}
