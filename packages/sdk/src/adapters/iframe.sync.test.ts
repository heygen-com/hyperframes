// @vitest-environment happy-dom
/**
 * attachSync mirrors every SDK edit (including undo/redo) onto a real live
 * document — this file needs happy-dom (the package's default vitest
 * environment is "node") because it exercises iframe.contentDocument.
 */
import { describe, it, expect } from "vitest";
import { createIframePreviewAdapter } from "./iframe.js";
import { openComposition } from "../session.js";

const BASE_HTML = `
<div data-hf-id="hf-stage" data-hf-root style="width: 1280px; height: 720px" data-duration="5">
  <h1 data-hf-id="hf-title" style="color: #fff; font-size: 64px">Hello World</h1>
</div>
`.trim();

/** A same-origin iframe seeded with the given HTML, ready for contentDocument access. */
function mountIframe(html: string): HTMLIFrameElement {
  const iframe = document.createElement("iframe");
  document.body.appendChild(iframe);
  iframe.contentDocument!.open();
  iframe.contentDocument!.write(html);
  iframe.contentDocument!.close();
  return iframe;
}

describe("IframePreviewAdapter.attachSync", () => {
  it("mirrors comp.getOverrides() onto the iframe immediately on attach", async () => {
    const iframe = mountIframe(BASE_HTML);
    const comp = await openComposition(BASE_HTML);
    comp.setStyle("hf-title", { color: "#f00" }); // edit BEFORE attaching

    const adapter = createIframePreviewAdapter(iframe);
    adapter.attachSync(comp);

    const liveTitle = iframe.contentDocument!.querySelector(
      '[data-hf-id="hf-title"]',
    ) as HTMLElement;
    expect(liveTitle.style.getPropertyValue("color")).toBe("#f00");
  });

  it("mirrors a style edit dispatched AFTER attaching", async () => {
    const iframe = mountIframe(BASE_HTML);
    const comp = await openComposition(BASE_HTML);
    const adapter = createIframePreviewAdapter(iframe);
    adapter.attachSync(comp);

    comp.setStyle("hf-title", { fontSize: "96px" });

    const liveTitle = iframe.contentDocument!.querySelector(
      '[data-hf-id="hf-title"]',
    ) as HTMLElement;
    expect(liveTitle.style.getPropertyValue("font-size")).toBe("96px");
  });

  it("mirrors setText, setAttribute, and removeElement", async () => {
    const iframe = mountIframe(BASE_HTML);
    const comp = await openComposition(BASE_HTML);
    const adapter = createIframePreviewAdapter(iframe);
    adapter.attachSync(comp);
    const liveDoc = iframe.contentDocument!;

    comp.setText("hf-title", "Goodbye");
    expect(liveDoc.querySelector('[data-hf-id="hf-title"]')?.textContent).toContain("Goodbye");

    comp.setAttribute("hf-title", "data-test", "1");
    expect(liveDoc.querySelector('[data-hf-id="hf-title"]')?.getAttribute("data-test")).toBe("1");

    comp.removeElement("hf-title");
    expect(liveDoc.querySelector('[data-hf-id="hf-title"]')).toBeNull();
  });

  it("mirrors undo — restores the live DOM to the pre-edit state", async () => {
    const iframe = mountIframe(BASE_HTML);
    const comp = await openComposition(BASE_HTML);
    const adapter = createIframePreviewAdapter(iframe);
    adapter.attachSync(comp);
    const liveDoc = iframe.contentDocument!;

    comp.setStyle("hf-title", { color: "#f00" });
    expect(
      (liveDoc.querySelector('[data-hf-id="hf-title"]') as HTMLElement).style.getPropertyValue(
        "color",
      ),
    ).toBe("#f00");

    comp.undo();
    expect(
      (liveDoc.querySelector('[data-hf-id="hf-title"]') as HTMLElement).style.getPropertyValue(
        "color",
      ),
    ).toBe("#fff");
  });

  it("mirrors redo after undo", async () => {
    const iframe = mountIframe(BASE_HTML);
    const comp = await openComposition(BASE_HTML);
    const adapter = createIframePreviewAdapter(iframe);
    adapter.attachSync(comp);
    const liveDoc = iframe.contentDocument!;

    comp.setStyle("hf-title", { color: "#f00" });
    comp.undo();
    comp.redo();
    expect(
      (liveDoc.querySelector('[data-hf-id="hf-title"]') as HTMLElement).style.getPropertyValue(
        "color",
      ),
    ).toBe("#f00");
  });

  it("does NOT mirror a /script/gsap patch onto the live <script> tag", async () => {
    const html = `<!DOCTYPE html>
<html><body>
  <div data-hf-id="hf-stage" data-hf-root style="width:1280px;height:720px" data-duration="5">
    <div data-hf-id="hf-box" style="opacity:0"></div>
  </div>
  <script>var tl = gsap.timeline({ paused: true });
window.__timelines = { t: tl };</script>
</body></html>`;
    const iframe = mountIframe(html);
    const liveScriptBefore = iframe.contentDocument!.querySelector("script")!.textContent;

    const comp = await openComposition(html);
    const adapter = createIframePreviewAdapter(iframe);
    adapter.attachSync(comp);

    comp.addGsapTween("hf-box", { method: "to", properties: { opacity: 1 }, duration: 1 });

    // The offscreen model's script changed (proves the edit really happened)...
    expect(comp.serialize()).not.toBe(html);
    // ...but the LIVE script tag is untouched — script patches are never mirrored.
    expect(iframe.contentDocument!.querySelector("script")!.textContent).toBe(liveScriptBefore);
  });

  it("DOES mirror a /style/css (stylesheet) patch onto the live <style> tag", async () => {
    const html = `<!DOCTYPE html>
<html><body>
  <div data-hf-id="hf-stage" data-hf-root style="width:1280px;height:720px" data-duration="5">
    <div data-hf-id="hf-box" class="boxy"></div>
  </div>
  <style>.boxy { color: blue; }</style>
</body></html>`;
    const iframe = mountIframe(html);
    const comp = await openComposition(html);
    const adapter = createIframePreviewAdapter(iframe);
    adapter.attachSync(comp);

    comp.dispatch({ type: "setClassStyle", selector: ".boxy", styles: { color: "green" } });

    const liveStyle = iframe.contentDocument!.querySelector("style")!.textContent ?? "";
    expect(liveStyle).toContain("green");
  });

  it("does not throw when a patch arrives after the iframe is removed from the DOM", async () => {
    const iframe = mountIframe(BASE_HTML);
    const comp = await openComposition(BASE_HTML);
    const adapter = createIframePreviewAdapter(iframe);
    adapter.attachSync(comp);

    iframe.remove(); // contentDocument becomes null (or inaccessible) once detached

    expect(() => comp.setStyle("hf-title", { color: "#0f0" })).not.toThrow();
  });

  it("re-attaching detaches the previous subscription — old comp's edits stop mirroring", async () => {
    const iframe = mountIframe(BASE_HTML);
    const compA = await openComposition(BASE_HTML);
    const compB = await openComposition(BASE_HTML);
    const adapter = createIframePreviewAdapter(iframe);

    adapter.attachSync(compA);
    adapter.attachSync(compB); // should detach compA's subscription

    compA.setStyle("hf-title", { color: "#f00" }); // must NOT mirror — stale subscription
    compB.setStyle("hf-title", { fontSize: "10px" }); // must mirror — active subscription

    const liveTitle = iframe.contentDocument!.querySelector(
      '[data-hf-id="hf-title"]',
    ) as HTMLElement;
    expect(liveTitle.style.getPropertyValue("color")).not.toBe("#f00");
    expect(liveTitle.style.getPropertyValue("font-size")).toBe("10px");
  });

  it("the returned unsubscribe function detaches the subscription", async () => {
    const iframe = mountIframe(BASE_HTML);
    const comp = await openComposition(BASE_HTML);
    const adapter = createIframePreviewAdapter(iframe);
    const detach = adapter.attachSync(comp);

    detach();
    comp.setStyle("hf-title", { color: "#f00" });

    const liveTitle = iframe.contentDocument!.querySelector(
      '[data-hf-id="hf-title"]',
    ) as HTMLElement;
    expect(liveTitle.style.getPropertyValue("color")).not.toBe("#f00");
  });

  it("mirrors setVariableValue onto the live root's CSS custom property", async () => {
    const html = `<!DOCTYPE html>
<html data-composition-variables='[{"id":"accent","default":"#fff"}]'>
<body>
  <div data-hf-id="hf-stage" data-hf-root style="--accent: #fff; width: 1280px; height: 720px" data-duration="5">
    <h1 data-hf-id="hf-title" style="color: var(--accent)">Hello World</h1>
  </div>
</body>
</html>`;
    const iframe = mountIframe(html);
    const comp = await openComposition(html);
    const adapter = createIframePreviewAdapter(iframe);
    adapter.attachSync(comp);

    comp.setVariableValue("accent", "#0f0");

    const liveRoot = iframe.contentDocument!.querySelector(
      '[data-hf-id="hf-stage"]',
    ) as HTMLElement;
    expect(liveRoot.style.getPropertyValue("--accent")).toBe("#0f0");
  });

  it("mirrors declareVariable/removeVariable onto the live document's schema attribute", async () => {
    // Full document (not a fragment): declareVariable refuses fragment sources.
    const fullDoc = `<!DOCTYPE html><html><body>${BASE_HTML}</body></html>`;
    const iframe = mountIframe(fullDoc); // no data-composition-variables at all
    const comp = await openComposition(fullDoc);
    const adapter = createIframePreviewAdapter(iframe);
    adapter.attachSync(comp);

    comp.declareVariable({ id: "accent", type: "string", label: "Accent", default: "#fff" });

    const liveDocEl = iframe.contentDocument!.documentElement;
    expect(liveDocEl.getAttribute("data-composition-variables")).toContain("accent");

    comp.removeVariable("accent");
    // Removing the last declaration drops the attribute entirely (null).
    expect(liveDocEl.getAttribute("data-composition-variables") ?? "").not.toContain("accent");
  });

  it("mirrors canonical setTiming attributes onto the live element", async () => {
    const iframe = mountIframe(BASE_HTML);
    const comp = await openComposition(BASE_HTML);
    const adapter = createIframePreviewAdapter(iframe);
    adapter.attachSync(comp);

    comp.setTiming("hf-title", { start: 1, duration: 2 });

    const liveTitle = iframe.contentDocument!.querySelector(
      '[data-hf-id="hf-title"]',
    ) as HTMLElement;
    expect(liveTitle.getAttribute("data-start")).toBe("1");
    expect(liveTitle.getAttribute("data-duration")).toBe("2");
    expect(liveTitle.getAttribute("data-end")).toBeNull();
  });
});

describe("IframePreviewAdapter.attachSync — iframe load re-sync", () => {
  it("re-applies the override snapshot when the iframe fires `load`", async () => {
    const iframe = mountIframe(BASE_HTML);
    const comp = await openComposition(BASE_HTML);
    const adapter = createIframePreviewAdapter(iframe);
    adapter.attachSync(comp);
    comp.setStyle("hf-title", { color: "#f00" });

    // Simulate a navigation: replace the document with a fresh base (the
    // mirrored edit is gone), then fire the load event a real srcdoc
    // assignment would produce.
    const midDoc = iframe.contentDocument;
    if (!midDoc) throw new Error("iframe has no document");
    midDoc.open();
    midDoc.write(BASE_HTML);
    midDoc.close();
    iframe.dispatchEvent(new Event("load"));

    const liveTitle = iframe.contentDocument?.querySelector(
      '[data-hf-id="hf-title"]',
    ) as HTMLElement;
    expect(liveTitle.style.getPropertyValue("color")).toBe("#f00");
  });

  it("stops re-syncing on load after detach", async () => {
    const iframe = mountIframe(BASE_HTML);
    const comp = await openComposition(BASE_HTML);
    const adapter = createIframePreviewAdapter(iframe);
    const detach = adapter.attachSync(comp);
    comp.setStyle("hf-title", { color: "#f00" });
    detach();

    const midDoc = iframe.contentDocument;
    if (!midDoc) throw new Error("iframe has no document");
    midDoc.open();
    midDoc.write(BASE_HTML);
    midDoc.close();
    iframe.dispatchEvent(new Event("load"));

    const liveTitle = iframe.contentDocument?.querySelector(
      '[data-hf-id="hf-title"]',
    ) as HTMLElement;
    // BASE_HTML's authored inline color remains because detach must not
    // re-apply comp's #f00 override on the load event.
    expect(liveTitle.style.getPropertyValue("color")).toBe("#fff");
  });
});
