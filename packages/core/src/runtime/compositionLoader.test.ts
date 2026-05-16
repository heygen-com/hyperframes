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
    delete (window as Window & { gsap?: unknown; __selectedTitle?: unknown }).gsap;
    delete (window as Window & { gsap?: unknown; __selectedTitle?: unknown }).__selectedTitle;
    delete (window as Window & { __hyperframes?: unknown }).__hyperframes;
    delete (window as Window & { __timelines?: unknown }).__timelines;
    delete (window as WindowWithScopedVars).__hfVariablesByComp;
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
    expect(host.getAttribute("data-width")).toBe("1920");
    expect(host.getAttribute("data-height")).toBe("1080");
    expect(
      Array.from(host.children).some(
        (child) => child.getAttribute("data-composition-id") === "scene-1",
      ),
    ).toBe(false);
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

  it("scopes injected styles and document selectors to the mounted composition root", async () => {
    const otherRoot = document.createElement("div");
    otherRoot.setAttribute("data-composition-id", "other");
    otherRoot.innerHTML = '<h1 class="title">Other</h1>';
    document.body.appendChild(otherRoot);

    const host = document.createElement("div");
    host.setAttribute("data-composition-src", "https://example.com/comp.html");
    host.setAttribute("data-composition-id", "scene");
    document.body.appendChild(host);

    const compositionHtml = `
      <html><body>
        <div data-composition-id="scene" data-width="1920" data-height="1080">
          <style>.title { opacity: 0; }</style>
          <h1 class="title">Scene</h1>
          <script>
            window.__selectedTitle = document.querySelector('.title')?.textContent;
          </script>
        </div>
      </body></html>
    `;

    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(compositionHtml, { status: 200 }));

    const injectedStyles: HTMLStyleElement[] = [];
    const injectedScripts: HTMLScriptElement[] = [];
    await loadExternalCompositions({
      ...defaultParams,
      injectedStyles,
      injectedScripts,
    });

    expect(injectedStyles[0]?.textContent).toContain('[data-composition-id="scene"] .title');
    expect(injectedScripts[0]?.textContent).toContain('var __hfCompId = "scene";');
    expect(injectedScripts[0]?.textContent).toContain("new Proxy(window.document");
    expect(host.querySelector(".title")?.textContent).toBe("Scene");
    expect(
      Array.from(host.children).some(
        (child) => child.getAttribute("data-composition-id") === "scene",
      ),
    ).toBe(false);
  });

  it("preserves the authored inner root wrapper for class and id scoped styles", async () => {
    const host = document.createElement("div");
    host.setAttribute("data-composition-src", "https://example.com/comp.html");
    host.setAttribute("data-composition-id", "scene");
    document.body.appendChild(host);

    const compositionHtml = `
      <html><body>
        <div id="scene-root" class="scene-root" data-composition-id="scene" data-width="1920" data-height="1080">
          <style>
            .scene-root .title { opacity: 0; }
            #scene-root { font-family: Inter, sans-serif; }
          </style>
          <h1 class="title">Scene</h1>
        </div>
      </body></html>
    `;

    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(compositionHtml, { status: 200 }));

    const injectedStyles: HTMLStyleElement[] = [];
    const injectedScripts: HTMLScriptElement[] = [];
    await loadExternalCompositions({
      ...defaultParams,
      injectedStyles,
      injectedScripts,
    });

    const authoredRoot = host.querySelector('[data-hf-authored-id="scene-root"]');
    expect(authoredRoot).toBeTruthy();
    expect(authoredRoot?.id).toBe("");
    expect(authoredRoot?.getAttribute("data-composition-id")).toBeNull();
    expect(authoredRoot?.getAttribute("data-hf-inner-root")).toBe("true");
    expect(authoredRoot?.getAttribute("data-hf-authored-id")).toBe("scene-root");
    expect(injectedStyles[0]?.textContent).toContain(
      '[data-composition-id="scene"] .scene-root .title',
    );
    expect(injectedStyles[0]?.textContent).toContain(
      '[data-composition-id="scene"] [data-hf-authored-id="scene-root"]',
    );
  });

  it("does not keep duplicate authored root ids when the same external composition mounts twice", async () => {
    const hostA = document.createElement("div");
    hostA.setAttribute("data-composition-src", "https://example.com/comp.html");
    hostA.setAttribute("data-composition-id", "scene");
    document.body.appendChild(hostA);

    const hostB = document.createElement("div");
    hostB.setAttribute("data-composition-src", "https://example.com/comp.html");
    hostB.setAttribute("data-composition-id", "scene");
    document.body.appendChild(hostB);

    const compositionHtml = `
      <html><body>
        <div id="scene-root" class="scene-root" data-composition-id="scene" data-width="1920" data-height="1080">
          <h1 class="title">Scene</h1>
        </div>
      </body></html>
    `;

    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response(compositionHtml, { status: 200 }),
    );

    await loadExternalCompositions({ ...defaultParams });

    const authoredRoots = document.querySelectorAll('[data-hf-authored-id="scene-root"]');
    expect(authoredRoots).toHaveLength(2);
    expect(document.querySelectorAll("#scene-root")).toHaveLength(0);
    expect(Array.from(authoredRoots).every((root) => !root.getAttribute("id"))).toBe(true);
  });

  it("isolates sibling instances of the same external sub-composition at runtime", async () => {
    const hostA = document.createElement("div");
    hostA.setAttribute("data-composition-src", "https://example.com/scene.html");
    hostA.setAttribute("data-composition-id", "scene");
    hostA.setAttribute("data-variable-values", '{"title":"Scene A"}');
    document.body.appendChild(hostA);

    const hostB = document.createElement("div");
    hostB.setAttribute("data-composition-src", "https://example.com/scene.html");
    hostB.setAttribute("data-composition-id", "scene");
    hostB.setAttribute("data-variable-values", '{"title":"Scene B"}');
    document.body.appendChild(hostB);

    const compositionHtml = `
      <html><body>
        <div id="scene-root" data-composition-id="scene" data-width="1920" data-height="1080">
          <style>[data-composition-id="scene"] .title { opacity: 0; }</style>
          <h1 class="title">Default</h1>
          <script>
            const titleEl = document.querySelector(".title");
            const runtimeId = titleEl?.closest("[data-composition-id]")?.getAttribute("data-composition-id") || "missing";
            if (titleEl) titleEl.textContent = runtimeId;
            window.__timelines = window.__timelines || {};
            window.__timelines["scene"] = { marker: runtimeId };
          </script>
        </div>
      </body></html>
    `;

    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response(compositionHtml, { status: 200 }),
    );

    const injectedScripts: HTMLScriptElement[] = [];
    await loadExternalCompositions({
      ...defaultParams,
      injectedScripts,
    });

    const runtimeIdA = hostA.getAttribute("data-composition-id") ?? "";
    const runtimeIdB = hostB.getAttribute("data-composition-id") ?? "";
    const variables =
      (window as Window & { __hfVariablesByComp?: Record<string, { title?: string }> })
        .__hfVariablesByComp ?? {};

    expect(runtimeIdA).not.toBe("scene");
    expect(runtimeIdB).not.toBe("scene");
    expect(runtimeIdA).not.toBe(runtimeIdB);
    expect(hostA.getAttribute("data-hf-original-composition-id")).toBe("scene");
    expect(hostB.getAttribute("data-hf-original-composition-id")).toBe("scene");
    expect(hostA.querySelector(".title")?.textContent).toBe(runtimeIdA);
    expect(hostB.querySelector(".title")?.textContent).toBe(runtimeIdB);
    expect(variables[runtimeIdA]?.title).toBe("Scene A");
    expect(variables[runtimeIdB]?.title).toBe("Scene B");
    expect(
      injectedScripts.some((script) =>
        script.textContent?.includes(`var __hfTimelineCompId = "${runtimeIdA}"`),
      ),
    ).toBe(true);
    expect(
      injectedScripts.some((script) =>
        script.textContent?.includes(`var __hfTimelineCompId = "${runtimeIdB}"`),
      ),
    ).toBe(true);
  });

  it("keeps the authored composition id stable across repeat loadExternalCompositions runs", async () => {
    const hostA = document.createElement("div");
    hostA.setAttribute("data-composition-src", "https://example.com/scene.html");
    hostA.setAttribute("data-composition-id", "scene");
    document.body.appendChild(hostA);

    const hostB = document.createElement("div");
    hostB.setAttribute("data-composition-src", "https://example.com/scene.html");
    hostB.setAttribute("data-composition-id", "scene");
    document.body.appendChild(hostB);

    const compositionHtml = `
      <html><body>
        <div id="scene-root" data-composition-id="scene" data-width="1920" data-height="1080">
          <h1 class="title">Scene</h1>
        </div>
      </body></html>
    `;

    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response(compositionHtml, { status: 200 }),
    );

    await loadExternalCompositions({ ...defaultParams });

    const runtimeIdA1 = hostA.getAttribute("data-composition-id");
    const runtimeIdB1 = hostB.getAttribute("data-composition-id");
    expect(hostA.getAttribute("data-hf-original-composition-id")).toBe("scene");
    expect(hostB.getAttribute("data-hf-original-composition-id")).toBe("scene");

    await loadExternalCompositions({ ...defaultParams });

    expect(hostA.getAttribute("data-hf-original-composition-id")).toBe("scene");
    expect(hostB.getAttribute("data-hf-original-composition-id")).toBe("scene");
    expect(hostA.getAttribute("data-composition-id")).toBe(runtimeIdA1);
    expect(hostB.getAttribute("data-composition-id")).toBe(runtimeIdB1);
    expect(hostA.querySelector('[data-hf-authored-id="scene-root"]')).toBeTruthy();
    expect(hostB.querySelector('[data-hf-authored-id="scene-root"]')).toBeTruthy();
  });

  it("normalizes a runtime composition id back to the authored id when only one host remains", async () => {
    const hostA = document.createElement("div");
    hostA.setAttribute("data-composition-src", "https://example.com/scene.html");
    hostA.setAttribute("data-composition-id", "scene");
    document.body.appendChild(hostA);

    const hostB = document.createElement("div");
    hostB.setAttribute("data-composition-src", "https://example.com/scene.html");
    hostB.setAttribute("data-composition-id", "scene");
    document.body.appendChild(hostB);

    const compositionHtml = `
      <html><body>
        <div id="scene-root" data-composition-id="scene" data-width="1920" data-height="1080">
          <h1 class="title">Scene</h1>
        </div>
      </body></html>
    `;

    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response(compositionHtml, { status: 200 }),
    );

    await loadExternalCompositions({ ...defaultParams });

    expect(hostB.getAttribute("data-composition-id")).toBe("scene__hf2");
    expect(hostB.getAttribute("data-hf-original-composition-id")).toBe("scene");

    hostA.remove();

    await loadExternalCompositions({ ...defaultParams });

    expect(hostB.getAttribute("data-composition-id")).toBe("scene");
    expect(hostB.hasAttribute("data-hf-original-composition-id")).toBe(false);
    expect(hostB.querySelector('[data-hf-authored-id="scene-root"]')).toBeTruthy();
  });

  it("clears stale variable entries when a host runtime composition id changes", async () => {
    const hostA = document.createElement("div");
    hostA.setAttribute("data-composition-src", "https://example.com/scene.html");
    hostA.setAttribute("data-composition-id", "scene");
    document.body.appendChild(hostA);

    const hostB = document.createElement("div");
    hostB.setAttribute("data-composition-src", "https://example.com/scene.html");
    hostB.setAttribute("data-composition-id", "scene");
    hostB.setAttribute("data-variable-values", '{"title":"Scene B"}');
    document.body.appendChild(hostB);

    const compositionHtml = `
      <html><body>
        <div id="scene-root" data-composition-id="scene" data-width="1920" data-height="1080">
          <h1 class="title">Scene</h1>
        </div>
      </body></html>
    `;

    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response(compositionHtml, { status: 200 }),
    );

    await loadExternalCompositions({ ...defaultParams });

    const byCompAfterFirstMount = (window as WindowWithScopedVars).__hfVariablesByComp ?? {};
    expect(byCompAfterFirstMount["scene__hf2"]).toEqual({ title: "Scene B" });

    hostA.remove();
    hostB.innerHTML = "";

    await loadExternalCompositions({ ...defaultParams });

    const byCompAfterSecondMount = (window as WindowWithScopedVars).__hfVariablesByComp ?? {};
    expect(byCompAfterSecondMount["scene"]).toEqual({ title: "Scene B" });
    expect(byCompAfterSecondMount["scene__hf2"]).toBeUndefined();
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

  describe("variable scoping (window.__hfVariablesByComp)", () => {
    type WindowWithScopedVars = Window & {
      __hfVariablesByComp?: Record<string, Record<string, unknown>>;
    };

    afterEach(() => {
      delete (window as WindowWithScopedVars).__hfVariablesByComp;
    });

    it("merges sub-comp declared defaults with host data-variable-values", async () => {
      const host = document.createElement("div");
      host.setAttribute("data-composition-src", "https://example.com/card.html");
      host.setAttribute("data-composition-id", "card-1");
      host.setAttribute("data-variable-values", '{"title":"Pro","price":"$29"}');
      document.body.appendChild(host);

      const compositionHtml = `
        <html data-composition-variables='[
          {"id":"title","type":"string","label":"Title","default":"Default"},
          {"id":"price","type":"string","label":"Price","default":"$0"},
          {"id":"theme","type":"string","label":"Theme","default":"light"}
        ]'>
          <body>
            <div data-composition-id="card-1"><p>card</p></div>
          </body>
        </html>
      `;
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(compositionHtml, { status: 200 }),
      );

      await loadExternalCompositions({ ...defaultParams });

      const byComp = (window as WindowWithScopedVars).__hfVariablesByComp ?? {};
      expect(byComp["card-1"]).toEqual({
        title: "Pro", // host wins over declared default
        price: "$29", // host wins
        theme: "light", // host omits → declared default falls through
      });
    });

    it("uses declared defaults when host has no data-variable-values", async () => {
      const host = document.createElement("div");
      host.setAttribute("data-composition-src", "https://example.com/card.html");
      host.setAttribute("data-composition-id", "card-2");
      document.body.appendChild(host);

      const compositionHtml = `
        <html data-composition-variables='[
          {"id":"title","type":"string","label":"Title","default":"Default Title"}
        ]'>
          <body><div data-composition-id="card-2"><p>x</p></div></body>
        </html>
      `;
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(compositionHtml, { status: 200 }),
      );

      await loadExternalCompositions({ ...defaultParams });

      const byComp = (window as WindowWithScopedVars).__hfVariablesByComp ?? {};
      expect(byComp["card-2"]).toEqual({ title: "Default Title" });
    });

    it("skips registration when neither declared defaults nor host overrides exist", async () => {
      const host = document.createElement("div");
      host.setAttribute("data-composition-src", "https://example.com/card.html");
      host.setAttribute("data-composition-id", "card-empty");
      document.body.appendChild(host);

      const compositionHtml = `
        <html><body><div data-composition-id="card-empty"><p>x</p></div></body></html>
      `;
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(compositionHtml, { status: 200 }),
      );

      await loadExternalCompositions({ ...defaultParams });

      const byComp = (window as WindowWithScopedVars).__hfVariablesByComp;
      expect(byComp?.["card-empty"]).toBeUndefined();
    });

    it("clears stale registered variables when a repeat mount has no values left", async () => {
      const host = document.createElement("div");
      host.setAttribute("data-composition-src", "https://example.com/card.html");
      host.setAttribute("data-composition-id", "card-clear");
      host.setAttribute("data-variable-values", '{"title":"Pro"}');
      document.body.appendChild(host);

      const firstCompositionHtml = `
        <html data-composition-variables='[
          {"id":"title","type":"string","label":"Title","default":"Default Title"}
        ]'>
          <body><div data-composition-id="card-clear"><p>x</p></div></body>
        </html>
      `;
      const secondCompositionHtml = `
        <html><body><div data-composition-id="card-clear"><p>y</p></div></body></html>
      `;

      vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(new Response(firstCompositionHtml, { status: 200 }))
        .mockResolvedValueOnce(new Response(secondCompositionHtml, { status: 200 }));

      await loadExternalCompositions({ ...defaultParams });

      const byCompAfterFirstMount = (window as WindowWithScopedVars).__hfVariablesByComp ?? {};
      expect(byCompAfterFirstMount["card-clear"]).toEqual({ title: "Pro" });

      host.removeAttribute("data-variable-values");
      host.innerHTML = "";

      await loadExternalCompositions({ ...defaultParams });

      const byCompAfterSecondMount = (window as WindowWithScopedVars).__hfVariablesByComp;
      expect(byCompAfterSecondMount?.["card-clear"]).toBeUndefined();
    });

    it("ignores invalid JSON in host data-variable-values", async () => {
      const host = document.createElement("div");
      host.setAttribute("data-composition-src", "https://example.com/card.html");
      host.setAttribute("data-composition-id", "card-bad");
      host.setAttribute("data-variable-values", "{not json");
      document.body.appendChild(host);

      const compositionHtml = `
        <html data-composition-variables='[{"id":"title","type":"string","label":"Title","default":"OK"}]'>
          <body><div data-composition-id="card-bad"><p>x</p></div></body>
        </html>
      `;
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(compositionHtml, { status: 200 }),
      );

      await loadExternalCompositions({ ...defaultParams });

      const byComp = (window as WindowWithScopedVars).__hfVariablesByComp ?? {};
      expect(byComp["card-bad"]).toEqual({ title: "OK" });
    });

    it("registers per-instance entries for multiple sub-comps with the same source", async () => {
      const host1 = document.createElement("div");
      host1.setAttribute("data-composition-src", "https://example.com/card.html");
      host1.setAttribute("data-composition-id", "card-A");
      host1.setAttribute("data-variable-values", '{"title":"Pro","price":"$29"}');
      document.body.appendChild(host1);

      const host2 = document.createElement("div");
      host2.setAttribute("data-composition-src", "https://example.com/card.html");
      host2.setAttribute("data-composition-id", "card-B");
      host2.setAttribute("data-variable-values", '{"title":"Enterprise","price":"Custom"}');
      document.body.appendChild(host2);

      const compositionHtml = `
        <html data-composition-variables='[
          {"id":"title","type":"string","label":"Title","default":"Default"},
          {"id":"price","type":"string","label":"Price","default":"$0"}
        ]'>
          <body><div data-composition-id="card-A"><p>x</p></div></body>
        </html>
      `;
      vi.spyOn(globalThis, "fetch").mockImplementation(
        async () => new Response(compositionHtml, { status: 200 }),
      );

      await loadExternalCompositions({ ...defaultParams });

      const byComp = (window as WindowWithScopedVars).__hfVariablesByComp ?? {};
      expect(byComp["card-A"]).toEqual({ title: "Pro", price: "$29" });
      expect(byComp["card-B"]).toEqual({ title: "Enterprise", price: "Custom" });
    });

    it("clears stale variable entries when a previous host was removed from the DOM", async () => {
      const hostA = document.createElement("div");
      hostA.setAttribute("data-composition-src", "https://example.com/card-a.html");
      hostA.setAttribute("data-composition-id", "card-a");
      hostA.setAttribute("data-variable-values", '{"title":"A"}');
      document.body.appendChild(hostA);

      const hostB = document.createElement("div");
      hostB.setAttribute("data-composition-src", "https://example.com/card-b.html");
      hostB.setAttribute("data-composition-id", "card-b");
      hostB.setAttribute("data-variable-values", '{"title":"B"}');
      document.body.appendChild(hostB);

      vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes("card-a.html")) {
          return new Response(
            `<html><body><div data-composition-id="card-a"><p>A</p></div></body></html>`,
            { status: 200 },
          );
        }
        return new Response(
          `<html><body><div data-composition-id="card-b"><p>B</p></div></body></html>`,
          { status: 200 },
        );
      });

      await loadExternalCompositions({ ...defaultParams });

      const byCompAfterFirstMount = (window as WindowWithScopedVars).__hfVariablesByComp ?? {};
      expect(byCompAfterFirstMount["card-a"]).toEqual({ title: "A" });
      expect(byCompAfterFirstMount["card-b"]).toEqual({ title: "B" });

      hostB.remove();
      hostA.innerHTML = "";

      await loadExternalCompositions({ ...defaultParams });

      const byCompAfterSecondMount = (window as WindowWithScopedVars).__hfVariablesByComp ?? {};
      expect(byCompAfterSecondMount["card-a"]).toEqual({ title: "A" });
      expect(byCompAfterSecondMount["card-b"]).toBeUndefined();
    });

    it("clears stale variable entries when the last host was removed from the DOM", async () => {
      const host = document.createElement("div");
      host.setAttribute("data-composition-src", "https://example.com/card-last.html");
      host.setAttribute("data-composition-id", "card-last");
      host.setAttribute("data-variable-values", '{"title":"Last"}');
      document.body.appendChild(host);

      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          `<html><body><div data-composition-id="card-last"><p>Last</p></div></body></html>`,
          { status: 200 },
        ),
      );

      await loadExternalCompositions({ ...defaultParams });

      const byCompAfterFirstMount = (window as WindowWithScopedVars).__hfVariablesByComp ?? {};
      expect(byCompAfterFirstMount["card-last"]).toEqual({ title: "Last" });

      host.remove();

      await loadExternalCompositions({ ...defaultParams });

      const byCompAfterSecondMount = (window as WindowWithScopedVars).__hfVariablesByComp;
      expect(byCompAfterSecondMount?.["card-last"]).toBeUndefined();
    });
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

  it("keeps authored template lookup stable across repeat inline loads for duplicate hosts", async () => {
    const template = document.createElement("template");
    template.id = "scene-template";
    template.innerHTML = `
      <div id="scene-root" data-composition-id="scene" data-width="1920" data-height="1080">
        <p>Inline scene</p>
      </div>
    `;
    document.body.appendChild(template);

    const hostA = document.createElement("div");
    hostA.setAttribute("data-composition-id", "scene");
    document.body.appendChild(hostA);

    const hostB = document.createElement("div");
    hostB.setAttribute("data-composition-id", "scene");
    document.body.appendChild(hostB);

    await loadInlineTemplateCompositions({ ...defaultParams });

    const runtimeIdA = hostA.getAttribute("data-composition-id");
    const runtimeIdB = hostB.getAttribute("data-composition-id");
    expect(runtimeIdA).not.toBe("scene");
    expect(runtimeIdB).not.toBe("scene");
    expect(runtimeIdA).not.toBe(runtimeIdB);
    expect(hostA.getAttribute("data-hf-original-composition-id")).toBe("scene");
    expect(hostB.getAttribute("data-hf-original-composition-id")).toBe("scene");

    hostA.innerHTML = "";
    hostB.innerHTML = "";

    await loadInlineTemplateCompositions({ ...defaultParams });

    expect(hostA.getAttribute("data-hf-original-composition-id")).toBe("scene");
    expect(hostB.getAttribute("data-hf-original-composition-id")).toBe("scene");
    expect(hostA.getAttribute("data-composition-id")).toBe(runtimeIdA);
    expect(hostB.getAttribute("data-composition-id")).toBe(runtimeIdB);
    expect(hostA.querySelector('[data-hf-authored-id="scene-root"]')).toBeTruthy();
    expect(hostB.querySelector('[data-hf-authored-id="scene-root"]')).toBeTruthy();
  });

  it("does not rewrite ids for duplicate inline hosts that are skipped", async () => {
    const filledTemplate = document.createElement("template");
    filledTemplate.id = "filled-scene-template";
    filledTemplate.innerHTML = `
      <div data-composition-id="filled-scene" data-width="1920" data-height="1080">
        <p>Filled scene</p>
      </div>
    `;
    document.body.appendChild(filledTemplate);

    const filledHostA = document.createElement("div");
    filledHostA.setAttribute("data-composition-id", "filled-scene");
    filledHostA.innerHTML = "<span>Existing A</span>";
    document.body.appendChild(filledHostA);

    const filledHostB = document.createElement("div");
    filledHostB.setAttribute("data-composition-id", "filled-scene");
    filledHostB.innerHTML = "<span>Existing B</span>";
    document.body.appendChild(filledHostB);

    const orphanHostA = document.createElement("div");
    orphanHostA.setAttribute("data-composition-id", "orphan-scene");
    document.body.appendChild(orphanHostA);

    const orphanHostB = document.createElement("div");
    orphanHostB.setAttribute("data-composition-id", "orphan-scene");
    document.body.appendChild(orphanHostB);

    await loadInlineTemplateCompositions({ ...defaultParams });

    expect(filledHostA.getAttribute("data-composition-id")).toBe("filled-scene");
    expect(filledHostB.getAttribute("data-composition-id")).toBe("filled-scene");
    expect(filledHostA.hasAttribute("data-hf-original-composition-id")).toBe(false);
    expect(filledHostB.hasAttribute("data-hf-original-composition-id")).toBe(false);
    expect(orphanHostA.getAttribute("data-composition-id")).toBe("orphan-scene");
    expect(orphanHostB.getAttribute("data-composition-id")).toBe("orphan-scene");
    expect(orphanHostA.hasAttribute("data-hf-original-composition-id")).toBe(false);
    expect(orphanHostB.hasAttribute("data-hf-original-composition-id")).toBe(false);
  });

  it("uniquifies a mounted inline host when a skipped sibling already uses the authored id", async () => {
    const template = document.createElement("template");
    template.id = "scene-template";
    template.innerHTML = `
      <div id="scene-root" data-composition-id="scene" data-width="1920" data-height="1080">
        <p>Inline scene</p>
      </div>
    `;
    document.body.appendChild(template);

    const skippedHost = document.createElement("div");
    skippedHost.setAttribute("data-composition-id", "scene");
    skippedHost.innerHTML = "<span>Existing scene</span>";
    document.body.appendChild(skippedHost);

    const mountedHost = document.createElement("div");
    mountedHost.setAttribute("data-composition-id", "scene");
    document.body.appendChild(mountedHost);

    await loadInlineTemplateCompositions({ ...defaultParams });

    expect(skippedHost.getAttribute("data-composition-id")).toBe("scene");
    expect(skippedHost.hasAttribute("data-hf-original-composition-id")).toBe(false);
    expect(mountedHost.getAttribute("data-composition-id")).not.toBe("scene");
    expect(mountedHost.getAttribute("data-hf-original-composition-id")).toBe("scene");
    expect(mountedHost.querySelector('[data-hf-authored-id="scene-root"]')).toBeTruthy();
  });

  it("re-numbers duplicate inline runtime ids when the mount set grows", async () => {
    const template = document.createElement("template");
    template.id = "scene-template";
    template.innerHTML = `
      <div id="scene-root" data-composition-id="scene" data-width="1920" data-height="1080">
        <p>Inline scene</p>
      </div>
    `;
    document.body.appendChild(template);

    const hostA = document.createElement("div");
    hostA.setAttribute("data-composition-id", "scene");
    hostA.innerHTML = "<span>Existing A</span>";
    document.body.appendChild(hostA);

    const hostB = document.createElement("div");
    hostB.setAttribute("data-composition-id", "scene");
    document.body.appendChild(hostB);

    await loadInlineTemplateCompositions({ ...defaultParams });

    expect(hostA.getAttribute("data-composition-id")).toBe("scene");
    expect(hostB.getAttribute("data-composition-id")).toBe("scene__hf1");

    hostA.innerHTML = "";
    hostB.innerHTML = "";

    await loadInlineTemplateCompositions({ ...defaultParams });

    expect(hostA.getAttribute("data-composition-id")).toBe("scene__hf1");
    expect(hostB.getAttribute("data-composition-id")).toBe("scene__hf2");
    expect(hostA.getAttribute("data-hf-original-composition-id")).toBe("scene");
    expect(hostB.getAttribute("data-hf-original-composition-id")).toBe("scene");
  });

  it("uniquifies duplicate sub-compositions across inline-template and external hosts", async () => {
    const template = document.createElement("template");
    template.id = "scene-template";
    template.innerHTML = `
      <div id="scene-root" data-composition-id="scene" data-width="1920" data-height="1080">
        <p>Inline scene</p>
      </div>
    `;
    document.body.appendChild(template);

    const inlineHost = document.createElement("div");
    inlineHost.setAttribute("data-composition-id", "scene");
    document.body.appendChild(inlineHost);

    const externalHost = document.createElement("div");
    externalHost.setAttribute("data-composition-id", "scene");
    externalHost.setAttribute("data-composition-src", "https://example.com/scene.html");
    document.body.appendChild(externalHost);

    const compositionHtml = `
      <html><body>
        <div data-composition-id="scene" data-width="1920" data-height="1080">
          <p>External scene</p>
        </div>
      </body></html>
    `;
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(compositionHtml, { status: 200 }));

    await loadExternalCompositions({ ...defaultParams });
    await loadInlineTemplateCompositions({ ...defaultParams });

    expect(inlineHost.getAttribute("data-composition-id")).toBe("scene__hf1");
    expect(externalHost.getAttribute("data-composition-id")).toBe("scene__hf2");
    expect(inlineHost.getAttribute("data-hf-original-composition-id")).toBe("scene");
    expect(externalHost.getAttribute("data-hf-original-composition-id")).toBe("scene");
    expect(inlineHost.querySelector("p")?.textContent).toBe("Inline scene");
    expect(externalHost.querySelector("p")?.textContent).toBeTruthy();
  });
});
