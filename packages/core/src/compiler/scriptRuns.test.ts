// @vitest-environment node
import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";
import { inlineScriptRuns } from "./scriptRuns";

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

  it("returns no runs when there are no inline scripts", () => {
    expect(runsOf('<script src="x.js"></script>')).toEqual([]);
  });
});
