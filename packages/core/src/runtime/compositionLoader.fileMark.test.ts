import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadCompositions } from "./compositionLoader";

const load = () =>
  loadCompositions({
    injectedStyles: [],
    injectedScripts: [],
    injectedLinks: [],
    parseDimensionPx: (value) => (value ? `${value}px` : null),
  });

const host = (src: string, compositionId: string) => {
  const el = document.createElement("div");
  el.setAttribute("data-composition-src", src);
  el.setAttribute("data-composition-id", compositionId);
  document.body.appendChild(el);
  return el;
};

beforeAll(() => {
  if (typeof globalThis.CSS === "undefined") (globalThis as { CSS?: object }).CSS = {};
  if (typeof CSS.escape !== "function")
    CSS.escape = (value: string) => value.replace(/([^\w-])/g, "\\$1");
});

// fails without the fix: a host kept only its authored data-composition-src, which then chose where edits were written
describe("the file a mounted composition host is stamped with", () => {
  beforeEach(() => {
    const base = document.createElement("base");
    base.href = "https://example.com/";
    document.head.prepend(base);
  });
  afterEach(() => {
    document.head.querySelectorAll("base").forEach((base) => base.remove());
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("stamps a host the runtime mounted from a fetched file with that file", async () => {
    const mounted = host("compositions/scene.html", "scene-1");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(`<html><body><div data-composition-id="scene-1"><p>x</p></div></body></html>`),
    );
    await load();
    expect(mounted.querySelector("p")).toBeTruthy();
    expect(mounted.getAttribute("data-composition-file")).toBe("compositions/scene.html");
  });

  it("stamps no file on a host whose content came from a template in this page", async () => {
    document.body.innerHTML = `<template id="scene-1-template"><div data-composition-id="scene-1"><p>x</p></div></template>`;
    const mounted = host("index.html", "scene-1");
    const fetch = vi.spyOn(globalThis, "fetch");
    await load();
    expect(fetch).not.toHaveBeenCalled();
    expect(mounted.querySelector("p")).toBeTruthy();
    expect(mounted.hasAttribute("data-composition-file")).toBe(false);
  });

  it("stamps no file on a host whose file failed to load", async () => {
    const mounted = host("compositions/missing.html", "scene-1");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 404 }));
    await load();
    expect(mounted.hasAttribute("data-composition-file")).toBe(false);
  });
});
