import { describe, expect, it, vi } from "vitest";

vi.mock("@hyperframes/parsers/postcss", async (load) => {
  const real = await load<typeof import("@hyperframes/parsers/postcss")>();
  return {
    ...real,
    parseCss: (css: string) => {
      if (css.includes("not-a-syntax-error"))
        throw new Error("ENOENT: no such file, open '/srv/app/.env'");
      return real.parseCss(css);
    },
  };
});

const { lintHyperframeHtml } = await import("../hyperframeLinter.js");

const page = (css: string) => `<html><body>
  <style>${css}</style>
  <div data-composition-id="main" data-width="1920" data-height="1080" data-start="0" data-duration="5"></div>
  <script src="gsap.min.js"></script>
  <script>window.__timelines = { main: gsap.timeline({ paused: true }) };</script>
</body></html>`;

describe("css_parse_error text", () => {
  it("names the parser's own message for a CSS syntax error", async () => {
    const { findings } = await lintHyperframeHtml(page(".stage { transform: xPercent: -10; }"));
    expect(findings.find((f) => f.code === "css_parse_error")?.message).toContain(
      "Missed semicolon",
    );
  });

  it("carries none of the text of any other error thrown while the block is read", async () => {
    const { findings } = await lintHyperframeHtml(page(".not-a-syntax-error { color: red; }"));
    const finding = findings.find((f) => f.code === "css_parse_error");
    expect(finding?.severity).toBe("error");
    expect(finding?.message).not.toMatch(/ENOENT|\/srv\/app|\.env/);
  });
});
