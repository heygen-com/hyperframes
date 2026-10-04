// @vitest-environment node
import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";
import {
  AFTER_FONTS_SCRIPT_TYPE,
  deferScriptsUntilFonts,
  inlineScriptRuns,
  typeAfterFonts,
} from "./scriptRuns";

function runsOf(bodyHtml: string, isPinned?: (el: Element) => boolean) {
  const { document } = parseHTML(`<!doctype html><html><body>${bodyHtml}</body></html>`);
  return inlineScriptRuns([...document.querySelectorAll("body script")], isPinned).map((run) => ({
    members: run.members.map((el) => el.textContent),
    anchor: run.anchor?.getAttribute("src") ?? run.anchor?.getAttribute("type") ?? run.anchor,
  }));
}

describe("inlineScriptRuns", () => {
  it("makes one run anchored at the end of the body when nothing separates the scripts", () => {
    expect(runsOf("<script>a</script><div></div><script>b</script>")).toEqual([
      { members: ["a", "b"], anchor: null },
    ]);
  });

  it("splits at a src script and anchors the earlier run to it", () => {
    expect(runsOf('<script>a</script><script src="x.js"></script><script>b</script>')).toEqual([
      { members: ["a"], anchor: "x.js" },
      { members: ["b"], anchor: null },
    ]);
  });

  it("splits at a module script", () => {
    expect(runsOf('<script>a</script><script type="module">m</script><script>b</script>')).toEqual([
      { members: ["a"], anchor: "module" },
      { members: ["b"], anchor: null },
    ]);
  });

  it("splits at a pinned script that has no src", () => {
    const pinned = (el: Element) => el.hasAttribute("data-pin");
    const runs = runsOf("<script>a</script><script data-pin>p</script><script>b</script>", pinned);
    expect(runs.map((run) => run.members)).toEqual([["a"], ["b"]]);
  });

  it("does not split at a non-executing script such as an import map or JSON data", () => {
    expect(
      runsOf(
        '<script>a</script><script type="importmap">{}</script><script type="application/json">{}</script><script>b</script>',
      ),
    ).toEqual([{ members: ["a", "b"], anchor: null }]);
  });

  it.each([
    "application/ecmascript",
    " TEXT/JScript ",
    "text/javascript1.5",
    "application/x-javascript",
  ])("treats the legacy JavaScript type %j as a classic script", (type) => {
    expect(runsOf(`<script>a</script><script type="${type}">b</script>`)).toEqual([
      { members: ["a", "b"], anchor: null },
    ]);
  });

  it("leaves a script whose type only looks like JavaScript out of the run", () => {
    expect(runsOf('<script>a</script><script type="text/javascript2">b</script>')).toEqual([
      { members: ["a"], anchor: null },
    ]);
  });

  it("returns no runs when there are no inline scripts", () => {
    expect(runsOf('<script src="x.js"></script>')).toEqual([]);
  });
});

describe("deferScriptsUntilFonts", () => {
  it("defers each classic and module body script, and only those", () => {
    const { document } = parseHTML(
      `<!doctype html><html><head><script>head</script></head><body>` +
        `<script>a</script><script src="lib.js"></script><script type="text/javascript">b</script>` +
        `<script type="module">m</script><script type="application/json">{}</script>` +
        `<script type="importmap">{}</script><script data-runtime>r</script>` +
        `<svg><script>s</script></svg><noscript><script>n</script></noscript></body></html>`,
    );
    deferScriptsUntilFonts(document as unknown as Document, (el) =>
      el.hasAttribute("data-runtime"),
    );
    const deferred = AFTER_FONTS_SCRIPT_TYPE;
    // First in the head: the fallback that runs them under a runtime without the gate.
    expect(document.head.firstElementChild?.textContent).toContain("no web-font gate");
    expect([...document.querySelectorAll("script")].map((el) => el.getAttribute("type"))).toEqual([
      null,
      null,
      deferred,
      deferred,
      deferred,
      `${deferred}+module`,
      "application/json",
      "importmap",
      null,
      null,
      null,
    ]);
    expect([...document.querySelectorAll("body script")].slice(0, 4).map(typeAfterFonts)).toEqual([
      null,
      null,
      null,
      "module",
    ]);
  });
});
