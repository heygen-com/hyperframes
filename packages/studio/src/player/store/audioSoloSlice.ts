/**
 * "Hear only this" — session-only monitoring override, never persisted.
 *
 * Holds clip ids and group ids (never track numbers, per the design doc: solo
 * is a per-element/per-group concept, not a row-position one). Exclusive by
 * default (a plain toggle replaces the set); ⌘/Ctrl-click adds/removes one
 * member without disturbing the rest. Never written to any attribute or
 * document — the export-safety guarantee this slice exists to hold.
 */
import type { StoreApi } from "zustand";
import { isAudibleUnderSolo, isGroupHalfLitUnderSolo } from "@hyperframes/core/audio-groups";

export { isAudibleUnderSolo, isGroupHalfLitUnderSolo };

export interface AudioSoloSlice {
  soloed: ReadonlySet<string>;
  toggleSolo: (id: string, options?: { add?: boolean }) => void;
  clearSolo: () => void;
}

export function createAudioSoloSlice(
  set: StoreApi<AudioSoloSlice>["setState"],
  get: StoreApi<AudioSoloSlice>["getState"],
): AudioSoloSlice {
  return {
    soloed: new Set(),
    toggleSolo: (id, options) => {
      const current = get().soloed;
      if (options?.add) {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        set({ soloed: next });
        return;
      }
      // Exclusive click: soloing the only-soloed element again clears it;
      // otherwise it replaces the set.
      const isOnlyMember = current.size === 1 && current.has(id);
      set({ soloed: isOnlyMember ? new Set() : new Set([id]) });
    },
    clearSolo: () => set({ soloed: new Set() }),
  };
}
