import { afterEach, describe, expect, it, vi } from "vitest";
import { AFTER_FONTS_SCRIPT_TYPE } from "../compiler/scriptRuns";
import { FONT_WAIT_TIMEOUT_MS } from "./afterFonts";

type Face = { family: string; status: FontFaceLoadStatus };

// jsdom runs scripts in its own global, so they report through the shared document.
const logs = (entry: string) =>
  `document.getElementById("log").textContent += ${JSON.stringify(`${entry} `)};`;

function mountDeferredScripts(): void {
  document.body.innerHTML =
    `<output id="log"></output>` +
    `<div data-composition-id="main" data-root="true" data-start="0" data-width="1920" data-height="1080">` +
    `<div id="scene"><script type="${AFTER_FONTS_SCRIPT_TYPE}">${logs("a")}` +
    `document.addEventListener("DOMContentLoaded", function () { ${logs("ready")} });` +
    `if (document.currentScript.closest("#scene")) { ${logs("in-place")} }</script></div></div>` +
    `<script type="${AFTER_FONTS_SCRIPT_TYPE}">${logs("b")}</script>`;
}

function serveFonts(ready: Promise<unknown>, faces: Face[]): void {
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { ready, [Symbol.iterator]: () => faces[Symbol.iterator]() },
  });
}

async function parseThenLoad(): Promise<void> {
  Object.defineProperty(document, "readyState", { configurable: true, get: () => "loading" });
  vi.resetModules();
  await import("./entry");
  delete (document as { readyState?: unknown }).readyState;
  document.dispatchEvent(new Event("DOMContentLoaded"));
}

const log = () => document.getElementById("log")!.textContent;

describe("runtime entry: composition scripts after web fonts", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    window.__hfRuntimeTeardown?.();
    document.body.innerHTML = "";
    window.__timelines = {};
    delete window.__player;
    delete (window as { __hyperframeRuntimeBootstrapped?: boolean })
      .__hyperframeRuntimeBootstrapped;
    delete (document as { fonts?: unknown }).fonts;
  });

  it("runs deferred scripts once fonts are ready, in order and in place, then boots and fires their DOMContentLoaded", async () => {
    let fontsLoaded = () => {};
    serveFonts(new Promise<void>((resolve) => (fontsLoaded = resolve)), []);
    mountDeferredScripts();

    await parseThenLoad();
    await Promise.resolve();
    expect(log()).toBe("");
    expect(window.__player).toBeUndefined();

    fontsLoaded();
    await vi.waitFor(() => expect(window.__player).toBeDefined());
    expect(log()).toBe("a in-place b ready ");
    expect(document.querySelectorAll(`script[type="${AFTER_FONTS_SCRIPT_TYPE}"]`)).toHaveLength(0);
  });

  it("runs the scripts at the font timeout and reports the families still loading", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const posted = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    serveFonts(new Promise(() => {}), [
      { family: "Hanken Grotesk", status: "loading" },
      { family: "Inter", status: "loaded" },
    ]);
    mountDeferredScripts();

    await parseThenLoad();
    await vi.advanceTimersByTimeAsync(FONT_WAIT_TIMEOUT_MS - 1);
    expect(log()).toBe("");

    await vi.advanceTimersByTimeAsync(1);
    expect(log()).toMatch(/^a .*b /);
    expect(posted).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "diagnostic",
        code: "runtime_font_wait_timeout",
        details: { loadingFamilies: ["Hanken Grotesk"], timeoutMs: FONT_WAIT_TIMEOUT_MS },
      }),
      "*",
    );
  });
});
