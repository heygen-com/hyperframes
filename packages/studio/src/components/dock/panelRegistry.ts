import type { Direction } from "dockview-react";

export const PANEL_IDS = [
  "preview",
  "timeline",
  "compositions",
  "assets",
  "code",
  "catalog",
  "design",
  "layers",
  "renders",
  "variables",
  "slideshow",
] as const;

export type BuiltInPanelId = (typeof PANEL_IDS)[number];
/** A built-in panel, or one the host registered through `Dock.Root`'s `hostPanels`. */
export type PanelId = BuiltInPanelId | (string & {});
export type PanelZone = "left" | "center" | "right";

export interface PanelDefinition {
  title: string;
  zone: PanelZone;
  /** Where Window > <panel> puts it when it has no saved place: next to `near`. */
  reopen: { near: PanelId; direction: Direction };
  /** Content stays mounted while its tab is hidden (the preview iframe must not reload). */
  keepMounted?: true;
}

/**
 * A panel the host app adds to the dock beside the built-in ones: it gets a tab in its
 * zone's column, a Window-menu entry, and a place in the saved layout. The content is a
 * `Dock.Panel` with the same id (StudioApp renders it from `HostPanel.content`).
 */
export interface HostPanelDefinition {
  id: string;
  title: string;
  /** Side columns only: the centre is the preview and the timeline. */
  zone: "left" | "right";
  /** Content stays mounted while its tab is hidden. */
  keepMounted?: true;
  /** Where it reopens when it has no saved place; by default as a tab of its column's first panel. */
  reopen?: PanelDefinition["reopen"];
}

const BUILT_IN_DEFINITIONS = {
  preview: {
    title: "Preview",
    zone: "center",
    reopen: { near: "timeline", direction: "above" },
    keepMounted: true,
  },
  timeline: {
    title: "Timeline",
    zone: "center",
    reopen: { near: "preview", direction: "below" },
    keepMounted: true,
  },
  compositions: {
    title: "Compositions",
    zone: "left",
    reopen: { near: "preview", direction: "left" },
  },
  assets: { title: "Assets", zone: "left", reopen: { near: "compositions", direction: "within" } },
  code: { title: "Code", zone: "left", reopen: { near: "compositions", direction: "within" } },
  catalog: {
    title: "Catalog",
    zone: "left",
    reopen: { near: "compositions", direction: "within" },
  },
  design: { title: "Design", zone: "right", reopen: { near: "preview", direction: "right" } },
  layers: { title: "Layers", zone: "right", reopen: { near: "design", direction: "within" } },
  renders: { title: "Renders", zone: "right", reopen: { near: "design", direction: "within" } },
  variables: { title: "Variables", zone: "right", reopen: { near: "design", direction: "within" } },
  slideshow: { title: "Slideshow", zone: "right", reopen: { near: "design", direction: "within" } },
} as const satisfies Record<BuiltInPanelId, PanelDefinition>;

// Host panels are registered by the mounted Dock.Root, before any layout is read: the
// stored-layout schema, the controller and the Window menu all resolve ids through here.
const hostDefinitions = new Map<string, PanelDefinition>();

const ZONE_ANCHOR: Record<HostPanelDefinition["zone"], BuiltInPanelId> = {
  left: "compositions",
  right: "design",
};

export function registerHostPanels(panels: readonly HostPanelDefinition[]): void {
  hostDefinitions.clear();
  for (const panel of panels) {
    if (isBuiltInPanelId(panel.id)) {
      throw new Error(`"${panel.id}" is a built-in Studio panel; host panels need another id`);
    }
    hostDefinitions.set(panel.id, {
      title: panel.title,
      zone: panel.zone,
      reopen: panel.reopen ?? { near: ZONE_ANCHOR[panel.zone], direction: "within" },
      ...(panel.keepMounted ? { keepMounted: true } : {}),
    });
  }
}

export function hostPanelIds(): string[] {
  return [...hostDefinitions.keys()];
}

/** Built-in panels first, in their canonical order, then the host's in registration order. */
export function allPanelIds(): PanelId[] {
  return [...PANEL_IDS, ...hostDefinitions.keys()];
}

function isBuiltInPanelId(value: unknown): value is BuiltInPanelId {
  return typeof value === "string" && (PANEL_IDS as readonly string[]).includes(value);
}

export function isPanelId(value: unknown): value is PanelId {
  return isBuiltInPanelId(value) || (typeof value === "string" && hostDefinitions.has(value));
}

export function panelDefinition(id: PanelId): PanelDefinition {
  const definition = isBuiltInPanelId(id) ? BUILT_IN_DEFINITIONS[id] : hostDefinitions.get(id);
  if (!definition) throw new Error(`unknown Studio panel "${id}"`);
  return definition;
}

export function panelsInZone(zone: PanelZone): PanelId[] {
  return allPanelIds().filter((id) => panelDefinition(id).zone === zone);
}
