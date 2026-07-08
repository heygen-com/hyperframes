// fallow-ignore-file code-duplication
import { describe, it, expect } from "vitest";
import { lintHyperframeHtml } from "../hyperframeLinter.js";

const ANIME_CODES = new Set([
  "animejs_script_not_registered",
  "animejs_autoplay_not_disabled",
  "animejs_infinite_loop_missing_duration",
]);

function animeComposition(scriptContent: string, rootAttrs = ""): string {
  return `
<html>
  <head>
    <script src="https://cdn.jsdelivr.net/npm/animejs@4/lib/anime.umd.min.js"></script>
  </head>
  <body>
    <div data-composition-id="main" data-width="1920" data-height="1080" ${rootAttrs}>
      <div id="box">Hello</div>
    </div>
    <script>
${scriptContent}
    </script>
  </body>
</html>`;
}

describe("anime.js rules", () => {
  it("allows a registered finite anime scaffold without anime diagnostics", async () => {
    const html = animeComposition(`
      const tl = anime.createTimeline({ autoplay: false });
      tl.add("#box", { opacity: [0, 1], duration: 1000 });
      hyperframesAnime.register("main", tl, { labels: { intro: 0 } });
    `);

    const result = await lintHyperframeHtml(html);
    expect(result.findings.filter((finding) => ANIME_CODES.has(finding.code))).toHaveLength(0);
    expect(
      result.findings.find((finding) => finding.code === "missing_timeline_registry"),
    ).toBeUndefined();
    expect(
      result.findings.find(
        (finding) => finding.code === "root_composition_missing_duration_source",
      ),
    ).toBeUndefined();
  });

  it("warns when createTimeline explicitly enables autoplay", async () => {
    const html = animeComposition(`
      const tl = anime.createTimeline({ autoplay: true });
      hyperframesAnime.register("main", tl, { labels: {} });
    `);

    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find(
      (candidate) => candidate.code === "animejs_autoplay_not_disabled",
    );
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("warning");
  });

  it("warns when createTimeline omits autoplay", async () => {
    const html = animeComposition(`
      const tl = anime.createTimeline({});
      hyperframesAnime.register("main", tl, { labels: {} });
    `);

    const result = await lintHyperframeHtml(html);
    expect(
      result.findings.find((finding) => finding.code === "animejs_autoplay_not_disabled"),
    ).toBeDefined();
  });

  it("does not warn when createTimeline disables autoplay", async () => {
    const html = animeComposition(`
      const tl = anime.createTimeline({ autoplay: false });
      hyperframesAnime.register("main", tl, { labels: {} });
    `);

    const result = await lintHyperframeHtml(html);
    expect(
      result.findings.find((finding) => finding.code === "animejs_autoplay_not_disabled"),
    ).toBeUndefined();
  });

  it("errors when anime is used but never registered", async () => {
    const html = animeComposition(`
      const tl = anime.createTimeline({ autoplay: false });
      tl.add("#box", { opacity: [0, 1], duration: 1000 });
    `);

    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find(
      (candidate) => candidate.code === "animejs_script_not_registered",
    );
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
  });

  it("does not error when anime is registered", async () => {
    const html = animeComposition(`
      const tl = anime.createTimeline({ autoplay: false });
      hyperframesAnime.register("main", tl, { labels: {} });
    `);

    const result = await lintHyperframeHtml(html);
    expect(
      result.findings.find((finding) => finding.code === "animejs_script_not_registered"),
    ).toBeUndefined();
  });

  it("treats window.__hfAnime.push as a registered anime instance", async () => {
    const html = animeComposition(`
      const tl = anime.createTimeline({ autoplay: false });
      window.__hfAnime = window.__hfAnime || [];
      window.__hfAnime.push({ id: "main", instance: tl, labels: {} });
    `);

    const result = await lintHyperframeHtml(html);
    expect(
      result.findings.find((finding) => finding.code === "missing_timeline_registry"),
    ).toBeUndefined();
    expect(
      result.findings.find((finding) => finding.code === "animejs_script_not_registered"),
    ).toBeUndefined();
    expect(
      result.findings.find(
        (finding) => finding.code === "root_composition_missing_duration_source",
      ),
    ).toBeUndefined();
  });

  it("errors when an infinite anime loop has no root data-duration", async () => {
    const html = animeComposition(`
      const tl = anime.createTimeline({ autoplay: false, loop: true });
      hyperframesAnime.register("main", tl, { labels: {} });
    `);

    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find(
      (candidate) => candidate.code === "animejs_infinite_loop_missing_duration",
    );
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
  });

  it("does not error when an infinite anime loop has root data-duration", async () => {
    const html = animeComposition(
      `
      const tl = anime.createTimeline({ autoplay: false, loop: true });
      hyperframesAnime.register("main", tl, { labels: {} });
    `,
      'data-duration="5"',
    );

    const result = await lintHyperframeHtml(html);
    expect(
      result.findings.find((finding) => finding.code === "animejs_infinite_loop_missing_duration"),
    ).toBeUndefined();
  });

  it("does not report anime diagnostics for a GSAP-only composition", async () => {
    const html = `
<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080"></div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    window.__timelines["main"] = tl;
  </script>
</body></html>`;

    const result = await lintHyperframeHtml(html);
    expect(result.findings.filter((finding) => ANIME_CODES.has(finding.code))).toHaveLength(0);
  });

  it("does not report anime diagnostics for a no-timeline static composition", async () => {
    const html = `
<html><body>
  <div data-composition-id="main" data-no-timeline data-duration="3" data-width="1920" data-height="1080"></div>
</body></html>`;

    const result = await lintHyperframeHtml(html);
    expect(result.findings.filter((finding) => ANIME_CODES.has(finding.code))).toHaveLength(0);
  });
});
