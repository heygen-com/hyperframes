// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LeftSidebar } from "./LeftSidebar";

vi.mock("../../utils/studioTelemetry", () => ({ trackStudioEvent: vi.fn() }));
vi.mock("./CompositionsTab", () => ({ CompositionsTab: () => <div /> }));
vi.mock("./AssetsTab", () => ({ AssetsTab: () => <div /> }));
vi.mock("./BlocksTab", () => ({ BlocksTab: () => <div /> }));
vi.mock("../editor/FileTree", () => ({ FileTree: () => <div>Files</div> }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

afterEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
});

describe("LeftSidebar code layout", () => {
  it("reserves a usable editor width at the minimum sidebar width", () => {
    localStorage.setItem("hf-studio-sidebar-tab", "code");
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    act(() => {
      root.render(
        <LeftSidebar
          width={160}
          projectId="project-1"
          compositions={[]}
          assets={[]}
          activeComposition="index.html"
          onSelectComposition={() => {}}
          fileTree={["index.html"]}
          editingFile={{ path: "index.html", content: "" }}
          codeChildren={<div aria-label="Source editor" />}
        />,
      );
    });

    const editor = host.querySelector('[aria-label="Source editor"]');
    if (!editor?.parentElement?.parentElement) throw new Error("code layout did not render");
    expect(editor.parentElement.parentElement.style.gridTemplateColumns).toBe(
      "minmax(80px, 160px) minmax(80px, 1fr)",
    );

    act(() => root.unmount());
  });

  it("lets the editor fill the sidebar when the file tree is empty", () => {
    localStorage.setItem("hf-studio-sidebar-tab", "code");
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    act(() => {
      root.render(
        <LeftSidebar
          width={160}
          projectId="project-1"
          compositions={[]}
          assets={[]}
          activeComposition={null}
          onSelectComposition={() => {}}
          fileTree={[]}
          codeChildren={<div aria-label="Source editor" />}
        />,
      );
    });

    const editor = host.querySelector('[aria-label="Source editor"]');
    if (!editor?.parentElement?.parentElement) throw new Error("code layout did not render");
    expect(editor.parentElement.parentElement.style.gridTemplateColumns).toBe("minmax(80px, 1fr)");

    act(() => root.unmount());
  });
});
