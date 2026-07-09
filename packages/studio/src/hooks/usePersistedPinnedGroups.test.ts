// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { usePersistedPinnedGroups } from "./usePersistedPinnedGroups";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
  window.localStorage.clear();
});

function Harness({
  elementKind,
  onReady,
}: {
  elementKind: string;
  onReady: (api: ReturnType<typeof usePersistedPinnedGroups>) => void;
}) {
  const api = usePersistedPinnedGroups(elementKind);
  onReady(api);
  return null;
}

function mount(elementKind: string) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  let api!: ReturnType<typeof usePersistedPinnedGroups>;
  act(() => {
    root.render(React.createElement(Harness, { elementKind, onReady: (a) => (api = a) }));
  });
  return {
    host,
    root,
    get api() {
      return api;
    },
  };
}

describe("usePersistedPinnedGroups", () => {
  it("starts empty, toggling a pin adds it, toggling again removes it", () => {
    const m = mount("text");
    expect(m.api.pinnedGroupIds).toEqual([]);
    act(() => m.api.togglePin("motion"));
    expect(m.api.pinnedGroupIds).toEqual(["motion"]);
    act(() => m.api.togglePin("motion"));
    expect(m.api.pinnedGroupIds).toEqual([]);
    act(() => m.root.unmount());
  });

  it("persists across remounts, scoped per element kind", () => {
    const first = mount("text");
    act(() => first.api.togglePin("motion"));
    act(() => first.root.unmount());

    const secondSameKind = mount("text");
    expect(secondSameKind.api.pinnedGroupIds).toEqual(["motion"]);
    act(() => secondSameKind.root.unmount());

    const thirdOtherKind = mount("media");
    expect(thirdOtherKind.api.pinnedGroupIds).toEqual([]);
    act(() => thirdOtherKind.root.unmount());
  });
});
