import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  DockviewReact,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
} from "dockview-react";
import { readStudioUiPreferences, writeStudioUiPreferences } from "../../utils/studioUiPreferences";
import { addRegisteredPanel, buildEditLayout } from "./dockLayout";
import { DOCK_PANEL_COMPONENT } from "./dockLayoutSchema";
import { useDockLayoutStore, type DockController, type DockSnapshot } from "./dockLayoutStore";
import {
  PANEL_DEFINITIONS,
  PANEL_IDS,
  isPanelId,
  type PanelDefinition,
  type PanelId,
} from "./panelRegistry";
import "./dock.css";

const PERSIST_DEBOUNCE_MS = 250;

type Slots = Partial<Record<PanelId, HTMLElement>>;

interface SlotsContextValue {
  slots: Slots;
  registerSlot: (id: PanelId, element: HTMLElement | null) => void;
}

const SlotsContext = createContext<SlotsContextValue | null>(null);

function useSlots(): SlotsContextValue {
  const value = useContext(SlotsContext);
  if (!value) throw new Error("Dock.Panel must be rendered inside Dock.Root");
  return value;
}

/** The element dockview mounts for a panel; Dock.Panel portals the real content into it. */
function PanelSlot({ api }: IDockviewPanelProps) {
  const { registerSlot } = useSlots();
  const id = api.id;
  const ref = useCallback(
    (element: HTMLDivElement | null) => {
      if (isPanelId(id)) registerSlot(id, element);
    },
    [id, registerSlot],
  );
  return <div ref={ref} className="h-full w-full min-h-0 min-w-0 overflow-hidden" />;
}

const COMPONENTS = { [DOCK_PANEL_COMPONENT]: PanelSlot };

function snapshot(api: DockviewApi): DockSnapshot {
  const openPanels = new Set<PanelId>();
  const visiblePanels = new Set<PanelId>();
  for (const panel of api.panels) {
    if (!isPanelId(panel.id)) continue;
    openPanels.add(panel.id);
    if (panel.api.isVisible && panel.group.api.isVisible) visiblePanels.add(panel.id);
  }
  const active = api.activePanel?.id;
  return { openPanels, visiblePanels, activePanel: isPanelId(active) ? active : null };
}

function createController(api: DockviewApi): DockController {
  const open = (id: PanelId) => {
    if (api.getPanel(id)) return;
    const { near, direction } = PANEL_DEFINITIONS[id].reopen;
    const hasAnchor = api.getPanel(near) !== undefined;
    addRegisteredPanel(api, id, hasAnchor ? { referencePanel: near, direction } : undefined);
  };
  return {
    open,
    activate: (id) => {
      open(id);
      api.getPanel(id)?.api.setActive();
    },
    close: (id) => {
      const panel = api.getPanel(id);
      if (panel) api.removePanel(panel);
    },
    setTitle: (id, title) => api.getPanel(id)?.api.setTitle(title),
    setGroupVisible: (id, visible) => api.getPanel(id)?.group.api.setVisible(visible),
    reset: () => buildEditLayout(api, window.innerWidth),
  };
}

function restoreOrBuild(api: DockviewApi, projectId: string | null) {
  const stored = readStudioUiPreferences(undefined, projectId).dockLayout;
  if (stored) {
    try {
      api.fromJSON(stored);
      return;
    } catch {
      /* a layout the schema accepted but dockview cannot load: start over */
    }
  }
  buildEditLayout(api, window.innerWidth);
}

function Root({ projectId, children }: { projectId: string | null; children: ReactNode }) {
  const [slots, setSlots] = useState<Slots>({});
  const registerSlot = useCallback((id: PanelId, element: HTMLElement | null) => {
    setSlots((prev) => {
      if (prev[id] === (element ?? undefined)) return prev;
      const next = { ...prev };
      if (element) next[id] = element;
      else delete next[id];
      return next;
    });
  }, []);

  const disposeRef = useRef<() => void>(() => {});
  useEffect(() => () => disposeRef.current(), []);

  const onReady = useCallback(
    ({ api }: DockviewReadyEvent) => {
      restoreOrBuild(api, projectId);
      const store = useDockLayoutStore.getState();
      store.attach(createController(api));
      store.sync(snapshot(api));
      const pending = store.takePendingActivation();
      if (pending) api.getPanel(pending)?.api.setActive();

      let timer: ReturnType<typeof setTimeout> | undefined;
      const persist = () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          writeStudioUiPreferences({ dockLayout: api.toJSON() }, undefined, projectId);
        }, PERSIST_DEBOUNCE_MS);
      };
      // dockview does not fire onDidLayoutChange for add/remove/activate,
      // so every event class is wired to the same sync+persist pair.
      const onDockChange = () => {
        useDockLayoutStore.getState().sync(snapshot(api));
        persist();
      };
      const subscriptions = [
        api.onDidAddPanel(onDockChange),
        api.onDidRemovePanel(onDockChange),
        api.onDidActivePanelChange(onDockChange),
        api.onDidLayoutChange(onDockChange),
      ];
      disposeRef.current = () => {
        clearTimeout(timer);
        for (const subscription of subscriptions) subscription.dispose();
        useDockLayoutStore.getState().detach();
      };
    },
    [projectId],
  );

  return (
    <SlotsContext.Provider value={{ slots, registerSlot }}>
      <DockviewReact
        key={projectId ?? ""}
        className="hf-dock flex-1 min-h-0"
        components={COMPONENTS}
        defaultRenderer="always"
        disableFloatingGroups
        onReady={onReady}
      />
      {children}
    </SlotsContext.Provider>
  );
}

function Panel({ id, title, children }: { id: PanelId; title?: string; children: ReactNode }) {
  const element = useSlots().slots[id];
  const visible = useDockLayoutStore((state) => state.visiblePanels.has(id));
  const controller = useDockLayoutStore((state) => state.controller);
  const label = title ?? PANEL_DEFINITIONS[id].title;
  useEffect(() => {
    controller?.setTitle(id, label);
  }, [controller, id, label]);
  const definition: PanelDefinition = PANEL_DEFINITIONS[id];
  const shown = visible || definition.keepMounted;
  return element && shown ? createPortal(children, element) : null;
}

function WindowMenu() {
  const openPanels = useDockLayoutStore((state) => state.openPanels);
  const togglePanel = useDockLayoutStore((state) => state.togglePanel);
  const resetLayout = useDockLayoutStore((state) => state.resetLayout);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="h-7 px-2.5 rounded-md text-[11px] font-medium text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 transition-colors"
      >
        Window
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-8 z-50 w-44 rounded-md border border-neutral-800 bg-neutral-900 py-1 shadow-lg"
        >
          {PANEL_IDS.map((id) => (
            <button
              key={id}
              type="button"
              role="menuitemcheckbox"
              aria-checked={openPanels.has(id)}
              onClick={() => togglePanel(id)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-neutral-300 hover:bg-neutral-800"
            >
              <span className="w-3 text-panel-accent">{openPanels.has(id) ? "✓" : ""}</span>
              {PANEL_DEFINITIONS[id].title}
            </button>
          ))}
          <div className="my-1 border-t border-neutral-800" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              resetLayout();
              setOpen(false);
            }}
            className="w-full px-3 py-1.5 text-left text-[11px] text-neutral-300 hover:bg-neutral-800"
          >
            Reset layout
          </button>
        </div>
      )}
    </div>
  );
}

export const Dock = { Root, Panel, WindowMenu };
