import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadLimitMs, timelineNotFound } from "./composition-probe.js";

const LIMIT = loadLimitMs();

// The player's own runtime, standing in for core's 750 KB build. Its "</script>" must not end the inlined script.
const RUNTIME = 'window.__hyperframes = { built: "</script>" };';
vi.mock("@hyperframes/core/runtime-script", () => ({ getHyperframeRuntimeScript: () => RUNTIME }));

type Player = HTMLElement & { iframeElement: HTMLIFrameElement };

const page = (head = "", body = "<script>window.composition = 1;</script>") =>
  `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
const sameSite = () => `${location.origin}/films/one/index.html?take=2`;

/** A response from the player's own site, as fetch gives it: every header readable. */
function siteResponse(body?: BodyInit | null, init?: ResponseInit, type: ResponseType = "basic") {
  const response = new Response(body, init);
  Object.defineProperty(response, "type", { value: type });
  return response;
}

function player(attributes: Record<string, string>): Player {
  const el = document.createElement("hyperframes-player") as Player;
  for (const [name, value] of Object.entries(attributes)) el.setAttribute(name, value);
  document.body.appendChild(el);
  return el;
}

const srcdocOf = async (el: Player) => {
  await vi.waitFor(() => expect(el.iframeElement.getAttribute("srcdoc")).toBeTruthy());
  return el.iframeElement.getAttribute("srcdoc")!;
};

describe("a sealed player brings its own runtime", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    await import("./hyperframes-player.js");
    fetchMock = vi.fn(async () => siteResponse(page()));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it("shows a composition from its own site with the runtime inlined, resolving paths at its URL", async () => {
    const el = player({ "sandbox-origin": "", src: sameSite() });
    const doc = await srcdocOf(el);

    expect(fetchMock).toHaveBeenCalledWith(sameSite(), {
      mode: "no-cors",
      credentials: "same-origin",
    });
    expect(doc).not.toContain("cdn.jsdelivr.net");
    expect(doc).toContain('built: "<\\/script>"');
    // Base first, then the runtime, both ahead of the composition's own script.
    expect(doc.indexOf(`<base href="${sameSite()}">`)).toBeGreaterThan(-1);
    expect(doc.indexOf("<base")).toBeLessThan(doc.indexOf("__hyperframes"));
    expect(doc.indexOf("__hyperframes")).toBeLessThan(doc.indexOf("window.composition"));
  });

  it("loads a composition that brings its own runtime by src, under its own headers", async () => {
    fetchMock.mockResolvedValueOnce(
      siteResponse(page('<script src="/vendor/hyperframe.runtime.iife.js"></script>')),
    );
    const el = player({ "sandbox-origin": "", src: sameSite() });

    await vi.waitFor(() => expect(el.iframeElement.src).toBe(sameSite()));
    expect(el.iframeElement.hasAttribute("srcdoc")).toBe(false);
  });

  it("loads a preview that links the runtime by its marker, as Studio's does, by src", async () => {
    fetchMock.mockResolvedValueOnce(
      siteResponse(
        page('<script data-hyperframes-preview-runtime="1" src="/api/runtime.js"></script>'),
      ),
    );
    const el = player({ "sandbox-origin": "", src: sameSite() });

    await vi.waitFor(() => expect(el.iframeElement.src).toBe(sameSite()));
    expect(el.iframeElement.hasAttribute("srcdoc")).toBe(false);
  });

  it("still adds the runtime when a script only mentions Studio's marker", async () => {
    for (const head of [
      '<script data-note="data-hyperframes-preview-runtime"></script>',
      '<script>var tag = "<script data-hyperframes-preview-runtime src=x>";</script>',
      '<script>var end = "</scripted"; var tag = "<script data-hyperframes-preview-runtime src=x>";</script>',
      '<SCRIPT>var end = "</SCRIPTS"; var tag = "<script data-hyperframes-preview-runtime>";</SCRIPT>',
    ]) {
      fetchMock.mockResolvedValueOnce(siteResponse(page(head)));
      expect(await srcdocOf(player({ "sandbox-origin": "", src: sameSite() }))).toContain("built:");
      document.body.replaceChildren();
    }
  });

  it("still adds the runtime when a page only compares or names it", async () => {
    fetchMock.mockResolvedValueOnce(
      siteResponse(
        page(
          "<!-- needs hyperframe.runtime.iife.js --><script>if (window.__hyperframes === undefined) {}</script>",
        ),
      ),
    );
    expect(await srcdocOf(player({ "sandbox-origin": "", src: sameSite() }))).toContain("built:");
  });

  it("resolves paths at the URL a redirect landed on", async () => {
    const landed = `${location.origin}/films/one/`;
    const response = siteResponse(page());
    Object.defineProperty(response, "url", { value: landed });
    fetchMock.mockResolvedValueOnce(response);
    const doc = await srcdocOf(
      player({ "sandbox-origin": "", src: `${location.origin}/films/one` }),
    );

    expect(doc).toContain(`<base href="${landed}">`);
  });

  it("resolves the composition's own relative base against its URL, ahead of it", async () => {
    fetchMock.mockResolvedValueOnce(
      siteResponse(page('<base target="_blank"><base href="assets/">')),
    );
    const doc = await srcdocOf(player({ "sandbox-origin": "", src: sameSite() }));

    const ours = doc.indexOf(`<base href="${location.origin}/films/one/assets/">`);
    expect(ours).toBeGreaterThan(-1);
    expect(ours).toBeLessThan(doc.indexOf('<base target="_blank">'));
  });

  it("puts the runtime in the real head, not one named in a comment", async () => {
    fetchMock.mockResolvedValueOnce(
      siteResponse("<!-- <head> --><html><head></head><body></body></html>"),
    );
    const doc = await srcdocOf(player({ "sandbox-origin": "", src: sameSite() }));

    expect(doc.indexOf("built:")).toBeGreaterThan(doc.indexOf("<html><head>"));
  });

  it("reads the page in the charset its response names", async () => {
    const encode = (text: string) => [...new TextEncoder().encode(text)];
    const [before, after] = page("", "<p>caf\u00e9</p>").split("\u00e9");
    const bytes = new Uint8Array([...encode(before!), 0xe9, ...encode(after!)]);
    fetchMock.mockResolvedValueOnce(
      siteResponse(bytes, { headers: { "content-type": "text/html; charset=windows-1252" } }),
    );
    expect(await srcdocOf(player({ "sandbox-origin": "", src: sameSite() }))).toContain("café");
  });

  it("carries the shader options a src would have carried in its query", async () => {
    const doc = await srcdocOf(
      player({ "sandbox-origin": "", "shader-capture-scale": "0.5", src: sameSite() }),
    );

    expect(doc).toContain('window.__HF_SHADER_CAPTURE_SCALE="0.5";');
  });

  it("inlines the runtime in a sealed srcdoc instead of linking the CDN", async () => {
    const doc = await srcdocOf(player({ "sandbox-origin": "", srcdoc: page() }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(doc).not.toContain("cdn.jsdelivr.net");
    expect(doc).toContain("built:");
  });

  it("loads a composition from another site as before", () => {
    const el = player({ "sandbox-origin": "", src: "https://films.example/one.html" });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(el.iframeElement.src).toBe("https://films.example/one.html");
    expect(el.iframeElement.hasAttribute("srcdoc")).toBe(false);
  });

  it("loads src as before when its own site refuses the fetch", async () => {
    fetchMock.mockResolvedValueOnce(siteResponse("", { status: 404 }));
    const el = player({ "sandbox-origin": "", src: sameSite() });

    await vi.waitFor(() => expect(el.iframeElement.src).toBe(sameSite()));
    expect(el.iframeElement.hasAttribute("srcdoc")).toBe(false);
  });

  // fails without the fix: the page was shown as srcdoc, under the embedding page's policy instead of its own.
  it("loads a page whose response sets its own security policy by src, under that policy", async () => {
    for (const header of [
      ["content-security-policy", "script-src 'self'"],
      ["x-frame-options", "SAMEORIGIN"],
    ] satisfies [string, string][]) {
      fetchMock.mockResolvedValueOnce(siteResponse(page(), { headers: [header] }));
      const el = player({ "sandbox-origin": "", src: sameSite() });

      await vi.waitFor(() => expect(el.iframeElement.src).toBe(sameSite()));
      expect(el.iframeElement.hasAttribute("srcdoc")).toBe(false);
      document.body.replaceChildren();
    }
  });

  // fails without the fix: a redirect to another site that allows CORS hides that page's policy headers from
  // the fetch, so the page was shown as srcdoc although its own policy could not be read.
  it("loads by src when the page's headers can't all be read, as after a redirect to another site", async () => {
    for (const type of ["cors", "opaque"] satisfies ResponseType[]) {
      fetchMock.mockResolvedValueOnce(siteResponse(page(), {}, type));
      const el = player({ "sandbox-origin": "", src: sameSite() });

      await vi.waitFor(() => expect(el.iframeElement.src).toBe(sameSite()));
      expect(el.iframeElement.hasAttribute("srcdoc")).toBe(false);
      el.remove();
    }
  });

  // fails without the fix: the load clock started only once the frame was written, so a fetch that never answered
  // left a blank player with no error at all.
  it("reports the load limit once while its own site's fetch is still pending", async () => {
    vi.useFakeTimers();
    try {
      let answer: (response: Response) => void = () => {};
      fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => (answer = resolve)));
      const el = player({ "sandbox-origin": "", src: sameSite() });
      const errors: string[] = [];
      el.addEventListener("error", (event: Event) =>
        errors.push((event as CustomEvent<{ message: string }>).detail.message),
      );

      await vi.advanceTimersByTimeAsync(LIMIT - 1);
      expect(errors).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      expect(errors).toEqual([timelineNotFound(LIMIT)]);

      answer(siteResponse(page()));
      await vi.advanceTimersByTimeAsync(0);
      expect(el.iframeElement.getAttribute("srcdoc")).toContain("built:");
      await vi.advanceTimersByTimeAsync(LIMIT);
      expect(errors).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  // fails without the fix: the load limit told a sealed player's host to add a runtime the page it read brought.
  it.each([
    [
      "brings its own runtime",
      () =>
        siteResponse(
          page('<script data-hyperframes-preview-runtime="1" src="/api/runtime.js"></script>'),
        ),
      false,
    ],
    ["can't be read", () => siteResponse(page(), {}, "cors"), true],
  ])(
    "names the runtime in the load limit only when the page loaded by src %s",
    async (_name, answer, hint) => {
      vi.useFakeTimers();
      try {
        fetchMock.mockResolvedValueOnce(answer());
        const el = player({ "sandbox-origin": "", src: sameSite() });
        const errors: string[] = [];
        el.addEventListener("error", (event: Event) =>
          errors.push((event as CustomEvent<{ message: string }>).detail.message),
        );
        await vi.advanceTimersByTimeAsync(0);
        expect(el.iframeElement.src).toBe(sameSite());
        Object.defineProperty(el.iframeElement, "contentDocument", {
          value: null,
          configurable: true,
        });
        (el as unknown as { _onIframeLoad(): void })._onIframeLoad();
        await vi.advanceTimersByTimeAsync(LIMIT);
        expect(errors).toEqual([timelineNotFound(LIMIT, hint)]);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it("shows nothing from a fetch that answers after the player moved to another composition", async () => {
    let answer: (response: Response) => void = () => {};
    fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => (answer = resolve)));
    const el = player({ "sandbox-origin": "", src: sameSite() });
    el.setAttribute("src", "https://films.example/two.html");
    answer(siteResponse(page()));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(el.iframeElement.src).toBe("https://films.example/two.html");
    expect(el.iframeElement.hasAttribute("srcdoc")).toBe(false);
  });

  it("hands a src that is not a URL to the frame as before, without throwing", () => {
    const el = player({ "sandbox-origin": "", src: "http://[not a host" });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(el.iframeElement.getAttribute("src")).toContain("[not a host");
  });

  it("unloads a sealed composition when the player switches to a video", async () => {
    const el = player({ "sandbox-origin": "", src: sameSite() });
    await srcdocOf(el);
    el.setAttribute("type", "video/mp4");
    el.setAttribute("src", `${location.origin}/clip.mp4`);

    expect(el.iframeElement.hasAttribute("srcdoc")).toBe(false);
  });

  // fails without the fix: the pending fetch's load limit still fired, over the playing video.
  it("reports no load limit after a player waiting on its own site's fetch switches to a video", async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockReturnValueOnce(new Promise<Response>(() => {}));
      const el = player({ "sandbox-origin": "", src: sameSite() });
      const errors: string[] = [];
      el.addEventListener("error", (event: Event) =>
        errors.push((event as CustomEvent<{ message: string }>).detail.message),
      );
      el.setAttribute("type", "video/mp4");
      el.setAttribute("src", `${location.origin}/clip.mp4`);

      await vi.advanceTimersByTimeAsync(LIMIT);
      expect(errors).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves an unsealed player's src load as it was", () => {
    const el = player({ src: sameSite() });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(el.iframeElement.src).toBe(sameSite());
  });
});
