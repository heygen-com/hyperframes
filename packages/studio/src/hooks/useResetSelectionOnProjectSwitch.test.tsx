// @vitest-environment happy-dom

import { act, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useResetSelectionOnProjectSwitch } from "./useResetSelectionOnProjectSwitch";
import { useAutoOpenRootComposition } from "./useAutoOpenRootComposition";
import { isHydratedFromUrlState, readStudioUrlStateFromWindow } from "../utils/studioUrlState";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  window.location.hash = "";
});

describe("useResetSelectionOnProjectSwitch", () => {
  function ResetHarness({ projectId }: { projectId: string | null }) {
    const initialUrlStateRef = useRef(readStudioUrlStateFromWindow());
    const [activeCompPath, setActiveCompPath] = useState<string | null>("stale-comp.html");
    const [activeCompPathHydrated, setActiveCompPathHydrated] = useState(true);
    useResetSelectionOnProjectSwitch({
      projectId,
      initialUrlStateRef,
      setActiveCompPath,
      setActiveCompPathHydrated,
    });
    return (
      <div
        data-active-comp-path={activeCompPath ?? ""}
        data-hydrated={String(activeCompPathHydrated)}
      />
    );
  }

  it("does not reset on the initial resolution from null", () => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => {
      root?.render(<ResetHarness projectId={null} />);
    });
    act(() => {
      root?.render(<ResetHarness projectId="project-a" />);
    });
    const el = host.firstElementChild as HTMLElement;
    expect(el.dataset.activeCompPath).toBe("stale-comp.html");
  });

  it("resets activeCompPath and re-derives hydrated on an actual project switch", () => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => {
      root?.render(<ResetHarness projectId="project-a" />);
    });
    act(() => {
      root?.render(<ResetHarness projectId="project-b" />);
    });
    const el = host.firstElementChild as HTMLElement;
    expect(el.dataset.activeCompPath).toBe("");
    expect(el.dataset.hydrated).toBe("true");
  });
});

describe("project switch integration (mirrors App.tsx's wiring)", () => {
  function AppLikeHarness({
    projectId,
    masterCompPath,
    onSelectComposition,
  }: {
    projectId: string | null;
    masterCompPath: string | null;
    onSelectComposition: (comp: string) => void;
  }) {
    const initialUrlStateRef = useRef(readStudioUrlStateFromWindow());
    const [activeCompPath, setActiveCompPath] = useState<string | null>(null);
    const [activeCompPathHydrated, setActiveCompPathHydrated] = useState(() =>
      isHydratedFromUrlState(initialUrlStateRef.current),
    );
    // Mirrors handleSelectComposition (useCompositionContentLoader): selecting a composition
    // also updates activeCompPath, which is exactly the state that must be reset on switch.
    const handleSelect = (comp: string) => {
      setActiveCompPath(comp);
      onSelectComposition(comp);
    };
    // Mirrors useActiveComposition's wiring: reset as a sibling call, before auto-open.
    useResetSelectionOnProjectSwitch({
      projectId,
      initialUrlStateRef,
      setActiveCompPath,
      setActiveCompPathHydrated,
    });
    useAutoOpenRootComposition({
      projectId,
      activeCompPath,
      activeCompPathHydrated,
      masterCompPath,
      onSelectComposition: handleSelect,
    });
    return null;
  }

  it("opens the new project's root after switching projects with a composition already open", () => {
    const onSelectComposition = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    // Project A resolves and auto-opens its root, which also sets activeCompPath — the
    // "something already open" state a real user would be in before switching projects.
    act(() => {
      root?.render(
        <AppLikeHarness
          projectId="project-a"
          masterCompPath="index.html"
          onSelectComposition={onSelectComposition}
        />,
      );
    });
    expect(onSelectComposition).toHaveBeenCalledExactlyOnceWith("index.html");
    onSelectComposition.mockClear();

    // Switch to project B in-session (hash change, no remount) — this is the exact scenario
    // the adversarial review found broken: activeCompPath was never reset, so project B's
    // auto-open silently no-op'd because activeCompPath still read as "already set".
    act(() => {
      root?.render(
        <AppLikeHarness
          projectId="project-b"
          masterCompPath="hero.html"
          onSelectComposition={onSelectComposition}
        />,
      );
    });

    expect(onSelectComposition).toHaveBeenCalledExactlyOnceWith("hero.html");
  });
});
