// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openComposition } from "@hyperframes/sdk";
import { VariablesPanel } from "./VariablesPanel";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const withTitle = (id: string, label: string) => `<!DOCTYPE html>
<html data-composition-variables='[{"id":"title","type":"string","label":"${label}","default":"Hello"}]'>
<body><div data-composition-id="${id}" data-hf-id="hf-stage" data-hf-root data-duration="5"></div></body>
</html>`;

const files: Record<string, string> = {
  "index.html":
    '<html><body><div data-hf-id="hf-stage" data-hf-root data-duration="5"></div></body></html>',
  "main.html": withTitle("main", "Main title"),
  "scene.html": withTitle("scene", "Scene title"),
  ".hyperframes/preview/4884df6e.html": withTitle("root", "Generated title"),
};
const shell = {
  activeCompPath: "index.html" as string | null,
  compositions: ["index.html", "scene.html"],
};
const showToast = vi.fn();
const copyTextToClipboard = vi.fn(async (_text: string) => true);

vi.mock("../../contexts/StudioContext", () => ({
  useStudioShellContext: () => ({
    projectId: "demo",
    activeCompPath: shell.activeCompPath,
    showToast,
  }),
  useStudioPlaybackContext: () => ({ refreshKey: 0 }),
}));
vi.mock("../../utils/clipboard", () => ({
  copyTextToClipboard: (text: string) => copyTextToClipboard(text),
}));
vi.mock("../../contexts/DomEditContext", () => ({
  useDomEditContext: () => ({ domEditSelection: null }),
}));
vi.mock("../../contexts/FileManagerContext", () => ({
  useFileManagerContext: () => ({
    readProjectFile: async (path: string) => files[path] ?? "",
    writeProjectFile: vi.fn(),
    fileTree: Object.keys(files),
    compositions: shell.compositions,
  }),
}));

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  showToast.mockClear();
  copyTextToClipboard.mockClear();
  vi.unstubAllGlobals();
});

async function renderPanel(html: string): Promise<HTMLElement> {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const session = await openComposition(html, { history: false });
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
  return host;
}

async function renderOtherCompositions(sessionPath: string): Promise<string> {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const session = await openComposition(files[sessionPath]!, { history: false });
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
  const other = () =>
    [...host.querySelectorAll("p")].find((p) => p.textContent === "Other compositions")
      ?.parentElement?.textContent ?? "";
  await vi.waitFor(() => expect(other()).toContain("scene.html"));
  return other();
}

describe("VariablesPanel other compositions", () => {
  it("lists the project's compositions, not Studio's generated preview documents", async () => {
    shell.activeCompPath = "index.html";
    shell.compositions = ["index.html", "scene.html"];
    expect(await renderOtherCompositions("index.html")).not.toContain(".hyperframes/preview");
  });

  it("leaves out the main composition in the master view when it is not index.html", async () => {
    shell.activeCompPath = null;
    shell.compositions = ["main.html", "scene.html"];
    expect(await renderOtherCompositions("main.html")).not.toContain("main.html");
  });
});

// A shared project's author writes these, so they reach the copied command as hostile text.
const HOSTILE = `x'; calc.exe; '" & calc.exe | calc.exe \\ $(id) %PATH%`;
const withHostileDefault = `<!DOCTYPE html>
<html data-composition-variables='${JSON.stringify([
  { id: "title", type: "string", label: "Title", default: HOSTILE },
]).replace(/'/g, "&#39;")}'>
<body><div data-composition-id="main" data-hf-id="hf-stage" data-hf-root data-duration="5"></div></body>
</html>`;

const button = (host: HTMLElement, label: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === label);

describe("VariablesPanel render command", () => {
  it("does not let a hostile variable default into the copied render command", async () => {
    shell.activeCompPath = "compositions/intro.html";
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response("{}"));
    vi.stubGlobal("fetch", fetch);
    const host = await renderPanel(withHostileDefault);
    const expected =
      "npx hyperframes render -c compositions/intro.html --variables-file .hyperframes/render-variables.json";

    expect(host.querySelector("code")?.textContent).toBe(expected);
    await act(async () => button(host, "Copy render command")?.click());

    expect(copyTextToClipboard).toHaveBeenCalledWith(expected);
    await vi.waitFor(() => expect(showToast).toHaveBeenCalledWith("Render command copied", "info"));
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("/api/projects/demo/render-variables");
    expect(JSON.parse(String(init?.body))).toEqual({ title: HOSTILE });
  });

  it("says the values were not saved when the server refuses them", async () => {
    shell.activeCompPath = "index.html";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 403 })),
    );
    const host = await renderPanel(withHostileDefault);

    await act(async () => button(host, "Copy render command")?.click());

    await vi.waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        "Couldn't save the values to .hyperframes/render-variables.json",
        "error",
      ),
    );
  });

  it("offers no render command for a composition whose name a shell reads as syntax", async () => {
    shell.activeCompPath = "x';calc;'.html";
    const host = await renderPanel(withHostileDefault);

    expect(button(host, "Copy render command")).toBeUndefined();
    expect(button(host, "Copy values JSON")).toBeDefined();
    expect(host.textContent).not.toContain("npx hyperframes render");
  });
});
