import type { HistoryWho } from "@hyperframes/studio-server/history";
import { endTurn, withOwner, writeTurn, type Turn } from "../utils/historyOwner.js";

export const historyWho = (name: string | undefined): HistoryWho =>
  name ? { kind: "agent", name } : { kind: "person", name: "You" };

/**
 * Runs `write` as one history entry, the way `history begin` and `history end` file an agent's
 * turn: open a turn, write, end it. Inside a turn that is already open, the writes join that turn.
 */
export async function asOneEntry<T>(
  projectDir: string,
  label: string,
  who: HistoryWho,
  write: () => T,
): Promise<T> {
  const mine = await withOwner(projectDir, async (owner, open) => {
    if (open) return null;
    const { id, startedAt } = await owner.begin(who, label);
    const turn: Turn = {
      via: owner.via,
      id,
      who,
      label,
      startedAt,
      lastWriteAt: startedAt,
      parts: [],
    };
    writeTurn(projectDir, turn);
    return turn;
  });
  try {
    return write();
  } finally {
    if (mine) await withOwner(projectDir, (owner) => endTurn(owner, mine, projectDir));
  }
}
