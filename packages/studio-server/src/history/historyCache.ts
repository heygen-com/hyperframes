import type { ProjectHistory } from "./projectHistory.js";

type Opened = Promise<ProjectHistory | null>;

/** A host's histories, one per project folder, opened on first use; a new project at the path gets its own. */
export function historyCache(open: (projectDir: string) => Opened) {
  const histories = new Map<string, Opened>();
  const get = async (projectDir: string): Promise<ProjectHistory | null> => {
    let cached = histories.get(projectDir);
    if (!cached) histories.set(projectDir, (cached = open(projectDir)));
    const opened = await cached;
    if (!opened?.replacedAtPath()) return opened;
    const reopen = () => open(projectDir);
    if (histories.get(projectDir) === cached)
      histories.set(projectDir, opened.close().then(reopen, reopen));
    return get(projectDir);
  };
  return {
    get,
    /** The history if one was opened, without opening it. */
    peek: (projectDir: string) => histories.get(projectDir),
    forget: (projectDir: string) => histories.delete(projectDir),
    closeAll: () =>
      Promise.all(
        [...histories.values()].map((opened) => opened.then((history) => history?.close())),
      ),
  };
}
