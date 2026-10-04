import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AFTER_FONTS_CLAIM,
  AFTER_FONTS_SCRIPT_TYPE,
  deferScriptsUntilFonts,
} from "../compiler/scriptRuns";
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
const claims = (claimed: boolean) =>
  claimed
    ? ((window as unknown as Record<string, unknown>)[AFTER_FONTS_CLAIM] = true)
    : delete (window as unknown as Record<string, unknown>)[AFTER_FONTS_CLAIM];

// A page compiled elsewhere and imported, so jsdom runs none of its scripts; the test runs the fallback.
function compilePage(): void {
  const compiled = new DOMParser().parseFromString(
    `<output id="log"></output><script>${logs("a")}</script><script>${logs("b")}</script>`,
    "text/html",
  );
  deferScriptsUntilFonts(compiled);
  const fallback = compiled.head.querySelector("script")!;
  expect(fallback.textContent).toContain("no web-font gate");
  document.body.replaceChildren(
    ...Array.from(compiled.body.childNodes, (node) => document.importNode(node, true)),
  );
  new Function(fallback.textContent!)();
}

describe("runtime entry: composition scripts after web fonts", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    window.__hfRuntimeTeardown?.();
    document.body.innerHTML = "";
    window.__timelines = {};
    claims(true);
    delete window.__player;
    delete (window as { __hyperframeRuntimeBootstrapped?: boolean })
      .__hyperframeRuntimeBootstrapped;
    delete (document as { fonts?: unknown }).fonts;
    delete (document as { addEventListener?: unknown }).addEventListener;
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

  it("keeps an addEventListener wrapper a deferred script installs while its load events are held", async () => {
    serveFonts(Promise.resolve(), []);
    document.body.innerHTML =
      `<output id="log"></output>` +
      `<script type="${AFTER_FONTS_SCRIPT_TYPE}">var add = document.addEventListener;` +
      `document.addEventListener = function () { ${logs("wrapped")} return add.apply(this, arguments); };` +
      `</script>`;

    await parseThenLoad();
    await vi.waitFor(() => expect(window.__player).toBeDefined());
    const before = log();
    document.addEventListener("hf-later", () => {});
    expect(log()).toBe(`${before}wrapped `);
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

  it("runs deferred scripts once and in order through the page's fallback when the runtime predates the gate", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    claims(false);
    compilePage();

    document.dispatchEvent(new Event("DOMContentLoaded"));
    document.dispatchEvent(new Event("DOMContentLoaded"));
    expect(log()).toBe("a b ");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("no web-font gate"));
  });

  it("leaves the scripts to a runtime with the gate, which runs them once after fonts", async () => {
    let fontsLoaded = () => {};
    serveFonts(new Promise<void>((resolve) => (fontsLoaded = resolve)), []);
    claims(false);
    compilePage();

    await parseThenLoad();
    await Promise.resolve();
    expect(log()).toBe("");
    fontsLoaded();
    await vi.waitFor(() => expect(window.__player).toBeDefined());
    document.dispatchEvent(new Event("DOMContentLoaded"));
    expect(log()).toBe("a b ");
  });
});
