// @vitest-environment happy-dom
//
// Contract between the SSR serializer (ssr.ts) and the client adopter
// (setupPlayerShadowDom): what the server emits must be exactly what the
// upgrading element recognizes and reuses. If either side drifts, adoption
// silently degrades into rebuild-and-reload — these tests make that loud.
import { describe, expect, it } from "vitest";
import { setupPlayerShadowDom } from "./iframe-dom.js";
import { renderPlayerShadowDomHtml, renderPlayerTagHtml } from "./ssr.js";

/** Simulate the browser's declarative shadow DOM parse: attach a shadow root
 *  pre-upgrade and fill it with the serializer's template content. */
function hostWithDeclarativeShadow(html: string): HTMLElement {
  const host = document.createElement("div");
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = html;
  return host;
}

describe("setupPlayerShadowDom", () => {
  it("adopts the serializer's shadow DOM without rebuilding", () => {
    const host = hostWithDeclarativeShadow(
      renderPlayerShadowDomHtml({ src: "./comp/index.html", poster: "./poster.jpg" }),
    );
    const declarativeIframe = host.shadowRoot?.querySelector("iframe");
    const dom = setupPlayerShadowDom(host, ":host { display: block; }");
    expect(dom.adopted).toBe(true);
    expect(dom.iframe).toBe(declarativeIframe);
    expect(dom.iframe.getAttribute("src")).toBe("./comp/index.html");
    expect(dom.poster?.getAttribute("src")).toBe("./poster.jpg");
    expect(dom.container.contains(dom.iframe)).toBe(true);
    // The serialized <style data-hfp-ssr> stands in for adoptedStyleSheets.
    expect(dom.shadow.querySelector("style[data-hfp-ssr]")).not.toBeNull();
  });

  it("rebuilds when the declarative root is foreign or malformed", () => {
    const host = hostWithDeclarativeShadow("<p>not a player</p>");
    const dom = setupPlayerShadowDom(host, ":host { display: block; }");
    expect(dom.adopted).toBe(false);
    expect(dom.shadow.querySelector("p")).toBeNull();
    expect(dom.container.className).toBe("hfp-container");
    expect(dom.iframe.className).toBe("hfp-iframe");
  });

  it("builds imperatively when no shadow root exists", () => {
    const host = document.createElement("div");
    const dom = setupPlayerShadowDom(host, ":host { display: block; }");
    expect(dom.adopted).toBe(false);
    expect(dom.poster).toBeNull();
    expect(host.shadowRoot).toBe(dom.shadow);
    expect(dom.shadow.querySelector("iframe.hfp-iframe")).toBe(dom.iframe);
  });
});

describe("renderPlayerShadowDomHtml", () => {
  it("emits the iframe with sandbox and prepared src", () => {
    const html = renderPlayerShadowDomHtml({ src: "./comp/index.html" });
    expect(html).toContain('sandbox="allow-scripts allow-same-origin"');
    expect(html).toContain('allow="autoplay; fullscreen"');
    expect(html).toContain('src="./comp/index.html"');
  });

  it("carries shader options in the src exactly as the element would prepare them", () => {
    const html = renderPlayerShadowDomHtml({
      src: "./comp/index.html",
      shaderCaptureScale: 0.5,
      shaderLoading: "player",
    });
    // Must match prepareSrcForElement output so the upgrade replay skips the
    // reload; the guard test below closes the loop on the element side.
    expect(html).toMatch(/src=".\/comp\/index\.html\?[^"]*__hf_shader_capture_scale=0\.5/);
    expect(html).toMatch(/__hf_shader_loading=player/);
  });

  it("escapes attribute values", () => {
    const html = renderPlayerShadowDomHtml({ poster: `x" onerror="alert(1)` });
    expect(html).not.toContain('" onerror=');
    expect(html).toContain("&quot;");
  });

  it("coerces non-numeric dimensions instead of interpolating them into CSS", () => {
    const html = renderPlayerShadowDomHtml({
      width: "</style><script>" as unknown as number,
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("width: 1920px");
  });
});

describe("renderPlayerTagHtml", () => {
  it("wraps the shadow DOM in a declarative template", () => {
    const html = renderPlayerTagHtml({ src: "./comp/index.html", className: "hero", width: 1280 });
    expect(html).toMatch(
      /^<hyperframes-player class="hero" src=".\/comp\/index\.html" width="1280">/,
    );
    expect(html).toContain('<template shadowrootmode="open">');
    expect(html).toMatch(/<\/template><\/hyperframes-player>$/);
  });
});
