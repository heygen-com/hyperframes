// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openComposition } from "@hyperframes/sdk";
import { VariablesPanel } from "./VariablesPanel";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const withTitle = (label: string) => `<!DOCTYPE html>
<html data-composition-variables='[{"id":"title","type":"string","label":"${label}","default":"Hello"}]'>
<body><div data-hf-id="hf-stage" data-hf-root data-duration="5"></div></body>
</html>`;

const files: Record<string, string> = {
  "index.html":
    '<html><body><div data-hf-id="hf-stage" data-hf-root data-duration="5"></div></body></html>',
  "scene.html": withTitle("Scene title"),
  ".hyperframes/preview/4884df6e.html": withTitle("Generated title"),
};

vi.mock("../../contexts/StudioContext", () => ({
  useStudioShellContext: () => ({ activeCompPath: "index.html", showToast: vi.fn() }),
  useStudioPlaybackContext: () => ({ refreshKey: 0 }),
}));
vi.mock("../../contexts/DomEditContext", () => ({
  useDomEditContext: () => ({ domEditSelection: null }),
}));
vi.mock("../../contexts/FileManagerContext", () => ({
  useFileManagerContext: () => ({
    readProjectFile: async (path: string) => files[path] ?? "",
    writeProjectFile: vi.fn(),
    fileTree: Object.keys(files),
    compositions: ["index.html", "scene.html"],
  }),
}));

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("VariablesPanel other compositions", () => {
  it("lists the project's compositions, not Studio's generated preview documents", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    const session = await openComposition(files["index.html"]!, { history: false });
    await act(async () => {
      root?.render(
        <VariablesPanel
          sdkSession={session}
          publishSdkSession={vi.fn()}
          reloadPreview={vi.fn()}
          recordEdit={vi.fn(async () => {})}
        />,
      );
    });
    await vi.waitFor(() => expect(host.textContent).toContain("scene.html"));

    expect(host.textContent).not.toContain(".hyperframes/preview");
  });
});
