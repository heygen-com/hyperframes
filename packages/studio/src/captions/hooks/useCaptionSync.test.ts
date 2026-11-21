// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCaptionStore } from "../store";
import type { CaptionModel } from "../types";
import { useCaptionSync } from "./useCaptionSync";

afterEach(() => vi.unstubAllGlobals());

function Harness() {
  useCaptionSync("p");
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
});
