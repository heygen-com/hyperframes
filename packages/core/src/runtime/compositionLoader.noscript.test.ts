/**
 * @vitest-environment-options { "runScripts": "dangerously" }
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadCompositions } from "./compositionLoader";

beforeEach(() => {
  (globalThis as { CSS?: { escape?: (value: string) => string } }).CSS ??= {};
  CSS.escape ??= (value: string) => value.replace(/([^\w-])/g, "\\$1");
  const base = document.createElement("base");
  base.href = "https://example.com/";
  document.head.prepend(base);
});

afterEach(() => {
  vi.restoreAllMocks();
  document.head.querySelectorAll("base").forEach((base) => base.remove());
  document.body.innerHTML = "";
});

// Scripting is on here, as in the preview, so the page reads a noscript's contents as text.
// fails without the fix: the fallback mounted the fetched body as a string, which the page re-read with scripting on.
describe("loadCompositions with scripting on", () => {
  it("mounts a fetched body without a mark hidden in a noscript comment", async () => {
    const host = document.createElement("div");
    host.setAttribute("data-composition-src", "https://example.com/comp.html");
    host.setAttribute("data-composition-id", "scene-1");
    document.body.appendChild(host);
    const compositionHtml = `<html><body><p id="kept">Kept</p>
      <noscript><!-- </noscript><p id="claim" data-composition-file="index.html">Hello</p> --></noscript>
    </body></html>`;
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(compositionHtml, { status: 200 }));

    await loadCompositions({
      injectedStyles: [],
      injectedScripts: [],
      injectedLinks: [],
      parseDimensionPx: (value) => (value ? `${value}px` : null),
    });

    expect(host.querySelector("#kept")?.textContent).toBe("Kept");
    expect(host.querySelectorAll("[data-composition-file]")).toHaveLength(0);
  });
});
