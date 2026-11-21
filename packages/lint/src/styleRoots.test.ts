import postcss from "postcss";
import { afterEach, expect, it, vi } from "vitest";
import { lintHyperframeHtml } from "./hyperframeLinter.js";

afterEach(() => vi.restoreAllMocks());

it("parses each style block once per lint, however many rules read it", async () => {
  const css = `.title { font-family: "Inter", sans-serif; transition: opacity 1s; mask-image: url(a.png); }`;
  const parse = vi.spyOn(postcss, "parse");
  await lintHyperframeHtml(`<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080"><h1 class="title">Hi</h1></div>
  <style>${css}</style>
</body></html>`);
  expect(parse.mock.calls.filter(([source]) => source === css)).toHaveLength(1);
});

it("reports a malformed style block once and still lints the rest", async () => {
  const result = await lintHyperframeHtml(`<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080"></div>
  <style>.a { color: red</style>
</body></html>`);
  expect(result.findings.filter((f) => f.code === "css_parse_error")).toHaveLength(1);
});
