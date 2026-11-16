const WALK_MAX_ENTRIES = 20_000;
const WALK_MAX_MS = 2_000;

/** Counts what a project walk lists; false once it passes the entry or time limit, so the walk stops unfinished. */
export function walkBudget(): (entries: number) => boolean {
  const deadline = Date.now() + WALK_MAX_MS;
  let seen = 0;
  return (entries) => {
    seen += entries;
    return seen <= WALK_MAX_ENTRIES && Date.now() <= deadline;
  };
}
