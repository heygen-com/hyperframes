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
