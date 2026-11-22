import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The player's own runtime, standing in for core's 750 KB build. Its "</script>" must not end the inlined script.
const RUNTIME = 'window.__hyperframes = { built: "</script>" };';
vi.mock("@hyperframes/core/runtime-script", () => ({ getHyperframeRuntimeScript: () => RUNTIME }));

type Player = HTMLElement & { iframeElement: HTMLIFrameElement };

const page = (head = "", body = "<script>window.composition = 1;</script>") =>
  `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
const sameSite = () => `${location.origin}/films/one/index.html?take=2`;

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
    fetchMock = vi.fn(async () => new Response(page()));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it("shows a composition from its own site with the runtime inlined, resolving paths at its URL", async () => {
    const el = player({ "sandbox-origin": "", src: sameSite() });
    const doc = await srcdocOf(el);

    expect(fetchMock).toHaveBeenCalledWith(sameSite(), { credentials: "same-origin" });
    expect(doc).not.toContain("cdn.jsdelivr.net");
    expect(doc).toContain('built: "<\\/script>"');
    // Base first, then the runtime, both ahead of the composition's own script.
    expect(doc.indexOf(`<base href="${sameSite()}">`)).toBeGreaterThan(-1);
    expect(doc.indexOf("<base")).toBeLessThan(doc.indexOf("__hyperframes"));
    expect(doc.indexOf("__hyperframes")).toBeLessThan(doc.indexOf("window.composition"));
  });

  it("loads a composition that brings its own runtime by src, under its own headers", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(page('<script src="/vendor/hyperframe.runtime.iife.js"></script>')),
    );
    const el = player({ "sandbox-origin": "", src: sameSite() });

    await vi.waitFor(() => expect(el.iframeElement.src).toBe(sameSite()));
    expect(el.iframeElement.hasAttribute("srcdoc")).toBe(false);
  });

  it("loads a preview that links the runtime by its marker, as Studio's does, by src", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        page('<script data-hyperframes-preview-runtime="1" src="/api/runtime.js"></script>'),
      ),
    );
    const el = player({ "sandbox-origin": "", src: sameSite() });

    await vi.waitFor(() => expect(el.iframeElement.src).toBe(sameSite()));
    expect(el.iframeElement.hasAttribute("srcdoc")).toBe(false);
  });

  it("still adds the runtime when a page only compares or names it", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        page(
          "<!-- needs hyperframe.runtime.iife.js --><script>if (window.__hyperframes === undefined) {}</script>",
        ),
      ),
    );
    expect(await srcdocOf(player({ "sandbox-origin": "", src: sameSite() }))).toContain("built:");
  });

  it("resolves paths at the URL a redirect landed on", async () => {
    const landed = `${location.origin}/films/one/`;
    const response = new Response(page());
    Object.defineProperty(response, "url", { value: landed });
    fetchMock.mockResolvedValueOnce(response);
    const doc = await srcdocOf(
      player({ "sandbox-origin": "", src: `${location.origin}/films/one` }),
    );

    expect(doc).toContain(`<base href="${landed}">`);
  });

  it("resolves the composition's own relative base against its URL, ahead of it", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(page('<base target="_blank"><base href="assets/">')),
    );
    const doc = await srcdocOf(player({ "sandbox-origin": "", src: sameSite() }));

    const ours = doc.indexOf(`<base href="${location.origin}/films/one/assets/">`);
    expect(ours).toBeGreaterThan(-1);
    expect(ours).toBeLessThan(doc.indexOf('<base target="_blank">'));
  });

  it("puts the runtime in the real head, not one named in a comment", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("<!-- <head> --><html><head></head><body></body></html>"),
    );
    const doc = await srcdocOf(player({ "sandbox-origin": "", src: sameSite() }));

    expect(doc.indexOf("built:")).toBeGreaterThan(doc.indexOf("<html><head>"));
  });

  it("reads the page in the charset its response names", async () => {
    const encode = (text: string) => [...new TextEncoder().encode(text)];
    const [before, after] = page("", "<p>caf\u00e9</p>").split("\u00e9");
    const bytes = new Uint8Array([...encode(before!), 0xe9, ...encode(after!)]);
    fetchMock.mockResolvedValueOnce(
      new Response(bytes, { headers: { "content-type": "text/html; charset=windows-1252" } }),
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
    fetchMock.mockResolvedValueOnce(new Response("", { status: 404 }));
    const el = player({ "sandbox-origin": "", src: sameSite() });

    await vi.waitFor(() => expect(el.iframeElement.src).toBe(sameSite()));
    expect(el.iframeElement.hasAttribute("srcdoc")).toBe(false);
  });

  it("shows nothing from a fetch that answers after the player moved to another composition", async () => {
    let answer: (response: Response) => void = () => {};
    fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => (answer = resolve)));
    const el = player({ "sandbox-origin": "", src: sameSite() });
    el.setAttribute("src", "https://films.example/two.html");
    answer(new Response(page()));
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

  it("leaves an unsealed player's src load as it was", () => {
    const el = player({ src: sameSite() });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(el.iframeElement.src).toBe(sameSite());
  });
});
