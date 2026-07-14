/**
 * getVariableUsage (declaration ↔ script-scan cross-reference) and
 * setPreviewVariables (preview adapter delegation).
 */

import { describe, it, expect } from "vitest";
import { openComposition } from "./session.js";
import type { PreviewAdapter } from "./adapters/types.js";

const DECLS = JSON.stringify([
  { id: "title", type: "string", label: "Title", default: "Hello" },
  { id: "accent", type: "color", label: "Accent", default: "#00C3FF" },
  { id: "orphan", type: "string", label: "Never read", default: "x" },
]);

function doc(script: string, decls: string | null = DECLS): string {
  const attr = decls ? ` data-composition-variables='${decls}'` : "";
  return `<!DOCTYPE html>
<html${attr}>
<body>
<div data-hf-id="hf-stage" data-hf-root data-duration="5">
  <h1 data-hf-id="hf-title">Hello</h1>
</div>
<script>${script}</script>
</body>
</html>`;
}

describe("getVariableUsage", () => {
  it("cross-references used, unused, and undeclared ids", async () => {
    const comp = await openComposition(
      doc(`
        const { title, ghost } = __hyperframes.getVariables();
        document.querySelector("h1").textContent = title;
        const vars = __hyperframes.getVariables();
        el.style.color = vars.accent;
      `),
    );
    const usage = comp.getVariableUsage();
    expect(usage.usedIds).toEqual(["title", "ghost", "accent"]);
    expect(usage.unusedDeclarations).toEqual(["orphan"]);
    expect(usage.undeclaredReads).toEqual(["ghost"]);
    expect(usage.scanIncomplete).toBe(false);
  });

  it("reports all declarations unused when no script reads variables", async () => {
    const comp = await openComposition(doc(`gsap.timeline({ paused: true });`));
    const usage = comp.getVariableUsage();
    expect(usage.usedIds).toEqual([]);
    expect(usage.unusedDeclarations).toEqual(["title", "accent", "orphan"]);
    expect(usage.scanIncomplete).toBe(false);
  });

  it("propagates scanIncomplete from opaque access", async () => {
    const comp = await openComposition(
      doc(`const vars = getVariables(); const v = vars[pickKey()];`),
    );
    expect(comp.getVariableUsage().scanIncomplete).toBe(true);
  });

  it("counts a variable used only via var(--id) in a <style> block as used", async () => {
    const comp = await openComposition(
      doc(`gsap.timeline({ paused: true });`).replace(
        "<body>",
        `<body><style>.stage { background: var(--accent); }</style>`,
      ),
    );
    const usage = comp.getVariableUsage();
    // accent is CSS-consumed, so it must NOT be badged unused.
    expect(usage.unusedDeclarations).toEqual(["title", "orphan"]);
  });

  it("does not count var(--id) as usage of a prefix-extended custom property", async () => {
    // `accent` must not be marked used by an unrelated `var(--accent-shadow)`.
    const comp = await openComposition(
      doc(`gsap.timeline({ paused: true });`).replace(
        "<body>",
        `<body><style>.stage { box-shadow: 0 0 4px var(--accent-shadow); }</style>`,
      ),
    );
    const usage = comp.getVariableUsage();
    expect(usage.unusedDeclarations).toContain("accent");
  });

  it("counts declarative data-var-src / data-var-text bindings as usage", async () => {
    const comp = await openComposition(`<!DOCTYPE html>
<html data-composition-variables='${DECLS}'>
<body>
<div data-hf-id="hf-stage" data-hf-root data-duration="5">
  <img data-hf-id="hf-img" data-var-src="accent" src="x.jpg" />
  <h1 data-hf-id="hf-h" data-var-text="title">t</h1>
</div>
</body>
</html>`);
    const usage = comp.getVariableUsage();
    expect(usage.usedIds).toEqual(expect.arrayContaining(["accent", "title"]));
    expect(usage.unusedDeclarations).toEqual(["orphan"]);
    expect(usage.scanIncomplete).toBe(false);
  });

  it("handles compositions with no declarations and no scripts", async () => {
    const comp = await openComposition(
      `<!DOCTYPE html><html><body><div data-hf-id="hf-stage" data-hf-root data-duration="5"><p data-hf-id="hf-p">x</p></div></body></html>`,
    );
    expect(comp.getVariableUsage()).toEqual({
      usedIds: [],
      unusedDeclarations: [],
      undeclaredReads: [],
      scanIncomplete: false,
    });
  });
});

describe("setPreviewVariables", () => {
  function makeAdapter(calls: Array<Record<string, unknown> | null>): PreviewAdapter {
    return {
      elementAtPoint: () => null,
      applyDraft: () => {},
      commitPreview: () => {},
      cancelPreview: () => {},
      select: () => {},
      on: () => () => {},
      setPreviewVariables: (values) => calls.push(values),
    };
  }

  it("delegates to the preview adapter and reports handling", async () => {
    const calls: Array<Record<string, unknown> | null> = [];
    const comp = await openComposition(doc(""), { preview: makeAdapter(calls) });
    expect(comp.setPreviewVariables({ title: "Custom" })).toBe(true);
    expect(comp.setPreviewVariables(null)).toBe(true);
    expect(calls).toEqual([{ title: "Custom" }, null]);
  });

  it("returns false without an adapter or without adapter support", async () => {
    const noAdapter = await openComposition(doc(""));
    expect(noAdapter.setPreviewVariables({ a: 1 })).toBe(false);

    const bare = makeAdapter([]);
    delete bare.setPreviewVariables;
    const unsupported = await openComposition(doc(""), { preview: bare });
    expect(unsupported.setPreviewVariables({ a: 1 })).toBe(false);
  });
});
