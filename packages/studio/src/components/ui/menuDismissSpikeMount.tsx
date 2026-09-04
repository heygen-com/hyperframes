/**
 * KTD6 dismiss spike fixture. One definition of the menus under test, shared by
 * both halves of the spike so they cannot drift apart: menuDismiss.spike.test.tsx
 * renders SpikeMenu under happy-dom, and scripts/menu-dismiss-spike.mjs calls
 * mountMenuDismissSpike() inside a running Studio.
 *
 * Nothing in the app imports this. The spike script pulls the module in over
 * the Vite dev server by URL, which is why it is a source module and not inline
 * script text: Vite has to compile the JSX and resolve Base UI the same way the
 * app would, or the run would prove something about a hand-rolled bundle
 * instead of about Studio.
 *
 * mountMenuDismissSpike puts the context menu INSIDE the real canvas overlay so
 * the outside press lands on DomEditOverlay itself, the element whose
 * bubble-phase handlers call stopPropagation. A synthetic overlay could not
 * prove that.
 */
import { ContextMenu } from "@base-ui/react/context-menu";
import { Menu } from "@base-ui/react/menu";
import React from "react";
import { createRoot } from "react-dom/client";

const CANVAS_HOST_ID = "menu-dismiss-spike-canvas-host";
const PANEL_HOST_ID = "menu-dismiss-spike-panel-host";

/**
 * Right-click surface, inside the overlay: a corner of it, so the rest of the
 * overlay stays available as the outside-press target.
 */
function SpikeContextMenu(): React.JSX.Element {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger
        data-testid="spike-context-trigger"
        tabIndex={-1}
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: 160,
          height: 120,
          pointerEvents: "auto",
        }}
      />
      <ContextMenu.Portal>
        <ContextMenu.Positioner>
          <ContextMenu.Popup data-testid="spike-context-popup">
            <ContextMenu.Item data-testid="spike-context-item">Context one</ContextMenu.Item>
            <ContextMenu.Item>Context two</ContextMenu.Item>
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

/**
 * Button-triggered menu, OUTSIDE the overlay, which is where Studio's real ones
 * live (SpeedMenu and the timeline toolbar sit in panel chrome). Its press
 * target has to stay outside because the overlay's marquee branch calls
 * preventDefault on an empty-canvas pointerdown, so a trigger placed inside it
 * never receives the click at all. That is Studio behaving correctly, not a
 * Base UI failure, and putting the trigger where the shipped menus live keeps
 * the check about dismissal instead of about the canvas gesture layer.
 */
export function SpikeMenu({
  onActivate,
}: {
  onActivate?: (item: string) => void;
}): React.JSX.Element {
  return (
    <Menu.Root>
      <Menu.Trigger data-testid="spike-menu-trigger">Spike menu</Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner>
          <Menu.Popup data-testid="spike-menu-popup">
            <Menu.Item data-testid="spike-menu-item-1" onClick={() => onActivate?.("first")}>
              First
            </Menu.Item>
            <Menu.Item data-testid="spike-menu-item-2" onClick={() => onActivate?.("second")}>
              Second
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

function mountInto(parent: Element, id: string, css: string, node: React.JSX.Element): void {
  document.getElementById(id)?.remove();
  const host = document.createElement("div");
  host.id = id;
  host.style.cssText = css;
  parent.append(host);
  createRoot(host).render(node);
}

/** Returns false when the canvas overlay is not on screen yet. */
export function mountMenuDismissSpike(): boolean {
  const overlay = document.querySelector('[aria-label="Composition canvas"]');
  if (!overlay) return false;

  // Transparent to the pointer: only the trigger takes presses, so a press
  // anywhere else on the overlay reaches the overlay's own handlers.
  mountInto(
    overlay,
    CANVAS_HOST_ID,
    "position:absolute;inset:0;pointer-events:none;z-index:20",
    <SpikeContextMenu />,
  );
  mountInto(
    document.body,
    PANEL_HOST_ID,
    "position:fixed;right:8px;bottom:8px;z-index:9999",
    <SpikeMenu />,
  );
  return true;
}
