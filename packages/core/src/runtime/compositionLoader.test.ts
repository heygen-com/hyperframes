import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { loadExternalCompositions } from "./compositionLoader";

// jsdom doesn't provide CSS.escape
beforeAll(() => {
  if (typeof globalThis.CSS === "undefined") {
    (globalThis as any).CSS = {};
  }
  if (typeof CSS.escape !== "function") {
    CSS.escape = (value: string) => value.replace(/([^\w-])/g, "\\$1");
  }
});

describe("loadExternalCompositions", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    document.head.querySelectorAll("style").forEach((s) => s.remove());
    vi.restoreAllMocks();
  });

  const defaultParams = {
    injectedStyles: [] as HTMLStyleElement[],
    injectedScripts: [] as HTMLScriptElement[],
    parseDimensionPx: (v: string | null) => (v ? `${v}px` : null),
  };

  it("does nothing when no composition-src elements exist", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await loadExternalCompositions({ ...defaultParams });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fetches and mounts external composition HTML", async () => {
    const host = document.createElement("div");
    host.setAttribute("data-composition-src", "https://example.com/comp.html");
    host.setAttribute("data-composition-id", "scene-1");
    document.body.appendChild(host);

    const compositionHtml = `
      <html><body>
        <div data-composition-id="scene-1" data-width="1920" data-height="1080">
          <p>Hello World</p>
        </div>
      </body></html>
    `;

    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(compositionHtml, { status: 200 }));

    await loadExternalCompositions({ ...defaultParams });

    const mountedParagraph = host.querySelector("p");

    expect(mountedParagraph).toBeTruthy();
    expect(mountedParagraph?.textContent).toBe("Hello World");
  });

  it("injects styles into document head", async () => {
    const host = document.createElement("div");
    host.setAttribute("data-composition-src", "https://example.com/comp.html");
    document.body.appendChild(host);

    const compositionHtml = `
      <html><body>
        <style>.test { color: red; }</style>
        <p>Styled</p>
      </body></html>
    `;

    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(compositionHtml, { status: 200 }));

    const injectedStyles: HTMLStyleElement[] = [];
    await loadExternalCompositions({
      ...defaultParams,
      injectedStyles,
    });

    expect(injectedStyles.length).toBeGreaterThan(0);
  });

  it("calls onDiagnostic when fetch fails", async () => {
    const host = document.createElement("div");
    host.setAttribute("data-composition-src", "https://example.com/broken.html");
    host.setAttribute("data-composition-id", "broken");
    document.body.appendChild(host);

    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network error"));

    const onDiagnostic = vi.fn();
    await loadExternalCompositions({
      ...defaultParams,
      onDiagnostic,
    });

    expect(onDiagnostic).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "external_composition_load_failed",
        details: expect.objectContaining({
          hostCompositionSrc: "https://example.com/broken.html",
          errorMessage: "Network error",
        }),
      }),
    );
  });

  it("calls onDiagnostic when HTTP response is not ok", async () => {
    const host = document.createElement("div");
    host.setAttribute("data-composition-src", "https://example.com/404.html");
    document.body.appendChild(host);

    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("Not Found", { status: 404 }));

    const onDiagnostic = vi.fn();
    await loadExternalCompositions({
      ...defaultParams,
      onDiagnostic,
    });

    expect(onDiagnostic).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "external_composition_load_failed",
      }),
    );
  });

  it("uses local template when available", async () => {
    const template = document.createElement("template");
    template.id = "local-comp-template";
    template.innerHTML = "<p>From template</p>";
    document.body.appendChild(template);

    const host = document.createElement("div");
    host.setAttribute("data-composition-src", "https://example.com/comp.html");
    host.setAttribute("data-composition-id", "local-comp");
    document.body.appendChild(host);

    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await loadExternalCompositions({ ...defaultParams });

    // Should use local template and not fetch
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(host.querySelector("p")?.textContent).toBe("From template");
  });

  it("skips hosts without data-composition-src value", async () => {
    const host = document.createElement("div");
    host.setAttribute("data-composition-src", "");
    document.body.appendChild(host);

    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await loadExternalCompositions({ ...defaultParams });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("clears host content before mounting", async () => {
    const host = document.createElement("div");
    host.setAttribute("data-composition-src", "https://example.com/comp.html");
    host.innerHTML = "<span>Old content</span>";
    document.body.appendChild(host);

    const compositionHtml = `<html><body><p>New</p></body></html>`;
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(compositionHtml, { status: 200 }));

    await loadExternalCompositions({ ...defaultParams });
    expect(host.querySelector("span")).toBeNull();
  });

  it("handles inline scripts", async () => {
    const host = document.createElement("div");
    host.setAttribute("data-composition-src", "https://example.com/comp.html");
    document.body.appendChild(host);

    // Only inline scripts (no external src) to avoid waitForExternalScriptLoad timeout
    const compositionHtml = `
      <html><body>
        <script>console.log("inline")</script>
        <p>With inline script</p>
      </body></html>
    `;

    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(compositionHtml, { status: 200 }));

    const injectedScripts: HTMLScriptElement[] = [];
    await loadExternalCompositions({
      ...defaultParams,
      injectedScripts,
    });

    expect(injectedScripts.length).toBeGreaterThan(0);
    expect(injectedScripts[0].textContent).toContain("console.log");
  });

  it("handles multiple compositions in parallel", async () => {
    const host1 = document.createElement("div");
    host1.setAttribute("data-composition-src", "https://example.com/a.html");
    document.body.appendChild(host1);

    const host2 = document.createElement("div");
    host2.setAttribute("data-composition-src", "https://example.com/b.html");
    document.body.appendChild(host2);

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("a.html")) {
        return new Response("<html><body><p>A</p></body></html>", { status: 200 });
      }
      return new Response("<html><body><p>B</p></body></html>", { status: 200 });
    });

    await loadExternalCompositions({ ...defaultParams });
    expect(host1.querySelector("p")?.textContent).toBe("A");
    expect(host2.querySelector("p")?.textContent).toBe("B");
  });
});
