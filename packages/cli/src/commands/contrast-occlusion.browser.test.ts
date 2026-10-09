// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const script = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "contrast-audit.browser.js"),
  "utf8",
);
const computedStyle = window.getComputedStyle.bind(window);

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error("Missing fixture element: " + id);
  return found;
}

function installStack(ids: string[]): void {
  const stack = () => ids.map(element);
  Object.defineProperty(document, "elementsFromPoint", {
    configurable: true,
    value: vi.fn(stack),
  });
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: vi.fn(() => stack()[0] ?? null),
  });
}

function prepare(): unknown {
  window.eval(script);
  return window.eval("window.__contrastAuditPrepare()");
}

beforeEach(() => {
  document.body.innerHTML = `
    <div id="root" data-composition-id="main" style="opacity: 1">
      <div id="headline" data-layout-allow-occlusion
        style="font-size: 32px; color: rgb(51, 51, 51); opacity: 1">Visible copy</div>
      <div id="overlay" data-composition-id="overlay" style="background-color: transparent; background-image: none"></div>
    </div>
  `;
  vi.spyOn(element("headline"), "getBoundingClientRect").mockReturnValue({
    x: 100,
    y: 100,
    left: 100,
    top: 100,
    right: 500,
    bottom: 140,
    width: 400,
    height: 40,
    toJSON() {
      return {};
    },
  });
  const emptyPseudo = document.createElement("span").style;
  emptyPseudo.content = "none";
  // Happy DOM does not calculate pseudo-element styles.
  vi.spyOn(window, "getComputedStyle").mockImplementation((el, pseudo) =>
    pseudo ? emptyPseudo : computedStyle(el),
  );
  installStack(["overlay", "headline", "root"]);
});

afterEach(() => {
  window.eval("window.__contrastAuditRestoreIfPending?.()");
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  Reflect.deleteProperty(document, "elementFromPoint");
  Reflect.deleteProperty(document, "elementsFromPoint");
  for (const name of [
    "__contrastAuditPrepare",
    "__contrastAuditFinish",
    "__contrastAuditRestoreIfPending",
    "__contrastAuditRestores",
  ])
    Reflect.deleteProperty(window, name);
});

describe("contrast audit beneath composition boxes", () => {
  it("audits visible text beneath a transparent composition host", () => {
    expect(prepare()).toContainEqual(expect.objectContaining({ selector: "#headline" }));
  });

  it("walks through nested transparent composition roots", () => {
    const nested = document.createElement("div");
    nested.id = "nested";
    nested.dataset.compositionId = "nested";
    element("overlay").appendChild(nested);
    installStack(["nested", "overlay", "headline", "root"]);
    expect(prepare()).toContainEqual(expect.objectContaining({ selector: "#headline" }));
  });

  it("walks through the compiler's flattened inner root and its host", () => {
    const inner = document.createElement("div");
    inner.id = "inner";
    inner.dataset.hfInnerRoot = "true";
    element("overlay").appendChild(inner);
    installStack(["inner", "overlay", "headline", "root"]);
    expect(prepare()).toContainEqual(expect.objectContaining({ selector: "#headline" }));
  });

  it("retains an opaque flattened inner root", () => {
    const inner = document.createElement("div");
    inner.id = "inner";
    inner.dataset.hfInnerRoot = "true";
    inner.style.background = "white";
    element("overlay").appendChild(inner);
    installStack(["inner", "overlay", "headline", "root"]);
    expect(prepare()).toEqual([]);
  });

  it("does not exempt a marked inner root outside a composition", () => {
    element("overlay").removeAttribute("data-composition-id");
    element("overlay").dataset.hfInnerRoot = "true";
    document.body.appendChild(element("overlay"));
    expect(prepare()).toEqual([]);
  });

  it("does not walk past an opaque layer beneath a transparent host", () => {
    const cover = document.createElement("div");
    cover.id = "cover";
    cover.style.background = "white";
    element("overlay").before(cover);
    installStack(["overlay", "cover", "headline", "root"]);
    expect(prepare()).toEqual([]);
  });

  it.each([
    ["background color", "background-color", "rgb(255, 255, 255)"],
    ["background image", "background-image", "linear-gradient(white, white)"],
    ["box shadow", "box-shadow", "0 0 0 1000px white"],
    ["filter", "filter", "drop-shadow(0 0 100px white)"],
    ["backdrop filter", "backdrop-filter", "blur(20px)"],
    ["border", "border", "100px solid white"],
    ["outline", "outline", "100px solid white"],
  ])("retains the occlusion behavior for a host with %s", (_name, property, value) => {
    element("overlay").style.setProperty(property, value);
    expect(prepare()).toEqual([]);
  });

  it.each(["::before", "::after"])("retains a host with generated %s content", (pseudo) => {
    const pseudoStyle = document.createElement("span").style;
    pseudoStyle.content = '""';
    pseudoStyle.backgroundColor = "white";
    vi.spyOn(window, "getComputedStyle").mockImplementation((el, target) =>
      target
        ? el.id === "overlay" && target === pseudo
          ? pseudoStyle
          : document.createElement("span").style
        : computedStyle(el),
    );
    expect(prepare()).toEqual([]);
  });

  it("retains a composition host that paints its own direct text", () => {
    element("overlay").append("Foreground copy");
    expect(prepare()).toEqual([]);
  });

  it("does not exempt unrelated transparent elements", () => {
    element("overlay").removeAttribute("data-composition-id");
    expect(prepare()).toEqual([]);
  });

  it("audits text beneath a transparent section root", () => {
    element("overlay").outerHTML = '<section id="overlay" data-composition-id="overlay"></section>';
    expect(prepare()).toContainEqual(expect.objectContaining({ selector: "#headline" }));
  });

  it("does not exempt a composition host with a shadow root", () => {
    element("overlay").attachShadow({ mode: "open" }).innerHTML = "Foreground copy";
    expect(prepare()).toEqual([]);
  });

  it.each(["canvas", "video", "img", "iframe", "object", "embed", "svg", "input", "button"])(
    "does not exempt a %s with a composition attribute",
    (tag) => {
      element("overlay").outerHTML = `<${tag} id="overlay" data-composition-id="overlay"></${tag}>`;
      expect(prepare()).toEqual([]);
    },
  );

  it("keeps the existing single-hit behavior when the hit stack is unavailable", () => {
    Reflect.deleteProperty(document, "elementsFromPoint");
    expect(prepare()).toEqual([]);
  });

  it("audits a partly covered block when any probe reaches the text", () => {
    const top = (x: number) => element(x > 300 ? "headline" : "overlay");
    Object.defineProperty(document, "elementsFromPoint", {
      configurable: true,
      value: vi.fn((x: number) => [top(x)]),
    });
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(top),
    });
    element("overlay").style.backgroundColor = "rgb(255, 255, 255)";
    expect(prepare()).toContainEqual(expect.objectContaining({ selector: "#headline" }));
  });

  it("does not turn clipped-away text into a contrast candidate", () => {
    element("headline").style.clipPath = "inset(0 100% 0 0)";
    installStack(["overlay", "root"]);
    expect(prepare()).toEqual([]);
  });
});
