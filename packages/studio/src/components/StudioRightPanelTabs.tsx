import type { RightPanelTab } from "../utils/studioHelpers";
import { STUDIO_INSPECTOR_PANELS_ENABLED } from "./editor/manualEditingAvailability";
import { Tooltip } from "./ui";

// fallow-ignore-next-line complexity
export function StudioRightPanelTabs({
  designPaneOpen,
  layersPaneOpen,
  rightPanelTab,
  renderJobCount,
  onInspectorPaneButtonClick,
  setRightPanelTab,
}: {
  designPaneOpen: boolean;
  layersPaneOpen: boolean;
  rightPanelTab: RightPanelTab;
  renderJobCount: number;
  onInspectorPaneButtonClick: (pane: "design" | "layers") => void;
  setRightPanelTab: (tab: RightPanelTab) => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-1 overflow-hidden border-b border-neutral-800 px-3 py-2">
      {STUDIO_INSPECTOR_PANELS_ENABLED && (
        <>
          <Tooltip label="Element styles and properties" side="bottom">
            <button
              type="button"
              onClick={() => onInspectorPaneButtonClick("design")}
              aria-pressed={designPaneOpen}
              className={`h-8 rounded-xl px-3 text-[11px] font-medium transition-colors active:scale-[0.98] ${
                designPaneOpen
                  ? "bg-neutral-800 text-white"
                  : "text-neutral-500 hover:bg-neutral-800/70 hover:text-neutral-200"
              }`}
            >
              Design
            </button>
          </Tooltip>
          <Tooltip label="Composition layer stack" side="bottom">
            <button
              type="button"
              onClick={() => onInspectorPaneButtonClick("layers")}
              aria-pressed={layersPaneOpen}
              className={`h-8 rounded-xl px-3 text-[11px] font-medium transition-colors active:scale-[0.98] ${
                layersPaneOpen
                  ? "bg-neutral-800 text-white"
                  : "text-neutral-500 hover:bg-neutral-800/70 hover:text-neutral-200"
              }`}
            >
              Layers
            </button>
          </Tooltip>
        </>
      )}
      <Tooltip label="Render queue and exports" side="bottom">
        <button
          type="button"
          onClick={() => setRightPanelTab("renders")}
          aria-pressed={rightPanelTab === "renders"}
          className={`h-8 rounded-xl px-3 text-[11px] font-medium transition-colors active:scale-[0.98] ${
            rightPanelTab === "renders"
              ? "bg-neutral-800 text-white"
              : "text-neutral-500 hover:bg-neutral-800/70 hover:text-neutral-200"
          }`}
        >
          {renderJobCount > 0 ? `Renders (${renderJobCount})` : "Renders"}
        </button>
      </Tooltip>
      <Tooltip label="Slideshow branching editor" side="bottom">
        <button
          type="button"
          onClick={() => setRightPanelTab("slideshow")}
          aria-pressed={rightPanelTab === "slideshow"}
          className={`h-8 rounded-xl px-3 text-[11px] font-medium transition-colors active:scale-[0.98] ${
            rightPanelTab === "slideshow"
              ? "bg-neutral-800 text-white"
              : "text-neutral-500 hover:bg-neutral-800/70 hover:text-neutral-200"
          }`}
        >
          Slideshow
        </button>
      </Tooltip>
    </div>
  );
}
