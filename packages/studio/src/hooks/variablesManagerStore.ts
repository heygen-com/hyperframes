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
  setOpen: (open: boolean) => void;
}

export const useVariablesManagerStore = create<VariablesManagerState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));
