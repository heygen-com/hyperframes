import { describe, expect, it } from "bun:test";

const loadSubject = () => import("./semantic-fixtures.js");

const canonical = `<button data-hf-ui-root type="button">Continue</button>
<style>[data-hf-ui-root] { min-height: 40px; }</style>`;

const demo = `<!doctype html>
<html>
  <head>
    <script src="../../ui-primitives/vendor/gsap-3.14.2.min.js"></script>
  </head>
  <body>
    <main data-hf-theme="dark">
      <!-- hf-ui:canonical:start -->
${canonical}
<!-- hf-ui:canonical:end -->
    </main>
    <script>
      const tl = gsap.timeline({ paused: true });
      tl.addLabel("start", 0);
      tl.addLabel("end", 4);
      window.__timelines = { demo: tl };
    </script>
  </body>
</html>`;

describe("Operator Black semantic fixtures", () => {
  it("extracts the exact canonical payload embedded in a demo", async () => {
    const { extractCanonicalRegion } = await loadSubject();

    expect(extractCanonicalRegion(demo)).toBe(canonical);
    expect(() => extractCanonicalRegion("<main>missing markers</main>")).toThrow(
      "canonical markers",
    );
    expect(() => extractCanonicalRegion(`${demo}\n<!-- hf-ui:canonical:end -->`)).toThrow(
      "exactly one",
    );
  });

  it("wraps a standalone canonical without network or fixed-canvas dependencies", async () => {
    const { createStandaloneFixture } = await loadSubject();

    const fixture = createStandaloneFixture(canonical, {
      id: "button",
      theme: "light",
    });

    expect(fixture).toStartWith("<!doctype html>");
    expect(fixture).toContain('data-hf-verifier-fixture="canonical"');
    expect(fixture).toContain('data-hf-theme="light"');
    expect(fixture).toContain(canonical);
    expect(fixture).toContain("width: 100%");
    expect(fixture).not.toMatch(/https?:\/\//);
  });

  it("defines the exact 15 closed-state fixtures with canonical controller relationships", async () => {
    const { CLOSED_STATE_FIXTURES } = await loadSubject();

    expect(CLOSED_STATE_FIXTURES.map((fixture) => fixture.id)).toEqual([
      "accordion",
      "alert-dialog",
      "backdrop",
      "collapsible",
      "combobox",
      "context-menu",
      "dialog",
      "drawer",
      "dropdown-menu",
      "hover-card",
      "popover",
      "select",
      "sheet",
      "toast",
      "tooltip",
    ]);
    expect(CLOSED_STATE_FIXTURES.filter((fixture) => fixture.mode === "controlled")).toHaveLength(
      8,
    );
    expect(CLOSED_STATE_FIXTURES.filter((fixture) => fixture.mode === "root")).toHaveLength(7);
  });

  it("builds synchronized open/closed semantics without removing disclosure triggers", async () => {
    const { CLOSED_STATE_FIXTURES, createSemanticStateFixture } = await loadSubject();
    const spec = CLOSED_STATE_FIXTURES.find((fixture) => fixture.id === "accordion");
    if (spec === undefined) throw new Error("missing accordion fixture spec");

    const closed = createSemanticStateFixture(
      `<div data-hf-ui-root><div class="hf-ui-accordion-item"><button class="hf-ui-accordion-trigger" aria-controls="answer">Question</button><div id="answer"><a href="#answer">Answer</a></div></div></div>`,
      { id: "accordion", theme: "dark", spec, state: "closed" },
    );
    const open = createSemanticStateFixture(
      `<div data-hf-ui-root><div class="hf-ui-accordion-item"><button class="hf-ui-accordion-trigger" aria-controls="answer">Question</button><div id="answer"><a href="#answer">Answer</a></div></div></div>`,
      { id: "accordion", theme: "dark", spec, state: "open" },
    );

    expect(closed).toContain('controller.setAttribute("aria-expanded", String(open))');
    expect(closed).toContain("region.hidden = !open");
    expect(closed).toContain("region.inert = !open");
    expect(closed).toContain('region.setAttribute("aria-hidden", "true")');
    expect(open).toContain('"state":"open"');
    expect(() =>
      createSemanticStateFixture(canonical, {
        id: "wrong-id",
        theme: "dark",
        spec,
        state: "closed",
      }),
    ).toThrow("does not match");
  });

  it("inlines pinned GSAP and makes the demo shell viewport-relative", async () => {
    const { createDemoFixture } = await loadSubject();

    const fixture = createDemoFixture(demo, {
      id: "button",
      theme: "dark",
      gsapSource: "window.gsap = { timeline() {} };",
    });

    expect(fixture).not.toContain('gsap-3.14.2.min.js"></script>');
    expect(fixture).toContain("window.gsap = { timeline() {} };");
    expect(fixture).toContain('data-hf-verifier-fixture="demo"');
    expect(fixture).toContain("100vw !important");
    expect(fixture).toContain("100vh !important");
    expect(fixture).not.toMatch(/<script[^>]+src=/);
  });

  it("parses literal named checkpoints and rejects ambiguous labels", async () => {
    const { parseTimelineLabels } = await loadSubject();

    expect(parseTimelineLabels(demo)).toEqual({ start: 0, end: 4 });
    expect(() => parseTimelineLabels(`${demo}\ntl.addLabel("start", 1);`)).toThrow(
      "duplicate timeline label start",
    );
    expect(() => parseTimelineLabels('tl.addLabel("open", dynamicTime);')).toThrow(
      "literal numeric time",
    );
  });
});
