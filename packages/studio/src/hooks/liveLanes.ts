import { useRef, useState } from "react";

/** Live-preview bookkeeping per lane of the open composition: the value before a gesture, pending saves, and the last value verified. */
function createLiveLanes(scope: () => string) {
  const before = new Map<string, string | null>();
  const pending = new Map<string, Set<number>>();
  const verified = new Map<string, string | null>();
  // Lanes whose before-value was read with no save pending, so it is what the file holds.
  const clean = new Set<string>();
  let saves = 0;
  const take = (key: string): string | null | undefined => {
    const claimed = before.has(key) ? (before.get(key) ?? null) : undefined;
    before.delete(key);
    clean.delete(key);
    return claimed;
  };
  const overtaken = (key: string, save: number): boolean =>
    [...(pending.get(key) ?? [])].some((newer) => newer > save);
  const scoped = (laneKey: string): string => `${scope()}\n${laneKey}`;
  return {
    preview(laneKey: string, readCurrent: () => string | null): void {
      const key = scoped(laneKey);
      if (before.has(key)) return;
      before.set(key, readCurrent());
      if (!pending.has(key)) clean.add(key);
    },
    // A save. Its settle records what the file holds: `saved`, else the last value verified on
    // this lane (a landed save, a read-back, or a clean before-value), never an unsaved one.
    // Store and preview follow only while no newer save is pending and its composition is open,
    // and the preview only while no drag is live.
    claim(laneKey: string, apply: LiveLaneApply): LiveLaneSave {
      const key = scoped(laneKey);
      const open = () => scoped(laneKey) === key;
      const trusted = clean.has(key);
      const claimed = take(key);
      const mine = ++saves;
      if (claimed !== undefined && trusted) verified.set(key, claimed);
      pending.set(key, (pending.get(key) ?? new Set<number>()).add(mine));
      const preview = (value: string | null) => {
        if (open() && !before.has(key) && !overtaken(key, mine)) apply.preview(value);
      };
      return {
        preview,
        read(value) {
          verified.set(key, value);
        },
        settle(saved) {
          const inFlight = pending.get(key);
          inFlight?.delete(mine);
          if (saved !== undefined) verified.set(key, saved);
          const value = verified.get(key);
          // With no save left in flight the file can change under it (undo, an outside edit).
          if (!inFlight?.size) {
            pending.delete(key);
            verified.delete(key);
          }
          if (value === undefined || overtaken(key, mine) || !open()) return;
          if (before.has(key)) {
            before.set(key, value);
            clean.add(key);
          }
          apply.store(value);
          preview(value);
        },
      };
    },
    // A gesture refused before it saved: put its before-value back, which hands the lane
    // back to any save still pending on it.
    revert(laneKey: string, apply: LiveLaneApply): void {
      const claimed = take(scoped(laneKey));
      if (claimed === undefined) return;
      apply.preview(claimed);
      apply.store(claimed);
    },
  };
}

/** A hook's live lanes, scoped to the project and composition open when each save starts. */
export function useLiveLanes(
  projectIdRef: { readonly current: string | null },
  activeCompPath: string | null,
) {
  const compositionRef = useRef(activeCompPath);
  compositionRef.current = activeCompPath;
  const [lanes] = useState(() =>
    createLiveLanes(() => `${projectIdRef.current ?? ""}\n${compositionRef.current ?? ""}`),
  );
  return lanes;
}

interface LiveLaneSave {
  preview: (value: string | null) => void;
  read: (value: string | null) => void;
  settle: (saved?: string | null) => void;
}
interface LiveLaneApply {
  preview: (value: string | null) => void;
  store: (value: string | null) => void;
}
