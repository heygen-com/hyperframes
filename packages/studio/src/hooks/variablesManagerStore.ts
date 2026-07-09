import { create } from "zustand";

/**
 * Open/closed state for the summonable Variables manager slide-over.
 *
 * The manager replaces the old dedicated Variables tab: variable creation and
 * default-editing happen inline in the Design panel (promote pill + bound chip),
 * while the full list — declare, edit, remove, preview overrides, dev handoff,
 * and other-composition variables — lives in this on-demand overlay. It is a
 * global store because the trigger (a control's ◆ chip, deep in the Design
 * panel) and the overlay (mounted at the right panel) live in different subtrees.
 */
interface VariablesManagerState {
  open: boolean;
  /**
   * Composition file the manager should manage as its PRIMARY composition. A
   * bound-chip click passes the promoted element's own file (a sub-comp when the
   * selection lives inside an inlined sub-composition) so the manager edits the
   * same file promotion wrote to — not the host. `null` targets the active/master
   * composition (the header trigger's behavior).
   */
  targetPath: string | null;
  setOpen: (open: boolean, targetPath?: string | null) => void;
}

export const useVariablesManagerStore = create<VariablesManagerState>((set) => ({
  open: false,
  targetPath: null,
  setOpen: (open, targetPath = null) => set({ open, targetPath }),
}));
