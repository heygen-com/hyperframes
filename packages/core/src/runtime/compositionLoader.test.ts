import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { loadExternalCompositions, loadInlineTemplateCompositions } from "./compositionLoader";

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

describe("loadInlineTemplateCompositions", () => {
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

  it("mounts template content into matching empty host", async () => {
    const template = document.createElement("template");
    template.id = "logo-reveal-template";
    template.innerHTML = `
      <div data-composition-id="logo-reveal" data-width="1920" data-height="1080">
        <p>Logo content</p>
      </div>
    `;
    document.body.appendChild(template);

    const host = document.createElement("div");
    host.setAttribute("data-composition-id", "logo-reveal");
    host.setAttribute("data-start", "0");
    host.setAttribute("data-duration", "10");
    document.body.appendChild(host);

    await loadInlineTemplateCompositions({ ...defaultParams });

    expect(host.querySelector("p")?.textContent).toBe("Logo content");
  });

  it("does nothing when no matching template exists", async () => {
    const host = document.createElement("div");
    host.setAttribute("data-composition-id", "no-template");
    document.body.appendChild(host);

    await loadInlineTemplateCompositions({ ...defaultParams });

    // Host should remain empty
    expect(host.children.length).toBe(0);
  });

  it("does nothing when no inline template hosts exist", async () => {
    // Add a template with no matching host
    const template = document.createElement("template");
    template.id = "orphan-template";
    template.innerHTML = "<p>Orphan</p>";
    document.body.appendChild(template);

    await loadInlineTemplateCompositions({ ...defaultParams });

    // Nothing should change — no hosts match
    expect(document.querySelector("p")).toBeNull();
  });

  it("skips hosts that already have content", async () => {
    const template = document.createElement("template");
    template.id = "filled-template";
    template.innerHTML = `
      <div data-composition-id="filled" data-width="800" data-height="600">
        <p>Template content</p>
      </div>
    `;
    document.body.appendChild(template);

    const host = document.createElement("div");
    host.setAttribute("data-composition-id", "filled");
    host.innerHTML = "<span>Existing content</span>";
    document.body.appendChild(host);

    await loadInlineTemplateCompositions({ ...defaultParams });

    // Original content should remain
    expect(host.querySelector("span")?.textContent).toBe("Existing content");
    expect(host.querySelector("p")).toBeNull();
  });

  it("skips hosts that have data-composition-src", async () => {
    const template = document.createElement("template");
    template.id = "external-template";
    template.innerHTML = `
      <div data-composition-id="external" data-width="800" data-height="600">
        <p>Should not mount</p>
      </div>
    `;
    document.body.appendChild(template);

    const host = document.createElement("div");
    host.setAttribute("data-composition-id", "external");
    host.setAttribute("data-composition-src", "https://example.com/comp.html");
    document.body.appendChild(host);

    await loadInlineTemplateCompositions({ ...defaultParams });

    // Host should not have template content (it has data-composition-src)
    expect(host.querySelector("p")).toBeNull();
  });

  it("processes multiple inline templates", async () => {
    const template1 = document.createElement("template");
    template1.id = "comp-a-template";
    template1.innerHTML = `
      <div data-composition-id="comp-a" data-width="1920" data-height="1080">
        <p>Content A</p>
      </div>
    `;
    document.body.appendChild(template1);

    const template2 = document.createElement("template");
    template2.id = "comp-b-template";
    template2.innerHTML = `
      <div data-composition-id="comp-b" data-width="800" data-height="600">
        <p>Content B</p>
      </div>
    `;
    document.body.appendChild(template2);

    const host1 = document.createElement("div");
    host1.setAttribute("data-composition-id", "comp-a");
    document.body.appendChild(host1);

    const host2 = document.createElement("div");
    host2.setAttribute("data-composition-id", "comp-b");
    document.body.appendChild(host2);

    await loadInlineTemplateCompositions({ ...defaultParams });

    expect(host1.querySelector("p")?.textContent).toBe("Content A");
    expect(host2.querySelector("p")?.textContent).toBe("Content B");
  });

  it("injects styles from template into document head", async () => {
    const template = document.createElement("template");
    template.id = "styled-comp-template";
    template.innerHTML = `
      <div data-composition-id="styled-comp" data-width="1920" data-height="1080">
        <style>.test-inline { color: blue; }</style>
        <p>Styled content</p>
      </div>
    `;
    document.body.appendChild(template);

    const host = document.createElement("div");
    host.setAttribute("data-composition-id", "styled-comp");
    document.body.appendChild(host);

    const injectedStyles: HTMLStyleElement[] = [];
    await loadInlineTemplateCompositions({
      ...defaultParams,
      injectedStyles,
    });

    expect(injectedStyles.length).toBeGreaterThan(0);
  });

  it("injects scripts from template", async () => {
    const template = document.createElement("template");
    template.id = "scripted-comp-template";
    template.innerHTML = `
      <div data-composition-id="scripted-comp" data-width="1920" data-height="1080">
        <p>Content with script</p>
        <script>console.log("inline template script")</script>
      </div>
    `;
    document.body.appendChild(template);

    const host = document.createElement("div");
    host.setAttribute("data-composition-id", "scripted-comp");
    document.body.appendChild(host);

    const injectedScripts: HTMLScriptElement[] = [];
    await loadInlineTemplateCompositions({
      ...defaultParams,
      injectedScripts,
    });

    expect(injectedScripts.length).toBeGreaterThan(0);
    expect(injectedScripts[0].textContent).toContain("inline template script");
  });

  it("copies dimension attributes from template inner root to host", async () => {
    const template = document.createElement("template");
    template.id = "dim-comp-template";
    template.innerHTML = `
      <div data-composition-id="dim-comp" data-width="1920" data-height="1080">
        <p>Dimensioned</p>
      </div>
    `;
    document.body.appendChild(template);

    const host = document.createElement("div");
    host.setAttribute("data-composition-id", "dim-comp");
    document.body.appendChild(host);

    await loadInlineTemplateCompositions({ ...defaultParams });

    expect(host.getAttribute("data-width")).toBe("1920");
    expect(host.getAttribute("data-height")).toBe("1080");
  });
});
