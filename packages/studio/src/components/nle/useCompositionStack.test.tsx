// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { installReactActEnvironment } from "../../hooks/domSelectionTestHarness";
import { useCompositionStack } from "./useCompositionStack";

installReactActEnvironment();

describe("useCompositionStack — project scoping", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  for (const activeCompositionPath of [null, "index.html"] as const) {
    it(`rebuilds the master preview URL on a project switch with ${String(activeCompositionPath)}`, async () => {
      const host = document.createElement("div");
      document.body.append(host);
      const root = createRoot(host);
      let previewUrl = "";

      function Harness(props: { projectId: string; activeCompositionPath: string | null }) {
        previewUrl = useCompositionStack(props).compositionStack[0]?.previewUrl ?? "";
        return null;
      }

      await act(async () => {
        root.render(
          <Harness projectId="project-a" activeCompositionPath={activeCompositionPath} />,
        );
      });
      expect(previewUrl).toBe("/api/projects/project-a/preview");

      await act(async () => {
        root.render(
          <Harness projectId="project-b" activeCompositionPath={activeCompositionPath} />,
        );
      });
      expect(previewUrl).toBe("/api/projects/project-b/preview");

      act(() => root.unmount());
    });
  }
});

describe("useCompositionStack — activating a composition by path", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  function mountStack(activeCompositionPath: string | null) {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const seen: { stack: ReturnType<typeof useCompositionStack>["compositionStack"] } = {
      stack: [],
    };

    function Harness(props: { activeCompositionPath: string | null }) {
      seen.stack = useCompositionStack({ projectId: "p", ...props }).compositionStack;
      return null;
    }

    return { root, seen, Harness, activeCompositionPath };
  }

  // The root stays on the master level; everything else pushes a second level.
  for (const path of [
    "compositions/scene-a.html",
    "parts/part-1.html",
    "chapter-2.html",
    "a/b/c/deep.html",
  ]) {
    it(`pushes a level for ${path}`, async () => {
      const { root, seen, Harness } = mountStack(path);

      await act(async () => {
        root.render(<Harness activeCompositionPath={path} />);
      });

      expect(seen.stack).toHaveLength(2);
      expect(seen.stack[1]?.id).toBe(path);
      expect(seen.stack[1]?.previewUrl).toBe(`/api/projects/p/preview/comp/${path}`);

      act(() => root.unmount());
    });
  }

  it("labels a non-compositions/ path without mangling it", async () => {
    const { root, seen, Harness } = mountStack("parts/part-1.html");

    await act(async () => {
      root.render(<Harness activeCompositionPath="parts/part-1.html" />);
    });

    expect(seen.stack[1]?.label).toBe("parts/part-1");

    act(() => root.unmount());
  });

  it("keeps the master alone for the root composition", async () => {
    const { root, seen, Harness } = mountStack("index.html");

    await act(async () => {
      root.render(<Harness activeCompositionPath="index.html" />);
    });

    expect(seen.stack).toHaveLength(1);
    expect(seen.stack[0]?.id).toBe("master");

    act(() => root.unmount());
  });
});
