// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStudioApi, type StudioApiAdapter } from "@hyperframes/studio-server";
import { useCaptionStore } from "../store";
import type { CaptionModel } from "../types";
import { useProjectFileWriter } from "../../hooks/useProjectFileWriter";
import { useCaptionSync } from "./useCaptionSync";

afterEach(() => vi.unstubAllGlobals());

function Harness() {
  useCaptionSync(useProjectFileWriter({ projectId: "p" }));
  return null;
}

describe("useCaptionSync", () => {
  it.each([
    [
      { why: "permission" },
      "caption-overrides.json can't be changed: it is read-only or protected. Check its permissions, then try again.",
    ],
    [{ error: "boom" }, "Caption changes couldn't be saved"],
  ])("says why a refused save failed: %o", async (answer, words) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(answer), { status: 403 })),
    );
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(createElement(Harness)));
    const model = { groupOrder: [], groups: new Map(), segments: new Map() };
    useCaptionStore.setState({
      model: model as unknown as CaptionModel,
      sourceFilePath: "index.html",
    });

    await act(async () => {
      useCaptionStore.getState().retrySave?.();
      await vi.waitFor(() => expect(useCaptionStore.getState().syncError).not.toBeNull());
    });

    expect(useCaptionStore.getState().syncError).toBe(words);
    await act(async () => root.unmount());
    useCaptionStore.setState({ model: null, sourceFilePath: null, syncError: null });
  });
  it("saves an edited word to the project through the real files route", async () => {
    const project = mkdtempSync(join(tmpdir(), "hf-caption-save-"));
    const api = createStudioApi({
      listProjects: () => [],
      resolveProject: (id: string) => (id === "p" ? { id, dir: project } : null),
    } as unknown as StudioApiAdapter);
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) =>
      api.request(url.replace(/^\/api/, ""), init),
    );
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(createElement(Harness)));
    const model = {
      groupOrder: ["g"],
      groups: new Map([["g", { segmentIds: ["s"] }]]),
      segments: new Map([["s", { wordId: "w0", style: { x: 12 } }]]),
    };
    useCaptionStore.setState({
      model: model as unknown as CaptionModel,
      sourceFilePath: "index.html",
    });

    await act(async () => {
      useCaptionStore.getState().retrySave?.();
      await vi.waitFor(() =>
        expect(existsSync(join(project, "caption-overrides.json"))).toBe(true),
      );
    });

    expect(JSON.parse(readFileSync(join(project, "caption-overrides.json"), "utf8"))).toEqual([
      { wordId: "w0", wordIndex: 0, x: 12 },
    ]);
    expect(useCaptionStore.getState().syncError).toBeNull();
    await act(async () => root.unmount());
    useCaptionStore.setState({ model: null, sourceFilePath: null, syncError: null });
    rmSync(project, { recursive: true, force: true });
  });
});
