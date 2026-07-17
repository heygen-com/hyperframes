// @vitest-environment happy-dom

import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { PropertyPanelEmptyState } from "./PropertyPanelEmptyState";
import type { DomEditSelection } from "./domEditingTypes";
import { renderInto, setupReactActEnvironment } from "./testRenderUtils";

setupReactActEnvironment();

describe("PropertyPanelEmptyState — flat empty", () => {
  it("shows the cursor glyph, headline, and the two shortcut rows", () => {
    const { host, root } = renderInto(<PropertyPanelEmptyState flat multiSelectCount={0} />);
    expect(host.textContent).toContain("Nothing selected");
    expect(host.textContent).toContain("Record a gesture");
    expect(host.textContent).toContain("Describe a change to the agent");
    act(() => root.unmount());
  });
});

describe("PropertyPanelEmptyState — flat multi-select", () => {
  const elements = [
    { id: "mono-label", selector: ".mono-label", label: "Mono Label", tagName: "div" },
    { id: null, selector: "#s2-chart", label: "S2 Chart", tagName: "div" },
  ] as unknown as DomEditSelection[];

  it("lists each selected element and wires group/hide-all/clear actions", () => {
    const onGroupSelection = vi.fn();
    const onHideAllSelected = vi.fn();
    const onClearSelection = vi.fn();
    const { host, root } = renderInto(
      <PropertyPanelEmptyState
        flat
        multiSelectCount={2}
        multiSelectedElements={elements}
        onGroupSelection={onGroupSelection}
        onHideAllSelected={onHideAllSelected}
        onClearSelection={onClearSelection}
      />,
    );
    expect(host.textContent).toContain("2 elements selected");
    expect(host.textContent).toContain("Mono Label");
    expect(host.textContent).toContain("S2 Chart");

    const group = host.querySelector<HTMLButtonElement>('[data-flat-multiselect-group="true"]');
    act(() => group?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onGroupSelection).toHaveBeenCalledTimes(1);

    const hideAll = host.querySelector<HTMLButtonElement>(
      '[data-flat-multiselect-hide-all="true"]',
    );
    act(() => hideAll?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onHideAllSelected).toHaveBeenCalledTimes(1);

    const clear = host.querySelector<HTMLButtonElement>('[data-flat-multiselect-clear="true"]');
    act(() => clear?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onClearSelection).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });
});
