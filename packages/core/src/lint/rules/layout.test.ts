import { describe, it, expect } from "vitest";
import { lintHyperframeHtml } from "../hyperframeLinter.js";

const ROOT_OPEN = `<!DOCTYPE html><html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080" data-start="0">`;
const ROOT_CLOSE = `</div>
  <script>
    window.__timelines = window.__timelines || {};
    window.__timelines["main"] = gsap.timeline({ paused: true });
  </script>
</body></html>`;

describe("layout rules", () => {
  describe("absolute_width_collapse", () => {
    it("errors when an absolute child width:100% sits inside a max-width-only parent", async () => {
      const html = `${ROOT_OPEN}
        <style>
          .text-container { position: absolute; max-width: 1200px; left: 50%; top: 50%; transform: translate(-50%, -50%); }
          .hero-headline { position: absolute; width: 100%; }
        </style>
        <div class="text-container">
          <h1 class="hero-headline">Hello</h1>
        </div>
      ${ROOT_CLOSE}`;
      const result = await lintHyperframeHtml(html);
      const finding = result.findings.find((f) => f.code === "absolute_width_collapse");
      expect(finding).toBeDefined();
      // Bumped to `error` because this is the same load-bearing class of
      // bug as `hero_absolute_center_maxwidth_only` — text wraps at every
      // space at render time.
      expect(finding?.severity).toBe("error");
    });

    it("does not warn when the parent has explicit width:100%", async () => {
      const html = `${ROOT_OPEN}
        <style>
          .text-container { position: absolute; width: 100%; max-width: 1600px; }
          .hero-headline { position: absolute; width: 100%; }
        </style>
        <div class="text-container">
          <h1 class="hero-headline">Hello</h1>
        </div>
      ${ROOT_CLOSE}`;
      const result = await lintHyperframeHtml(html);
      expect(result.findings.some((f) => f.code === "absolute_width_collapse")).toBe(false);
    });
  });

  describe("absolute_center_missing_translate", () => {
    it("warns when left:50% / top:50% lacks transform translate", async () => {
      const html = `${ROOT_OPEN}
        <style>
          #pill { position: absolute; left: 50%; top: 50%; }
        </style>
        <div id="pill">x</div>
      ${ROOT_CLOSE}`;
      const result = await lintHyperframeHtml(html);
      expect(result.findings.some((f) => f.code === "absolute_center_missing_translate")).toBe(
        true,
      );
    });

    it("does not warn when translate(-50%, -50%) is set", async () => {
      const html = `${ROOT_OPEN}
        <style>
          #pill { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); }
        </style>
        <div id="pill">x</div>
      ${ROOT_CLOSE}`;
      const result = await lintHyperframeHtml(html);
      expect(result.findings.some((f) => f.code === "absolute_center_missing_translate")).toBe(
        false,
      );
    });
  });

  describe("word_stagger_block_display", () => {
    it("warns when .word spans use display:block in a word-stagger composition", async () => {
      const html = `${ROOT_OPEN}
        <style>
          .hero-headline .word { display: block; }
        </style>
        <h1 class="hero-headline">
          <span class="word">Your</span>
          <span class="word">Mac</span>
        </h1>
        <script>
          /* per-word stagger */
          gsap.from('.word', { y: 40, opacity: 0, stagger: 0.05 });
        </script>
      ${ROOT_CLOSE}`;
      const result = await lintHyperframeHtml(html);
      expect(result.findings.some((f) => f.code === "word_stagger_block_display")).toBe(true);
    });

    it("does not warn when .word spans use display:inline-block", async () => {
      const html = `${ROOT_OPEN}
        <style>
          .hero-headline .word { display: inline-block; }
        </style>
        <h1 class="hero-headline">
          <span class="word">Your</span>
        </h1>
        <script>
          gsap.from('.word', { y: 40, stagger: 0.05 });
        </script>
      ${ROOT_CLOSE}`;
      const result = await lintHyperframeHtml(html);
      expect(result.findings.some((f) => f.code === "word_stagger_block_display")).toBe(false);
    });

    it("does not warn when .word is an unrelated badge (no GSAP stagger usage)", async () => {
      // `.word { display: block }` here is a word-count badge UI element,
      // not a per-word stagger span. With no `stagger:` key and no GSAP
      // target naming `.word`, the rule should stay silent.
      const html = `${ROOT_OPEN}
        <style>
          .word-count { font-weight: bold; }
          .word { display: block; padding: 8px; border-radius: 4px; }
        </style>
        <div class="word-count">
          <span class="word">42 words</span>
        </div>
        <script>
          gsap.to('.word-count', { opacity: 1, duration: 0.4 });
        </script>
      ${ROOT_CLOSE}`;
      const result = await lintHyperframeHtml(html);
      expect(result.findings.some((f) => f.code === "word_stagger_block_display")).toBe(false);
    });
  });

  describe("hero_absolute_center_maxwidth_only", () => {
    it("fires on the canonical width-collapse pattern", async () => {
      const html = `${ROOT_OPEN}
        <style>
          .text-container {
            position: absolute; left: 50%; top: 50%;
            transform: translate(-50%, -50%);
            max-width: 1200px;
          }
        </style>
        <div class="text-container">Hello</div>
      ${ROOT_CLOSE}`;
      const result = await lintHyperframeHtml(html);
      const finding = result.findings.find((f) => f.code === "hero_absolute_center_maxwidth_only");
      expect(finding).toBeDefined();
      // Severity bumped to `error` so `hyperframes lint` exits non-zero on
      // the canonical width-collapse anti-pattern (warnings don't fail CI).
      expect(finding?.severity).toBe("error");
    });

    it("does not fire when an explicit width is present", async () => {
      const html = `${ROOT_OPEN}
        <style>
          .text-container {
            position: absolute; left: 50%; top: 50%;
            transform: translate(-50%, -50%);
            width: 1600px;
            max-width: 1200px;
          }
        </style>
        <div class="text-container">Hello</div>
      ${ROOT_CLOSE}`;
      const result = await lintHyperframeHtml(html);
      expect(result.findings.some((f) => f.code === "hero_absolute_center_maxwidth_only")).toBe(
        false,
      );
    });
  });

  describe("nowrap_missing_max_width", () => {
    it("warns when nowrap is set with no bounding width on a non-caption selector", async () => {
      const html = `${ROOT_OPEN}
        <style>
          .hero-headline { white-space: nowrap; }
        </style>
        <h1 class="hero-headline">Long headline</h1>
      ${ROOT_CLOSE}`;
      const result = await lintHyperframeHtml(html);
      expect(result.findings.some((f) => f.code === "nowrap_missing_max_width")).toBe(true);
    });

    it("does not warn when nowrap has max-width", async () => {
      const html = `${ROOT_OPEN}
        <style>
          .hero-headline { white-space: nowrap; max-width: 1600px; }
        </style>
        <h1 class="hero-headline">Long headline</h1>
      ${ROOT_CLOSE}`;
      const result = await lintHyperframeHtml(html);
      expect(result.findings.some((f) => f.code === "nowrap_missing_max_width")).toBe(false);
    });

    it("does not double-emit on caption selectors (captions rule handles those)", async () => {
      const html = `${ROOT_OPEN}
        <style>
          .caption-text { white-space: nowrap; }
        </style>
        <div class="caption-text">hi</div>
      ${ROOT_CLOSE}`;
      const result = await lintHyperframeHtml(html);
      const nowrapHit = result.findings.find((f) => f.code === "nowrap_missing_max_width");
      expect(nowrapHit).toBeUndefined();
    });
  });

  describe("gsap_css_transition_conflict", () => {
    it("warns when CSS transition and GSAP animate the same property", async () => {
      const html = `${ROOT_OPEN}
        <style>
          .box { transition: transform 0.3s ease; }
        </style>
        <div class="box"></div>
        <script>
          gsap.to('.box', { x: 100, duration: 1 });
        </script>
      ${ROOT_CLOSE}`;
      const result = await lintHyperframeHtml(html);
      expect(result.findings.some((f) => f.code === "gsap_css_transition_conflict")).toBe(true);
    });

    it("does not warn when CSS transition targets a different property", async () => {
      const html = `${ROOT_OPEN}
        <style>
          .box { transition: background-color 0.3s ease; }
        </style>
        <div class="box"></div>
        <script>
          gsap.to('.box', { x: 100, duration: 1 });
        </script>
      ${ROOT_CLOSE}`;
      const result = await lintHyperframeHtml(html);
      expect(result.findings.some((f) => f.code === "gsap_css_transition_conflict")).toBe(false);
    });

    it("warns when CSS rule uses a descendant selector matching the GSAP target", async () => {
      // `.scene .box` should cover GSAP `.box` even though they aren't an
      // exact selector-string match — the descendant `.box` element is
      // inside `.scene`, so the CSS transition applies.
      const html = `${ROOT_OPEN}
        <style>
          .scene .box { transition: transform 0.3s ease; }
        </style>
        <div class="scene">
          <div class="box"></div>
        </div>
        <script>
          gsap.to('.box', { x: 100, duration: 1 });
        </script>
      ${ROOT_CLOSE}`;
      const result = await lintHyperframeHtml(html);
      expect(result.findings.some((f) => f.code === "gsap_css_transition_conflict")).toBe(true);
    });
  });

  describe("canvas_missing_dimensions", () => {
    it("warns when <canvas> has no width / height attrs", async () => {
      const html = `${ROOT_OPEN}
        <canvas id="bg"></canvas>
      ${ROOT_CLOSE}`;
      const result = await lintHyperframeHtml(html);
      expect(result.findings.some((f) => f.code === "canvas_missing_dimensions")).toBe(true);
    });

    it("does not warn when width and height are set", async () => {
      const html = `${ROOT_OPEN}
        <canvas id="bg" width="1920" height="1080"></canvas>
      ${ROOT_CLOSE}`;
      const result = await lintHyperframeHtml(html);
      expect(result.findings.some((f) => f.code === "canvas_missing_dimensions")).toBe(false);
    });
  });

  describe("cross_project_asset_url", () => {
    it("warns when an asset URL references a different project hash", async () => {
      const html = `${ROOT_OPEN}
        <style>
          @font-face { font-family: 'X'; src: url('https://example.com/hyperframes-aaaaaaaa/captures/fonts/x.woff2'); }
        </style>
      ${ROOT_CLOSE}`;
      const result = await lintHyperframeHtml(html, {
        filePath: "/projects/hyperframes-bbbbbbbb/compositions/scene.html",
      });
      expect(result.findings.some((f) => f.code === "cross_project_asset_url")).toBe(true);
    });

    it("does not warn when the asset URL matches the current project hash", async () => {
      const html = `${ROOT_OPEN}
        <style>
          @font-face { font-family: 'X'; src: url('https://example.com/hyperframes-aaaaaaaa/captures/fonts/x.woff2'); }
        </style>
      ${ROOT_CLOSE}`;
      const result = await lintHyperframeHtml(html, {
        filePath: "/projects/hyperframes-aaaaaaaa/index.html",
      });
      expect(result.findings.some((f) => f.code === "cross_project_asset_url")).toBe(false);
    });
  });

  describe("invalid_absolute_url_prefix", () => {
    it('errors on an <img> with `src="../https://..."`', async () => {
      const html = `${ROOT_OPEN}
        <img src="../https://example.com/foo.png" alt="">
      ${ROOT_CLOSE}`;
      const result = await lintHyperframeHtml(html);
      const finding = result.findings.find((f) => f.code === "invalid_absolute_url_prefix");
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("error");
      expect(finding?.message).toContain("../https://example.com/foo.png");
      expect(finding?.message).toContain("Remove the `../` prefix");
    });

    it("errors on an @font-face src with multiple `../` segments", async () => {
      const html = `${ROOT_OPEN}
        <style>
          @font-face {
            font-family: 'Broken';
            src: url("../../https://cdn.example.com/foo.woff2") format("woff2");
          }
        </style>
      ${ROOT_CLOSE}`;
      const result = await lintHyperframeHtml(html);
      const finding = result.findings.find((f) => f.code === "invalid_absolute_url_prefix");
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("error");
      expect(finding?.message).toContain("../../https://cdn.example.com/foo.woff2");
    });

    it('errors on a <link href="../https://...">', async () => {
      const html = `${ROOT_OPEN}
        <link rel="stylesheet" href="../https://fonts.example.com/css?family=Inter">
      ${ROOT_CLOSE}`;
      const result = await lintHyperframeHtml(html);
      const finding = result.findings.find((f) => f.code === "invalid_absolute_url_prefix");
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("error");
    });

    it("does not fire on a legit relative image path", async () => {
      const html = `${ROOT_OPEN}
        <img src="../images/foo.png" alt="">
      ${ROOT_CLOSE}`;
      const result = await lintHyperframeHtml(html);
      expect(result.findings.some((f) => f.code === "invalid_absolute_url_prefix")).toBe(false);
    });

    it("does not fire on a clean absolute HTTPS URL", async () => {
      const html = `${ROOT_OPEN}
        <img src="https://cdn.example.com/foo.png" alt="">
        <style>
          @font-face {
            font-family: 'X';
            src: url('https://cdn.example.com/x.woff2') format('woff2');
          }
        </style>
      ${ROOT_CLOSE}`;
      const result = await lintHyperframeHtml(html);
      expect(result.findings.some((f) => f.code === "invalid_absolute_url_prefix")).toBe(false);
    });
  });

  describe("viewport_units_in_fixed_composition", () => {
    it("warns when CSS uses vw units in a fixed-size composition", async () => {
      const html = `${ROOT_OPEN}
        <style>
          .hero { font-size: 6vw; }
        </style>
        <h1 class="hero">Big</h1>
      ${ROOT_CLOSE}`;
      const result = await lintHyperframeHtml(html);
      expect(result.findings.some((f) => f.code === "viewport_units_in_fixed_composition")).toBe(
        true,
      );
    });
  });

  describe("z_index_without_position", () => {
    it("warns when z-index is set without a non-static position", async () => {
      const html = `${ROOT_OPEN}
        <style>
          .layer { z-index: 5; }
        </style>
        <div class="layer"></div>
      ${ROOT_CLOSE}`;
      const result = await lintHyperframeHtml(html);
      expect(result.findings.some((f) => f.code === "z_index_without_position")).toBe(true);
    });

    it("does not warn when position is relative", async () => {
      const html = `${ROOT_OPEN}
        <style>
          .layer { position: relative; z-index: 5; }
        </style>
        <div class="layer"></div>
      ${ROOT_CLOSE}`;
      const result = await lintHyperframeHtml(html);
      expect(result.findings.some((f) => f.code === "z_index_without_position")).toBe(false);
    });

    it("does not warn when position comes from a sibling class on the same element (FP fix)", async () => {
      // `#beat-1 { z-index: 2 }` carries no position, but the element ALSO
      // has `class="scene"` and `.scene { position: absolute }`. Selector-
      // keyed declMap can't unify those — the FP fix consults the tag's
      // other matching selectors and finds the non-static position.
      const html = `${ROOT_OPEN}
        <style>
          .scene { position: absolute; inset: 0; }
          #beat-1 { z-index: 2; }
        </style>
        <div id="beat-1" class="scene"></div>
      ${ROOT_CLOSE}`;
      const result = await lintHyperframeHtml(html);
      expect(result.findings.some((f) => f.code === "z_index_without_position")).toBe(false);
    });

    it("still warns when no selector covering the element supplies a non-static position (true positive)", async () => {
      // The element has TWO classes but neither rule sets a non-static
      // position anywhere — the warning must still fire so the regression
      // test of the FP-fix doesn't broaden coverage past intent.
      const html = `${ROOT_OPEN}
        <style>
          .panel { background: #fff; }
          .layered { z-index: 7; }
        </style>
        <div class="panel layered"></div>
      ${ROOT_CLOSE}`;
      const result = await lintHyperframeHtml(html);
      expect(result.findings.some((f) => f.code === "z_index_without_position")).toBe(true);
    });
  });

  describe("gap_on_absolute_children_container", () => {
    it("warns when a flex container with gap has only position:absolute children", async () => {
      const html = `${ROOT_OPEN}
        <style>
          .row { display: flex; gap: 20px; }
          .item { position: absolute; }
        </style>
        <div class="row">
          <div class="item">a</div>
          <div class="item">b</div>
        </div>
      ${ROOT_CLOSE}`;
      const result = await lintHyperframeHtml(html);
      expect(result.findings.some((f) => f.code === "gap_on_absolute_children_container")).toBe(
        true,
      );
    });

    it("does not warn when children are in flow", async () => {
      const html = `${ROOT_OPEN}
        <style>
          .row { display: flex; gap: 20px; }
        </style>
        <div class="row">
          <div>a</div>
          <div>b</div>
        </div>
      ${ROOT_CLOSE}`;
      const result = await lintHyperframeHtml(html);
      expect(result.findings.some((f) => f.code === "gap_on_absolute_children_container")).toBe(
        false,
      );
    });
  });

  describe("tl_from_opacity_no_initial_set", () => {
    it("warns at 3 fades with no defensive set (threshold lowered from 5)", async () => {
      const tlFromBlock = Array.from(
        { length: 3 },
        (_, i) => `tl.from('.el${i}', { opacity: 0, duration: 0.5 });`,
      ).join("\n");
      const html = `${ROOT_OPEN}
        <script>
          ${tlFromBlock}
        </script>
      ${ROOT_CLOSE}`;
      const result = await lintHyperframeHtml(html);
      expect(result.findings.some((f) => f.code === "tl_from_opacity_no_initial_set")).toBe(true);
    });

    it("warns when 6 fades exist and the only hidden CSS rule targets an unrelated overlay", async () => {
      // `.debug-overlay { opacity:0 }` is NOT one of the fade targets, so
      // it must not silence the FOUC rule.
      const tlFromBlock = Array.from(
        { length: 6 },
        (_, i) => `tl.from('.el${i}', { opacity: 0, duration: 0.5 });`,
      ).join("\n");
      const html = `${ROOT_OPEN}
        <style>
          .debug-overlay { opacity: 0; pointer-events: none; }
        </style>
        <div class="debug-overlay"></div>
        <script>
          ${tlFromBlock}
        </script>
      ${ROOT_CLOSE}`;
      const result = await lintHyperframeHtml(html);
      expect(result.findings.some((f) => f.code === "tl_from_opacity_no_initial_set")).toBe(true);
    });

    it("does not warn when CSS hidden default covers the fade targets", async () => {
      // `.hero { opacity: 0 }` covers all .hero{N} fades via a matching
      // base class — the FOUC risk is genuinely defended.
      const html = `${ROOT_OPEN}
        <style>
          .hero { opacity: 0; }
        </style>
        <div class="hero" id="h0"></div>
        <div class="hero" id="h1"></div>
        <div class="hero" id="h2"></div>
        <script>
          tl.from('.hero', { opacity: 0, duration: 0.5 });
          tl.from('.hero', { opacity: 0, duration: 0.5 });
          tl.from('.hero', { opacity: 0, duration: 0.5 });
          tl.from('.hero', { opacity: 0, duration: 0.5 });
          tl.from('.hero', { opacity: 0, duration: 0.5 });
          tl.from('.hero', { opacity: 0, duration: 0.5 });
        </script>
      ${ROOT_CLOSE}`;
      const result = await lintHyperframeHtml(html);
      expect(result.findings.some((f) => f.code === "tl_from_opacity_no_initial_set")).toBe(false);
    });

    it("does not warn when a defensive gsap.set is present", async () => {
      const tlFromBlock = Array.from(
        { length: 6 },
        (_, i) => `tl.from('.el${i}', { opacity: 0, duration: 0.5 });`,
      ).join("\n");
      const html = `${ROOT_OPEN}
        <script>
          gsap.set(['.el0','.el1','.el2','.el3','.el4','.el5'], { opacity: 0 });
          ${tlFromBlock}
        </script>
      ${ROOT_CLOSE}`;
      const result = await lintHyperframeHtml(html);
      expect(result.findings.some((f) => f.code === "tl_from_opacity_no_initial_set")).toBe(false);
    });
  });

  describe("img_missing_dimensions", () => {
    it("warns when 5+ imgs have no width/height", async () => {
      const imgs = Array.from({ length: 5 }, (_, i) => `<img src="x${i}.png">`).join("\n");
      const html = `${ROOT_OPEN}
        ${imgs}
      ${ROOT_CLOSE}`;
      const result = await lintHyperframeHtml(html);
      expect(result.findings.some((f) => f.code === "img_missing_dimensions")).toBe(true);
    });

    it("does not warn when imgs have dimensions", async () => {
      const imgs = Array.from(
        { length: 5 },
        (_, i) => `<img src="x${i}.png" width="100" height="100">`,
      ).join("\n");
      const html = `${ROOT_OPEN}
        ${imgs}
      ${ROOT_CLOSE}`;
      const result = await lintHyperframeHtml(html);
      expect(result.findings.some((f) => f.code === "img_missing_dimensions")).toBe(false);
    });
  });

  describe("overflow_hidden_clips_scaled_target", () => {
    it("warns when overflow:hidden ancestor contains a GSAP scale>1 target", async () => {
      const html = `${ROOT_OPEN}
        <style>
          .scene { overflow: hidden; }
        </style>
        <div class="scene">
          <div class="logo"></div>
        </div>
        <script>
          gsap.to('.logo', { scale: 1.5, duration: 1 });
        </script>
      ${ROOT_CLOSE}`;
      const result = await lintHyperframeHtml(html);
      expect(result.findings.some((f) => f.code === "overflow_hidden_clips_scaled_target")).toBe(
        true,
      );
    });

    it("does not warn when overflow is visible", async () => {
      const html = `${ROOT_OPEN}
        <style>
          .scene { overflow: visible; }
        </style>
        <div class="scene">
          <div class="logo"></div>
        </div>
        <script>
          gsap.to('.logo', { scale: 1.5, duration: 1 });
        </script>
      ${ROOT_CLOSE}`;
      const result = await lintHyperframeHtml(html);
      expect(result.findings.some((f) => f.code === "overflow_hidden_clips_scaled_target")).toBe(
        false,
      );
    });

    it("dedupes to the innermost overflow:hidden ancestor (FP fix A)", async () => {
      // Two nested overflow:hidden wrappers around the same scaled descendant.
      // Before the fix this triple-fired (outer + inner + any in between);
      // now only the innermost ancestor (the actual clipping surface) reports.
      const html = `${ROOT_OPEN}
        <style>
          .outer { overflow: hidden; }
          .inner { overflow: hidden; }
        </style>
        <div class="outer">
          <div class="inner">
            <div class="logo"></div>
          </div>
        </div>
        <script>
          gsap.to('.logo', { scale: 1.5, duration: 1 });
        </script>
      ${ROOT_CLOSE}`;
      const result = await lintHyperframeHtml(html);
      const hits = result.findings.filter((f) => f.code === "overflow_hidden_clips_scaled_target");
      expect(hits.length).toBe(1);
      expect(hits[0]?.message).toContain(".inner");
      expect(hits[0]?.message).not.toContain(".outer");
    });

    it("does not warn on full-bleed Ken Burns backgrounds (FP fix B)", async () => {
      // `position: absolute; inset: 0; object-fit: cover` with scale ≤ 1.2×
      // IS the Ken Burns effect — the clipping is intentional.
      const html = `${ROOT_OPEN}
        <style>
          .scene { overflow: hidden; }
          .kb-bg {
            position: absolute;
            inset: 0;
            object-fit: cover;
          }
        </style>
        <div class="scene">
          <img class="kb-bg" src="hero.jpg" width="1920" height="1080">
        </div>
        <script>
          gsap.to('.kb-bg', { scale: 1.15, duration: 8 });
        </script>
      ${ROOT_CLOSE}`;
      const result = await lintHyperframeHtml(html);
      expect(result.findings.some((f) => f.code === "overflow_hidden_clips_scaled_target")).toBe(
        false,
      );
    });

    it("still warns on aggressive scale even when the target looks full-bleed (true positive)", async () => {
      // Same shape as the Ken Burns suppression — `position: absolute; inset: 0;
      // object-fit: cover` — but scale 1.6× exceeds the 1.2× ceiling, so this
      // IS a real clipping bug.
      const html = `${ROOT_OPEN}
        <style>
          .scene { overflow: hidden; }
          .kb-bg {
            position: absolute;
            inset: 0;
            object-fit: cover;
          }
        </style>
        <div class="scene">
          <img class="kb-bg" src="hero.jpg" width="1920" height="1080">
        </div>
        <script>
          gsap.to('.kb-bg', { scale: 1.6, duration: 8 });
        </script>
      ${ROOT_CLOSE}`;
      const result = await lintHyperframeHtml(html);
      expect(result.findings.some((f) => f.code === "overflow_hidden_clips_scaled_target")).toBe(
        true,
      );
    });

    it("does not warn on a tiny logo whose scaled bbox stays well inside the host (FP fix C/D)", async () => {
      // 60px logo at scale 1.1 → 66px scaled, well inside 1920x1080 host.
      // Netflix-run shape: 10/10 firings were this exact pattern.
      const html = `${ROOT_OPEN}
        <style>
          .scene { overflow: hidden; }
          .logo { width: 60px; height: 60px; }
        </style>
        <div class="scene">
          <div class="logo"></div>
        </div>
        <script>
          gsap.to('.logo', { scale: 1.1, duration: 1 });
        </script>
      ${ROOT_CLOSE}`;
      const result = await lintHyperframeHtml(html);
      expect(result.findings.some((f) => f.code === "overflow_hidden_clips_scaled_target")).toBe(
        false,
      );
    });

    it("does not warn on a small radial-glow decorative element (FP fix D)", async () => {
      // 200px glow on a 1920x1080 root: base area = 40k, host area ≈ 2M →
      // < 30% → suppressed. Matches the second cohort of Netflix FPs.
      const html = `${ROOT_OPEN}
        <style>
          .scene { overflow: hidden; }
          .glow { width: 200px; height: 200px; }
        </style>
        <div class="scene">
          <div class="glow"></div>
        </div>
        <script>
          gsap.to('.glow', { scale: 1.4, duration: 2 });
        </script>
      ${ROOT_CLOSE}`;
      const result = await lintHyperframeHtml(html);
      expect(result.findings.some((f) => f.code === "overflow_hidden_clips_scaled_target")).toBe(
        false,
      );
    });

    it("does not warn on indeterminate-size target with gentle scale (FP fix E)", async () => {
      // No width/height anywhere → unknown size. Scale 1.1 ≤ 1.15 fallback
      // suppresses the warning (was firing for every scale>1 in the Netflix
      // run, regardless of whether the target had any size info).
      const html = `${ROOT_OPEN}
        <style>
          .scene { overflow: hidden; }
        </style>
        <div class="scene">
          <div class="logo"></div>
        </div>
        <script>
          gsap.to('.logo', { scale: 1.1, duration: 1 });
        </script>
      ${ROOT_CLOSE}`;
      const result = await lintHyperframeHtml(html);
      expect(result.findings.some((f) => f.code === "overflow_hidden_clips_scaled_target")).toBe(
        false,
      );
    });

    it("warns when a large element with explicit dims is scaled past the host edge (true positive)", async () => {
      // 1600px wide hero panel at scale 1.5 → 2400px > 1920 host → real clip.
      // Confirms the bbox guard doesn't suppress legitimate findings.
      const html = `${ROOT_OPEN}
        <style>
          .scene { overflow: hidden; }
          .hero { width: 1600px; height: 900px; }
        </style>
        <div class="scene">
          <div class="hero"></div>
        </div>
        <script>
          gsap.to('.hero', { scale: 1.5, duration: 1 });
        </script>
      ${ROOT_CLOSE}`;
      const result = await lintHyperframeHtml(html);
      expect(result.findings.some((f) => f.code === "overflow_hidden_clips_scaled_target")).toBe(
        true,
      );
    });
  });

  describe("open_close_frame_visibility", () => {
    it("warns when every entrance is hidden and first reveal lands past t=0.1s with no visible background", async () => {
      // Every element is hidden via CSS opacity:0; first reveal is at master
      // t=0.5s; body has no opaque background → black frame-00.
      const html = `<!DOCTYPE html><html><body>
        <div data-composition-id="main" data-width="1920" data-height="1080" data-start="0" data-duration="5">
          <style>
            .hero, .subtitle { opacity: 0; }
          </style>
          <h1 class="hero">Headline</h1>
          <p class="subtitle">Sub</p>
          <script>
            window.__timelines = window.__timelines || {};
            const tl = gsap.timeline({ paused: true });
            window.__timelines["main"] = tl;
            tl.to('.hero', { opacity: 1, duration: 0.5 }, 0.5);
            tl.to('.subtitle', { opacity: 1, duration: 0.5 }, 1.0);
          </script>
        </div>
      </body></html>`;
      const result = await lintHyperframeHtml(html);
      const finding = result.findings.find((f) => f.code === "open_close_frame_visibility");
      expect(finding).toBeDefined();
      expect(finding?.message).toContain("First frame");
    });

    it("does not warn when an opaque body background is visible at frame-00", async () => {
      // Same hidden hero, but body has an opaque background → frame-00 is
      // a coloured background, not black.
      const html = `<!DOCTYPE html><html><body>
        <div data-composition-id="main" data-width="1920" data-height="1080" data-start="0" data-duration="5">
          <style>
            body { background: #0c0c14; }
            .hero { opacity: 0; }
          </style>
          <h1 class="hero">Headline</h1>
          <script>
            window.__timelines = window.__timelines || {};
            const tl = gsap.timeline({ paused: true });
            window.__timelines["main"] = tl;
            tl.to('.hero', { opacity: 1, duration: 0.5 }, 0.5);
          </script>
        </div>
      </body></html>`;
      const result = await lintHyperframeHtml(html);
      const finding = result.findings.find((f) => f.code === "open_close_frame_visibility");
      expect(finding).toBeUndefined();
    });
  });

  describe("stat_counter_zero_state_window", () => {
    it("warns when 2+ zero-state counters cascade with staggered start times", async () => {
      // Three stats: $0, 0%, 0+ — each animated via a direct-selector
      // counter tween at staggered positions. The window between the first
      // counter landing and the others still reading 0 produces a broken
      // stat row.
      const html = `${ROOT_OPEN}
        <div class="stat-row">
          <span id="stat-revenue">$0</span>
          <span id="stat-conversion">0%</span>
          <span id="stat-users">0+</span>
        </div>
        <script>
          window.__timelines = window.__timelines || {};
          const tl = gsap.timeline({ paused: true });
          window.__timelines["main"] = tl;
          tl.to('#stat-revenue', {
            innerText: 1900,
            duration: 1.0,
            onUpdate: function () { this.targets()[0].textContent = '$' + Math.round(this.targets()[0].innerText) + 'T'; }
          }, 0);
          tl.to('#stat-conversion', {
            innerText: 42,
            duration: 1.0,
            onUpdate: function () { this.targets()[0].textContent = Math.round(this.targets()[0].innerText) + '%'; }
          }, 0.4);
          tl.to('#stat-users', {
            innerText: 1200,
            duration: 1.0,
            onUpdate: function () { this.targets()[0].textContent = Math.round(this.targets()[0].innerText) + '+'; }
          }, 0.8);
        </script>
      ${ROOT_CLOSE}`;
      const result = await lintHyperframeHtml(html);
      const finding = result.findings.find((f) => f.code === "stat_counter_zero_state_window");
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("warning");
    });

    it("does not warn when all counters start at the same anchor time", async () => {
      // Same three counters, but all anchored to position 0. There is no
      // window where one is ahead of another — the stat row is consistent.
      const html = `${ROOT_OPEN}
        <div class="stat-row">
          <span id="stat-revenue">$0</span>
          <span id="stat-conversion">0%</span>
          <span id="stat-users">0+</span>
        </div>
        <script>
          window.__timelines = window.__timelines || {};
          const tl = gsap.timeline({ paused: true });
          window.__timelines["main"] = tl;
          tl.to('#stat-revenue', {
            innerText: 1900, duration: 1.0,
            onUpdate: function () { this.targets()[0].textContent = '$' + Math.round(this.targets()[0].innerText) + 'T'; }
          }, 0);
          tl.to('#stat-conversion', {
            innerText: 42, duration: 1.0,
            onUpdate: function () { this.targets()[0].textContent = Math.round(this.targets()[0].innerText) + '%'; }
          }, 0);
          tl.to('#stat-users', {
            innerText: 1200, duration: 1.0,
            onUpdate: function () { this.targets()[0].textContent = Math.round(this.targets()[0].innerText) + '+'; }
          }, 0);
        </script>
      ${ROOT_CLOSE}`;
      const result = await lintHyperframeHtml(html);
      const finding = result.findings.find((f) => f.code === "stat_counter_zero_state_window");
      expect(finding).toBeUndefined();
    });
  });

  describe("id_selector_on_data_composition_wrapper", () => {
    it("errors when CSS #id targets a wrapper that only has data-composition-id (not id)", async () => {
      // Canonical Porsche bug: the split-screen wrapper carries
      // `data-composition-id="beat-1-heritage"` with no actual `id`
      // attribute, while CSS uses `#beat-1-heritage { display: flex }`.
      // The rule silently drops and the hero image falls off-screen.
      const html = `${ROOT_OPEN}
        <style>
          #beat-1-heritage { display: flex; align-items: center; justify-content: space-between; }
          #beat-1-heritage .hero-image { width: 50%; }
        </style>
        <div data-composition-id="beat-1-heritage" data-width="1920" data-height="1080" data-start="0">
          <div class="hero-image"></div>
        </div>
      ${ROOT_CLOSE}`;
      const result = await lintHyperframeHtml(html);
      const finding = result.findings.find(
        (f) => f.code === "id_selector_on_data_composition_wrapper",
      );
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("error");
      expect(finding?.selector).toBe("#beat-1-heritage");
    });

    it("does not warn when the wrapper has a real id attribute matching the selector", async () => {
      // Same composition shape — but the wrapper carries BOTH
      // `id="beat-1-heritage"` and `data-composition-id="beat-1-heritage"`,
      // so the `#beat-1-heritage` selector resolves normally.
      const html = `${ROOT_OPEN}
        <style>
          #beat-1-heritage { display: flex; }
        </style>
        <div id="beat-1-heritage" data-composition-id="beat-1-heritage" data-width="1920" data-height="1080" data-start="0">
          <div class="hero-image"></div>
        </div>
      ${ROOT_CLOSE}`;
      const result = await lintHyperframeHtml(html);
      expect(
        result.findings.some((f) => f.code === "id_selector_on_data_composition_wrapper"),
      ).toBe(false);
    });

    it("does not warn when CSS uses the [data-composition-id=...] attribute selector", async () => {
      // Same wrapper without an `id` attribute — but the CSS uses the
      // attribute selector form, so no ID lookup is required and the
      // declarations apply correctly.
      const html = `${ROOT_OPEN}
        <style>
          [data-composition-id="beat-1-heritage"] { display: flex; }
        </style>
        <div data-composition-id="beat-1-heritage" data-width="1920" data-height="1080" data-start="0">
          <div class="hero-image"></div>
        </div>
      ${ROOT_CLOSE}`;
      const result = await lintHyperframeHtml(html);
      expect(
        result.findings.some((f) => f.code === "id_selector_on_data_composition_wrapper"),
      ).toBe(false);
    });
  });

  describe("scene_crossfade_must_use_autoalpha", () => {
    it("warns when a scene fades in via opacity and is later deactivated via className flip without a paired opacity:0", async () => {
      // Canonical Porsche/Netflix bug: the beat fades in with
      // tl.fromTo({opacity:0}, {opacity:1}) and later flips className back
      // to 'scene' — but GSAP keeps the inline opacity:1 it pushed, so the
      // .scene{opacity:0} rule never wins. Beat-2 ends up covering beat-3+.
      const html = `${ROOT_OPEN}
        <style>
          .scene { opacity: 0; position: absolute; inset: 0; }
          .scene-active { opacity: 1; }
        </style>
        <div id="beat-2" class="scene"><h1>Beat Two</h1></div>
        <script>
          window.__timelines = window.__timelines || {};
          const tl = gsap.timeline({ paused: true });
          window.__timelines["main"] = tl;
          tl.fromTo('#beat-2', { opacity: 0 }, { opacity: 1, duration: 0.6 }, 5.0);
          tl.set('#beat-2', { className: 'scene' }, 10.0);
        </script>
      ${ROOT_CLOSE}`;
      const result = await lintHyperframeHtml(html);
      const finding = result.findings.find((f) => f.code === "scene_crossfade_must_use_autoalpha");
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("warning");
      expect(finding?.selector).toBe("#beat-2");
    });

    it("does not warn when the scene uses autoAlpha instead of opacity", async () => {
      // The recommended fix: autoAlpha sets visibility:hidden + opacity:0
      // atomically, so the deactivated scene cannot paint regardless of
      // inline-vs-CSS specificity.
      const html = `${ROOT_OPEN}
        <style>
          .scene { opacity: 0; position: absolute; inset: 0; }
        </style>
        <div id="beat-2" class="scene"><h1>Beat Two</h1></div>
        <script>
          window.__timelines = window.__timelines || {};
          const tl = gsap.timeline({ paused: true });
          window.__timelines["main"] = tl;
          tl.fromTo('#beat-2', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.6 }, 5.0);
          tl.set('#beat-2', { className: 'scene' }, 10.0);
        </script>
      ${ROOT_CLOSE}`;
      const result = await lintHyperframeHtml(html);
      expect(result.findings.some((f) => f.code === "scene_crossfade_must_use_autoalpha")).toBe(
        false,
      );
    });

    it("does not warn when the className kill is paired with an opacity:0 tween at the same instant", async () => {
      // Alternate fix: explicitly tween opacity to 0 at the same time the
      // className flips. GSAP clears the inline opacity, the .scene CSS rule
      // takes over, and the deactivated beat stops painting.
      const html = `${ROOT_OPEN}
        <style>
          .scene { opacity: 0; position: absolute; inset: 0; }
        </style>
        <div id="beat-2" class="scene"><h1>Beat Two</h1></div>
        <script>
          window.__timelines = window.__timelines || {};
          const tl = gsap.timeline({ paused: true });
          window.__timelines["main"] = tl;
          tl.fromTo('#beat-2', { opacity: 0 }, { opacity: 1, duration: 0.6 }, 5.0);
          tl.to('#beat-2', { opacity: 0, duration: 0 }, 10.0);
          tl.set('#beat-2', { className: 'scene' }, 10.0);
        </script>
      ${ROOT_CLOSE}`;
      const result = await lintHyperframeHtml(html);
      expect(result.findings.some((f) => f.code === "scene_crossfade_must_use_autoalpha")).toBe(
        false,
      );
    });

    it("does not warn when there is no className flip back to 'scene'", async () => {
      // No deactivation pattern at all — just a one-shot fade-in. Inline
      // opacity:1 persisting is intentional, not a bug.
      const html = `${ROOT_OPEN}
        <style>
          .scene { opacity: 0; position: absolute; inset: 0; }
        </style>
        <div id="beat-2" class="scene"><h1>Beat Two</h1></div>
        <script>
          window.__timelines = window.__timelines || {};
          const tl = gsap.timeline({ paused: true });
          window.__timelines["main"] = tl;
          tl.fromTo('#beat-2', { opacity: 0 }, { opacity: 1, duration: 0.6 }, 5.0);
        </script>
      ${ROOT_CLOSE}`;
      const result = await lintHyperframeHtml(html);
      expect(result.findings.some((f) => f.code === "scene_crossfade_must_use_autoalpha")).toBe(
        false,
      );
    });
  });

  describe("image_collapse_risk", () => {
    it("warns when an img with width:100%/height:auto sits inside a parent with visible background", async () => {
      // Amazon "white pill" — product-card has solid white background and
      // padding; the img has no aspect-ratio and collapses to 0px before
      // decode, leaving only the padded white surface visible.
      const html = `${ROOT_OPEN}
        <div class="product-card" style="background: white; padding: 24px;">
          <img src="https://example.com/foo.jpg" style="width: 100%; height: auto;" />
        </div>
      ${ROOT_CLOSE}`;
      const result = await lintHyperframeHtml(html);
      const finding = result.findings.find((f) => f.code === "image_collapse_risk");
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("warning");
    });

    it("does not warn when the img has an explicit aspect-ratio", async () => {
      const html = `${ROOT_OPEN}
        <div class="product-card" style="background: white; padding: 24px;">
          <img src="https://example.com/foo.jpg" style="width: 100%; height: auto; aspect-ratio: 4/3;" />
        </div>
      ${ROOT_CLOSE}`;
      const result = await lintHyperframeHtml(html);
      expect(result.findings.some((f) => f.code === "image_collapse_risk")).toBe(false);
    });

    it("does not warn when the img has an explicit pixel height", async () => {
      const html = `${ROOT_OPEN}
        <div class="product-card" style="background: white; padding: 24px;">
          <img src="https://example.com/foo.jpg" style="width: 100%; height: 200px;" />
        </div>
      ${ROOT_CLOSE}`;
      const result = await lintHyperframeHtml(html);
      expect(result.findings.some((f) => f.code === "image_collapse_risk")).toBe(false);
    });

    it("does not warn when the parent background is transparent", async () => {
      const html = `${ROOT_OPEN}
        <div class="product-card" style="background: transparent; padding: 24px;">
          <img src="https://example.com/foo.jpg" style="width: 100%; height: auto;" />
        </div>
      ${ROOT_CLOSE}`;
      const result = await lintHyperframeHtml(html);
      expect(result.findings.some((f) => f.code === "image_collapse_risk")).toBe(false);
    });
  });

  describe("opacity_zero_at_t0_with_no_immediate_tween", () => {
    it("warns when 3 elements are gsap.set opacity:0 and the earliest tween is at t=0.3", async () => {
      // Canonical empty-pre-roll bug: every visible element is hidden via
      // gsap.set and the first reveal lands at +0.3s. The snapshot tool
      // captures wrapper-only background at t=0.
      const html = `${ROOT_OPEN}
        <div class="logo">L</div>
        <h1 class="headline">Headline</h1>
        <a class="cta">Click</a>
        <script>
          gsap.set(['.logo', '.headline', '.cta'], { opacity: 0 });
          tl.to('.logo', { opacity: 1, duration: 0.4 }, 0.3);
          tl.to('.headline', { opacity: 1, duration: 0.4 }, 0.6);
          tl.to('.cta', { opacity: 1, duration: 0.4 }, 1.0);
        </script>
      ${ROOT_CLOSE}`;
      const result = await lintHyperframeHtml(html);
      const finding = result.findings.find(
        (f) => f.code === "opacity_zero_at_t0_with_no_immediate_tween",
      );
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("warning");
      expect(finding?.message).toContain("t=0.30s");
    });

    it("does not warn when one reveal tween fires at t=0 (immediate entrance)", async () => {
      // Same hidden-by-default machinery, but the logo reveal starts at
      // position 0 — the first frame paints the logo at full opacity.
      const html = `${ROOT_OPEN}
        <div class="logo">L</div>
        <h1 class="headline">Headline</h1>
        <a class="cta">Click</a>
        <script>
          gsap.set(['.logo', '.headline', '.cta'], { opacity: 0 });
          tl.to('.logo', { opacity: 1, duration: 0.4 }, 0);
          tl.to('.headline', { opacity: 1, duration: 0.4 }, 0.3);
          tl.to('.cta', { opacity: 1, duration: 0.4 }, 0.6);
        </script>
      ${ROOT_CLOSE}`;
      const result = await lintHyperframeHtml(html);
      expect(
        result.findings.some((f) => f.code === "opacity_zero_at_t0_with_no_immediate_tween"),
      ).toBe(false);
    });

    it("does not warn when only 1 of 3 elements is hidden (background stays visible)", async () => {
      // The background paints at t=0, so even though .headline and .cta
      // animate in late, the first frame is not empty.
      const html = `${ROOT_OPEN}
        <div class="background">BG</div>
        <h1 class="headline">Headline</h1>
        <a class="cta">Click</a>
        <script>
          gsap.set(['.headline', '.cta'], { opacity: 0 });
          tl.to('.headline', { opacity: 1, duration: 0.4 }, 0.3);
          tl.to('.cta', { opacity: 1, duration: 0.4 }, 0.6);
        </script>
      ${ROOT_CLOSE}`;
      const result = await lintHyperframeHtml(html);
      expect(
        result.findings.some((f) => f.code === "opacity_zero_at_t0_with_no_immediate_tween"),
      ).toBe(false);
    });
  });

  describe("fabricated_brand_svg", () => {
    // 200-char `d` path — fabricated brand mark shape (single-path, long
    // bezier blob). Real ChatGPT/OpenAI logo paths look nothing like this;
    // this is the kind of thing an agent invents when it can't load the
    // real sprite asset.
    const FABRICATED_D =
      "M100,10 C120,10 140,30 140,50 C140,70 120,90 100,90 C80,90 60,70 60,50 C60,30 80,10 100,10 Z " +
      "M100,30 C110,30 120,40 120,50 C120,60 110,70 100,70 C90,70 80,60 80,50 C80,40 90,30 100,30 Z";

    it('fires on an inline <svg class="chatgpt-logo"> with a 200-char single path at 120px', async () => {
      const html = `${ROOT_OPEN}
        <div class="brand-row">
          <svg class="chatgpt-logo" width="120" height="120" viewBox="0 0 200 200">
            <path d="${FABRICATED_D}" fill="#000" />
          </svg>
        </div>
      ${ROOT_CLOSE}`;
      const result = await lintHyperframeHtml(html);
      const finding = result.findings.find((f) => f.code === "fabricated_brand_svg");
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("warning");
      expect(finding?.message).toContain("fabricated brand mark");
      expect(finding?.message).toContain("chatgpt-logo");
    });

    it("does not fire on a small decorative icon with no brand-suggesting class", async () => {
      // Inline <svg> for a chevron / arrow / etc — `.chevron-right` carries
      // none of our brand tokens, so the rule must stay silent.
      const html = `${ROOT_OPEN}
        <svg class="chevron-right" width="24" height="24" viewBox="0 0 24 24">
          <path d="${FABRICATED_D}" fill="currentColor" />
        </svg>
      ${ROOT_CLOSE}`;
      const result = await lintHyperframeHtml(html);
      expect(result.findings.some((f) => f.code === "fabricated_brand_svg")).toBe(false);
    });

    it("does not fire when a captured logo asset is referenced elsewhere in the composition", async () => {
      // The composition has BOTH the suspicious inline svg AND a real
      // captured-asset reference. If the capture pipeline actually pulled
      // in a usable logo, we suppress the warning — the author wired up
      // assets correctly and the inline svg is most likely an unrelated icon.
      const html = `${ROOT_OPEN}
        <img src="captures/chatgpt-com/assets/svgs/openai-logo.svg" width="120" height="120" alt="OpenAI">
        <svg class="chatgpt-logo" width="120" height="120" viewBox="0 0 200 200">
          <path d="${FABRICATED_D}" fill="#000" />
        </svg>
      ${ROOT_CLOSE}`;
      const result = await lintHyperframeHtml(html);
      expect(result.findings.some((f) => f.code === "fabricated_brand_svg")).toBe(false);
    });

    it("does not fire when the svg class is brand-tokened but the svg is icon-sized (40px)", async () => {
      // `<svg class="brand-pill-icon" width="40" height="40">` is clearly a
      // UI ornament, not a brand mark. The size gate (>= 80px) suppresses.
      const html = `${ROOT_OPEN}
        <svg class="brand-pill-icon" width="40" height="40" viewBox="0 0 40 40">
          <path d="${FABRICATED_D}" fill="currentColor" />
        </svg>
      ${ROOT_CLOSE}`;
      const result = await lintHyperframeHtml(html);
      expect(result.findings.some((f) => f.code === "fabricated_brand_svg")).toBe(false);
    });

    it("does not fire when the svg uses an external sprite reference (<use href>)", async () => {
      // Even though the svg sits inside a `.logo` container and is large,
      // a `<use href="...">` indicates the author wired up the real sprite
      // (whether or not it resolves at runtime) — it's not a fabricated path.
      const html = `${ROOT_OPEN}
        <div class="logo">
          <svg width="120" height="120">
            <use href="/cdn/sprites-core-abc.svg#openai-mark"></use>
          </svg>
        </div>
      ${ROOT_CLOSE}`;
      const result = await lintHyperframeHtml(html);
      expect(result.findings.some((f) => f.code === "fabricated_brand_svg")).toBe(false);
    });

    it("does not fire on an svg with multiple paths (real logos almost always have 2+ subpaths)", async () => {
      // Two `<path>` siblings — multi-path svgs are typically real, hand-
      // assembled brand marks or imported from a vector editor. The
      // single-path heuristic is the load-bearing signal.
      const html = `${ROOT_OPEN}
        <div class="logo">
          <svg width="120" height="120" viewBox="0 0 200 200">
            <path d="${FABRICATED_D}" fill="#000" />
            <path d="${FABRICATED_D}" fill="#fff" />
          </svg>
        </div>
      ${ROOT_CLOSE}`;
      const result = await lintHyperframeHtml(html);
      expect(result.findings.some((f) => f.code === "fabricated_brand_svg")).toBe(false);
    });

    it("fires when the parent (not the svg) carries the brand-suggesting class", async () => {
      // Parent `<div class="brand-mark">` + inline single-path svg with no
      // class of its own. The heuristic should pick up the parent's class.
      const html = `${ROOT_OPEN}
        <div class="brand-mark">
          <svg width="120" height="120" viewBox="0 0 200 200">
            <path d="${FABRICATED_D}" fill="#000" />
          </svg>
        </div>
      ${ROOT_CLOSE}`;
      const result = await lintHyperframeHtml(html);
      expect(result.findings.some((f) => f.code === "fabricated_brand_svg")).toBe(true);
    });

    it("does not fire on classes that happen to contain the substring 'icon' (e.g. 'iconography-grid')", async () => {
      // Token-boundary check: `.iconography-grid` should NOT match `icon`.
      // This prevents an entire cohort of FPs on design-system / grid
      // class names.
      const html = `${ROOT_OPEN}
        <div class="iconography-grid">
          <svg width="120" height="120" viewBox="0 0 200 200">
            <path d="${FABRICATED_D}" fill="#000" />
          </svg>
        </div>
      ${ROOT_CLOSE}`;
      const result = await lintHyperframeHtml(html);
      expect(result.findings.some((f) => f.code === "fabricated_brand_svg")).toBe(false);
    });
  });
});
