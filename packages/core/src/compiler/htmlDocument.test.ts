import { describe, expect, it } from "vitest";
import {
  injectScriptsAtHeadStart,
  injectScriptsIntoHtml,
  parseHTMLContent,
  stripEmbeddedRuntimeScripts,
} from "./htmlDocument.js";

describe("htmlDocument helpers", () => {
  it("wraps fragments before parsing", () => {
    const doc = parseHTMLContent("<template><span>hello</span></template>");
    expect(doc.body.querySelector("template")?.innerHTML).toContain("<span>hello</span>");
  });

  it("strips every known embedded HyperFrames runtime marker", () => {
    const html = `
<script src="hyperframe.runtime.iife.js"></script>
<script src="hyperframes-runtime.modular.inline.js"></script >
<script src="hyperframe-runtime.modular-runtime.inline.js"></script>
<script data-hyperframes-preview-runtime="1"></script>
<script>window.__playerReady = true;</script >
<script>window.__renderReady = false;</script>
<script>window.authored = true;</script>`;

    const stripped = stripEmbeddedRuntimeScripts(html);

    expect(stripped).not.toContain("hyperframe.runtime.iife.js");
    expect(stripped).not.toContain("hyperframes-runtime.modular.inline.js");
    expect(stripped).not.toContain("hyperframe-runtime.modular-runtime.inline.js");
    expect(stripped).not.toContain("data-hyperframes-preview-runtime");
    expect(stripped).not.toContain("window.__playerReady");
    expect(stripped).not.toContain("window.__renderReady");
    expect(stripped).toContain("window.authored = true");
  });

  it("keeps authored scripts that reference runtime readiness flags", () => {
    const html = `
<script>
  window.__timelines = window.__timelines || {};
  if (window.__renderReady) window.authoredReadySeen = true;
  window.__timelines["main"] = {};
</script>`;

    const stripped = stripEmbeddedRuntimeScripts(html);

    expect(stripped).toContain('window.__timelines["main"]');
    expect(stripped).toContain("window.__renderReady");
  });

  it("does not treat non-script tags as scripts when stripping runtimes", () => {
    const html = "<scripture>window.__playerReady = true;</scripture>";

    expect(stripEmbeddedRuntimeScripts(html)).toBe(html);
  });

  it("injects head and body scripts without replacement-token interpolation", () => {
    const html = "<html><head></head><body></body></html>";
    const injected = injectScriptsIntoHtml(html, ["window.x = '$&';"], ["window.y = '$&';"]);

    expect(injected).toContain("<script>window.x = '$&';</script>\n</head>");
    expect(injected).toContain("<script>window.y = '$&';</script>\n</body>");
  });

  it("injects early head scripts before authored head scripts", () => {
    const html = '<html><head><script id="authored"></script></head><body></body></html>';
    const injected = injectScriptsAtHeadStart(html, ["window.early = true;"]);

    expect(injected.indexOf("window.early = true")).toBeLessThan(injected.indexOf('id="authored"'));
  });

  it("escapes inline scripts so authored script text cannot break out of the wrapper tag", () => {
    const html = "<html><head></head><body></body></html>";
    const injected = injectScriptsIntoHtml(
      html,
      ['window.payload = "</script ><script>window.pwned = true;</script>";'],
      ["window.comment = '<!-- kept as script text';"],
    );

    expect(injected).toContain("<\\/script ><script>window.pwned = true;<\\/script>");
    expect(injected).toContain("<\\!-- kept as script text");
    expect(injected).not.toContain("</script ><script>window.pwned = true;");
  });
});
