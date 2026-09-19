import { create } from "zustand";
import {
  PANEL_DEFINITIONS,
  PANEL_IDS,
  panelsInZone,
  type PanelId,
  type PanelZone,
} from "./panelRegistry";

/** The narrow surface Dock.Root exposes; dockview types never leave the dock folder. */
export interface DockController {
  /** Adds the panel at its default place if it is closed; never moves focus. */
  open: (id: PanelId) => void;
  /** Focuses the panel, reopening it at its default place if it was closed. */
  activate: (id: PanelId) => void;
  setTitle: (id: PanelId, title: string) => void;
  close: (id: PanelId) => void;
  /** Hides or shows the panel's whole tab group without closing it. */
  setGroupVisible: (id: PanelId, visible: boolean) => void;
  reset: () => void;
}

export interface DockSnapshot {
  openPanels: ReadonlySet<PanelId>;
  /** Open panels whose tab is showing and whose group is not hidden. */
  visiblePanels: ReadonlySet<PanelId>;
  activePanel: PanelId | null;
}

type LastActive = Partial<Record<PanelZone, PanelId>>;

interface DockLayoutState extends DockSnapshot {
  controller: DockController | null;
  lastActive: LastActive;
  /** An activation requested before the dock mounted; Dock.Root applies it on ready. */
  pendingActivation: PanelId | null;
  attach: (controller: DockController) => void;
  detach: () => void;
  sync: (snapshot: DockSnapshot) => void;
  takePendingActivation: () => PanelId | null;
  activatePanel: (id: PanelId) => void;
  closePanel: (id: PanelId) => void;
  togglePanel: (id: PanelId) => void;
  setZoneVisible: (zone: PanelZone, visible: boolean) => void;
  resetLayout: () => void;
}

export const useDockLayoutStore = create<DockLayoutState>((set, get) => ({
  controller: null,
  openPanels: new Set(PANEL_IDS),
  visiblePanels: new Set(PANEL_IDS),
  activePanel: null,
  lastActive: {},
  pendingActivation: null,
  attach: (controller) => set({ controller }),
  detach: () => set({ controller: null }),
  sync: (snapshot) =>
    set((state) => {
      const { activePanel } = snapshot;
      if (!activePanel) return snapshot;
      const zone = PANEL_DEFINITIONS[activePanel].zone;
      return { ...snapshot, lastActive: { ...state.lastActive, [zone]: activePanel } };
    }),
  takePendingActivation: () => {
    const { pendingActivation } = get();
    set({ pendingActivation: null });
    return pendingActivation;
  },
  activatePanel: (id) => {
    const { controller } = get();
    if (!controller) {
      set({ pendingActivation: id });
      return;
    }
    controller.setGroupVisible(id, true);
    controller.activate(id);
  },
  closePanel: (id) => get().controller?.close(id),
  togglePanel: (id) => {
    const { openPanels, activatePanel, closePanel } = get();
    if (openPanels.has(id)) closePanel(id);
    else activatePanel(id);
  },
  setZoneVisible: (zone, visible) => {
    const { controller, openPanels } = get();
    for (const id of panelsInZone(zone)) {
      if (openPanels.has(id)) controller?.setGroupVisible(id, visible);
    }
  },
  resetLayout: () => get().controller?.reset(),
}));
