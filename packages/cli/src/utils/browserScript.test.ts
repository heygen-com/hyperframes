// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadBrowserScript } from "../commands/layout";
import { prepareBrowserScript } from "./browserScript";

const here = dirname(fileURLToPath(import.meta.url));
const layoutAuditSource = readFileSync(join(here, "../commands/layout-audit.browser.js"), "utf-8");

describe("prepareBrowserScript", () => {
  it("produces an executable standalone audit without leaking the injected helper", () => {
    const prepared = prepareBrowserScript("layout-audit.browser.js", layoutAuditSource);

    window.eval(prepared);

    expect(Reflect.get(window, "__hyperframesLayoutAudit")).toBeTypeOf("function");
    expect(Reflect.get(window, "__hyperframesCssColorAlpha")).toBeUndefined();
  });

  it("leaves unrelated standalone scripts unchanged", () => {
    expect(prepareBrowserScript("motion-sample.browser.js", "window.example = true;")).toBe(
      "window.example = true;",
    );
  });

  it("is applied by the CLI loader", () => {
    Reflect.deleteProperty(window, "__hyperframesLayoutAudit");
    window.eval(loadBrowserScript("layout-audit.browser.js"));

    expect(Reflect.get(window, "__hyperframesLayoutAudit")).toBeTypeOf("function");
    expect(Reflect.get(window, "__hyperframesCssColorAlpha")).toBeUndefined();
  });
});
