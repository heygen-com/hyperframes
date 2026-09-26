import type { ReactNode } from "react";
import { Dock } from "./dock/Dock";
import type { HostPanelDefinition } from "./dock/panelRegistry";

/** A panel the host app adds to the dock, with what it shows. */
export interface HostPanel extends HostPanelDefinition {
  content: ReactNode;
}

/** The host's panels as Dock.Panel elements, rendered after Studio's own. */
export function StudioHostPanels({ panels }: { panels?: readonly HostPanel[] }) {
  if (!panels?.length) return null;
  return (
    <>
      {panels.map((panel) => (
        <Dock.Panel key={panel.id} id={panel.id} title={panel.title}>
          {panel.content}
        </Dock.Panel>
      ))}
    </>
  );
}
