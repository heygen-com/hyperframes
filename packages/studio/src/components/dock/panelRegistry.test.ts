import { afterEach, describe, expect, it } from "vitest";
import {
  PANEL_IDS,
  allPanelIds,
  hostPanelIds,
  isPanelId,
  panelDefinition,
  panelsInZone,
  registerHostPanels,
} from "./panelRegistry";

afterEach(() => registerHostPanels([]));

describe("host panels in the registry", () => {
  it("are unknown until registered, then resolve like built-ins", () => {
    expect(isPanelId("agent")).toBe(false);
    expect(() => panelDefinition("agent")).toThrow(/unknown/);
    registerHostPanels([{ id: "agent", title: "Agent", zone: "right", keepMounted: true }]);
    expect(isPanelId("agent")).toBe(true);
    expect(panelDefinition("agent")).toEqual({
      title: "Agent",
      zone: "right",
      reopen: { near: "design", direction: "within" },
      keepMounted: true,
    });
    expect(panelsInZone("right")).toContain("agent");
  });

  it("reopen next to their column's first panel unless told otherwise", () => {
    registerHostPanels([
      { id: "notes", title: "Notes", zone: "left" },
      {
        id: "chat",
        title: "Chat",
        zone: "right",
        reopen: { near: "renders", direction: "within" },
      },
    ]);
    expect(panelDefinition("notes").reopen).toEqual({ near: "compositions", direction: "within" });
    expect(panelDefinition("chat").reopen).toEqual({ near: "renders", direction: "within" });
  });

  it("come after the built-ins, in registration order, and are replaced as a whole", () => {
    registerHostPanels([
      { id: "b", title: "B", zone: "left" },
      { id: "a", title: "A", zone: "right" },
    ]);
    expect(allPanelIds()).toEqual([...PANEL_IDS, "b", "a"]);
    registerHostPanels([{ id: "c", title: "C", zone: "left" }]);
    expect(hostPanelIds()).toEqual(["c"]);
    expect(isPanelId("a")).toBe(false);
  });

  it("cannot shadow a built-in panel", () => {
    expect(() => registerHostPanels([{ id: "timeline", title: "T", zone: "left" }])).toThrow(
      /built-in/,
    );
  });
});
