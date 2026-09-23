import { useEffect, useState } from "react";
import {
  BracketsCurly,
  ChartBarHorizontal,
  Code,
  FilmSlate,
  Image,
  Layout,
  Monitor,
  Presentation,
  SlidersHorizontal,
  SquaresFour,
  Stack,
  X,
  type Icon,
} from "@phosphor-icons/react";
import type { IDockviewPanelHeaderProps } from "dockview-react";
import { isPanelId, type PanelId } from "./panelRegistry";

const TAB_ICONS: Record<PanelId, Icon> = {
  preview: Monitor,
  timeline: ChartBarHorizontal,
  compositions: Layout,
  assets: Image,
  code: Code,
  catalog: SquaresFour,
  design: SlidersHorizontal,
  layers: Stack,
  renders: FilmSlate,
  variables: BracketsCurly,
  slideshow: Presentation,
};

/** A dock tab. Only the shown tab carries its type icon and close glyph; the rest are labels. */
export function DockTab({ api }: IDockviewPanelHeaderProps) {
  const [title, setTitle] = useState(api.title ?? "");
  const [shown, setShown] = useState(api.isVisible);
  useEffect(() => {
    const subscriptions = [
      api.onDidTitleChange((event) => setTitle(event.title)),
      api.onDidVisibilityChange((event) => setShown(event.isVisible)),
    ];
    return () => {
      for (const subscription of subscriptions) subscription.dispose();
    };
  }, [api]);
  const TypeIcon = shown && isPanelId(api.id) ? TAB_ICONS[api.id] : null;
  return (
    <div className="hf-dock-tab">
      {TypeIcon ? <TypeIcon className="hf-dock-tab-icon" size={14} aria-hidden /> : null}
      <span className="hf-dock-tab-label">{title}</span>
      {shown ? (
        // Same shape as dockview's own close control: a tab cannot hold a focusable button.
        <div
          role="button"
          tabIndex={-1}
          aria-label={`Close ${title}`}
          className="hf-dock-tab-close"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            api.close();
          }}
        >
          <X size={12} aria-hidden />
        </div>
      ) : null}
    </div>
  );
}
