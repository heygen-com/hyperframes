import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { GSAP_BUILD_HASHES } from "./gsapBuilds.js";
import {
  compiledTextOf,
  compileKind,
  isGsapBuild,
  originFromText,
  type ParsedScriptEvent,
  sha256,
} from "./scriptOrigins.js";

const MAIN = "MAIN";
const DOC = "http://127.0.0.1:4100/index.html";

const event = (overrides: Partial<ParsedScriptEvent>): ParsedScriptEvent => ({
  scriptId: "1",
  url: "",
  embedderName: "",
  executionContextId: 3,
  executionContextAuxData: { isDefault: true, type: "default", frameId: MAIN },
  ...overrides,
});
const fromPage = { callFrames: [{ scriptId: "7" }] };

describe("compileKind", () => {
  it("calls every main-world compile with nothing on the stack and no document from outside", () => {
    // A DevTools evaluation, an evaluateOnNewDocument script, a javascript: URL and a string
    // timer all look like this; only the text tells them apart.
    for (const url of ["", "pptr:evaluate;x", "hyperframes://injected/0"]) {
      expect(compileKind(event({ url }), MAIN)).toBe("outside");
    }
  });

  it("calls a compile from page activity the page's, whatever its name", () => {
    for (const url of ["", "pptr:evaluate;x", "hyperframes://injected/0"]) {
      expect(compileKind(event({ url, stackTrace: fromPage }), MAIN)).toBe("page");
      expect(compileKind(event({ url, embedderName: DOC }), MAIN)).toBe("page");
    }
  });

  it("calls a main-world script replayed when the debugger was enabled late unobserved, never outside", () => {
    // The capture page's record starts once it is ready: the replay has no compile stack to read.
    for (const extra of [{}, { stackTrace: fromPage }, { embedderName: DOC }]) {
      expect(compileKind(event(extra), MAIN, false)).toBe("unobserved");
    }
    const isolated = { isDefault: false, type: "isolated", frameId: MAIN };
    expect(compileKind(event({ executionContextAuxData: isolated }), MAIN, false)).toBe("isolated");
    const child = { isDefault: true, type: "default", frameId: "CHILD" };
    expect(compileKind(event({ executionContextAuxData: child }), MAIN, false)).toBe("other_realm");
  });

  it("trusts isolated worlds and calls other frames' main worlds another realm", () => {
    const isolated = { isDefault: false, type: "isolated", frameId: MAIN };
    expect(compileKind(event({ executionContextAuxData: isolated }), MAIN)).toBe("isolated");
    const child = { isDefault: true, type: "default", frameId: "CHILD" };
    expect(compileKind(event({ executionContextAuxData: child }), MAIN)).toBe("other_realm");
    expect(compileKind(event({ executionContextAuxData: undefined }), MAIN)).toBe("other_realm");
  });
});

describe("compiledTextOf", () => {
  it("is the text V8 compiles for each DevTools command that compiles one", () => {
    expect(compiledTextOf("Runtime.evaluate", { expression: "this" })).toBe("this");
    expect(compiledTextOf("Debugger.evaluateOnCallFrame", { expression: "callback" })).toBe(
      "callback",
    );
    expect(compiledTextOf("Page.addScriptToEvaluateOnNewDocument", { source: "x()" })).toBe("x()");
    expect(
      compiledTextOf("Runtime.callFunctionOn", { functionDeclaration: "function () {}" }),
    ).toBe("(function () {})");
    expect(compiledTextOf("Runtime.getProperties", { objectId: "1" })).toBeUndefined();
  });
});

const GSAP_PATH = createRequire(import.meta.resolve("@hyperframes/core")).resolve(
  "gsap/dist/gsap.min.js",
);
const GSAP = readFileSync(GSAP_PATH, "utf8");

describe("isGsapBuild", () => {
  it("knows the GSAP build the renderer ships", () => {
    expect(isGsapBuild(GSAP)).toBe(true);
  });

  it("knows it as the compiler inlines it", () => {
    const src = "https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js";
    expect(isGsapBuild(`/* inlined: ${src} */\n${GSAP}\n//# sourceURL=${src}\n`)).toBe(true);
  });

  it("does not go by name or by most of the text", () => {
    expect(isGsapBuild(`${GSAP}\nwindow.x = 1;`)).toBe(false);
    expect(isGsapBuild(`window.x = 1;\n//# sourceURL=gsap.min.js`)).toBe(false);
    expect(
      isGsapBuild(`/* inlined: gsap.min.js */\n${GSAP};window.x=1\n//# sourceURL=gsap.min.js\n`),
    ).toBe(false);
  });

  it("lists every installed GSAP dist file it claims", () => {
    const dist = dirname(GSAP_PATH);
    const version = (
      JSON.parse(readFileSync(join(dist, "..", "package.json"), "utf8")) as { version: string }
    ).version;
    const listed = GSAP_BUILD_HASHES[version];
    expect(listed).toBeDefined();
    for (const [file, hash] of Object.entries(listed ?? {})) {
      expect(readdirSync(dist)).toContain(file);
      expect(sha256(readFileSync(join(dist, file), "utf8"))).toBe(hash);
    }
  });
});

describe("originFromText", () => {
  const renderer = new Set([sha256("window.__hfRuntime = 1;")]);

  it("trusts an isolated world without reading text", () => {
    expect(originFromText("isolated", undefined, renderer)).toBe("renderer");
  });

  it("trusts only the renderer's own texts and GSAP's, however they were compiled", () => {
    for (const kind of ["outside", "page", "unobserved"] as const) {
      expect(originFromText(kind, "window.__hfRuntime = 1;", renderer)).toBe("renderer");
      expect(originFromText(kind, GSAP, renderer)).toBe("gsap");
      expect(originFromText(kind, "window.__hfRuntime = 2;", renderer)).toBe("page");
    }
    // A javascript: URL named like a DevTools evaluation is still the page's.
    expect(originFromText("outside", "void(window.x=1)//# sourceURL=pptr:evaluate", renderer)).toBe(
      "page",
    );
  });

  it("counts a script whose text cannot be read as the page's", () => {
    expect(originFromText("outside", undefined, renderer)).toBe("page");
  });
});
