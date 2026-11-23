import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { GSAP_BUILD_HASHES } from "./gsapBuilds.js";
import {
  createParseClassifier,
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

describe("createParseClassifier", () => {
  it("trusts scripts compiled before anything else in the document (evaluateOnNewDocument)", () => {
    const classify = createParseClassifier(MAIN);
    expect(classify(event({ scriptId: "4" }))).toBe("renderer");
    expect(classify(event({ scriptId: "5" }))).toBe("renderer");
    expect(classify(event({ scriptId: "6", url: DOC, embedderName: DOC }))).toBe("by_text");
    // After the document's first script, an unnamed stackless script is a string timer or a
    // javascript: URL as much as a DevTools evaluation.
    expect(classify(event({ scriptId: "8" }))).toBe("by_text");
  });

  it("trusts DevTools evaluations by their pptr: URL only when nothing on the page compiled them", () => {
    const classify = createParseClassifier(MAIN);
    classify(event({ url: DOC, embedderName: DOC }));
    expect(classify(event({ url: "pptr:evaluate;x" }))).toBe("renderer");
    // eval / new Function / an inserted inline script, named like one.
    expect(classify(event({ url: "pptr:evaluate;x", stackTrace: fromPage }))).toBe("by_text");
    // A parser-inserted or external script, named like one.
    expect(classify(event({ url: "pptr:evaluate;x", embedderName: DOC }))).toBe("by_text");
  });

  it("decides every script the page compiled by its text", () => {
    const classify = createParseClassifier(MAIN);
    classify(event({ url: DOC, embedderName: DOC }));
    for (const spoof of [
      "",
      "hyperframes://injected/0",
      "http://127.0.0.1:4100/assets/gsap.min.js",
    ]) {
      expect(classify(event({ url: spoof, stackTrace: fromPage }))).toBe("by_text");
      expect(classify(event({ url: spoof, embedderName: DOC }))).toBe("by_text");
    }
  });

  it("trusts isolated worlds and nothing in other frames", () => {
    const classify = createParseClassifier(MAIN);
    const isolated = { isDefault: false, type: "isolated", frameId: MAIN };
    expect(classify(event({ executionContextId: 4, executionContextAuxData: isolated }))).toBe(
      "renderer",
    );
    const child = { isDefault: true, type: "default", frameId: "CHILD" };
    expect(classify(event({ executionContextId: 5, executionContextAuxData: child }))).toBe(
      "by_text",
    );
    expect(
      classify(event({ executionContextId: 5, executionContextAuxData: child, url: "pptr:x" })),
    ).toBe("by_text");
    expect(classify(event({ executionContextId: 6, executionContextAuxData: undefined }))).toBe(
      "by_text",
    );
  });

  it("keeps each document's opening run apart", () => {
    const classify = createParseClassifier(MAIN);
    classify(event({ executionContextId: 3, url: DOC, embedderName: DOC }));
    // The next document (a navigation) opens with the renderer's scripts again.
    expect(classify(event({ executionContextId: 9 }))).toBe("renderer");
    expect(classify(event({ executionContextId: 3 }))).toBe("by_text");
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

  it("trusts a parse verdict of the renderer without reading text", () => {
    expect(originFromText("renderer", undefined, renderer)).toBe("renderer");
  });

  it("trusts only the renderer's own texts and GSAP's", () => {
    expect(originFromText("by_text", "window.__hfRuntime = 1;", renderer)).toBe("renderer");
    expect(originFromText("by_text", GSAP, renderer)).toBe("gsap");
    expect(originFromText("by_text", "window.__hfRuntime = 2;", renderer)).toBe("page");
  });

  it("counts a script whose text cannot be read as the page's", () => {
    expect(originFromText("by_text", undefined, renderer)).toBe("page");
  });
});
