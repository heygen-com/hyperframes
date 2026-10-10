import { describe, it, expect } from "vitest";
import { lintHyperframeHtml } from "../hyperframeLinter.js";

describe("caption rules", () => {
  it("warns when caption exit has no hard kill tl.set", async () => {
    const html = `
<html><body>
  <div data-composition-id="captions" data-width="1920" data-height="1080">
    <div id="caption-container"></div>
    <script>
      window.__timelines = window.__timelines || {};
      var tl = gsap.timeline({ paused: true });
      GROUPS.forEach(function(group, gi) {
        var groupEl = document.createElement("div");
        groupEl.id = "cg-" + gi;
        tl.set(groupEl, { opacity: 1 }, group.start);
        tl.to(groupEl, { opacity: 0, duration: 0.12 }, group.end - 0.12);
      });
      window.__timelines["captions"] = tl;
    </script>
  </div>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "caption_exit_missing_hard_kill");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
  });

  it("does not warn when caption exit has hard kill tl.set", async () => {
    const html = `
<html><body>
  <div data-composition-id="captions" data-width="1920" data-height="1080">
    <div id="caption-container"></div>
    <script>
      window.__timelines = window.__timelines || {};
      var tl = gsap.timeline({ paused: true });
      GROUPS.forEach(function(group, gi) {
        var groupEl = document.createElement("div");
        groupEl.id = "cg-" + gi;
        tl.set(groupEl, { opacity: 1 }, group.start);
        tl.to(groupEl, { opacity: 0, duration: 0.12 }, group.end - 0.12);
        tl.set(groupEl, { opacity: 0, visibility: "hidden" }, group.end);
      });
      window.__timelines["captions"] = tl;
    </script>
  </div>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "caption_exit_missing_hard_kill");
    expect(finding).toBeUndefined();
  });

  it("does not warn for generic GSAP opacity exits in non-caption loops", async () => {
    const html = `
<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080">
    <script>
      window.__timelines = window.__timelines || {};
      var tl = gsap.timeline({ paused: true });
      var sceneCaption = document.querySelector("#scene-caption");
      CARDS.forEach(function(group, gi) {
        var groupEl = document.createElement("div");
        groupEl.id = "card-" + gi;
        tl.to(groupEl, { opacity: 0, duration: 0.12 }, 2);
      });
      window.__timelines["main"] = tl;
    </script>
  </div>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "caption_exit_missing_hard_kill");
    expect(finding).toBeUndefined();
  });

  it("does not warn on a content frame that only mentions karaoke in a comment", async () => {
    const html = `<template id="06-one-platform-template">
  <div id="root" data-composition-id="06-one-platform" data-width="1920" data-height="1080">
    <script>
      window.__timelines = window.__timelines || {};
      var tl = gsap.timeline({ paused: true });
      // "Minutes, not weeks" lands with a karaoke-style keyword glow
      SCREENS.forEach(function (s, i) {
        var el = document.getElementById("screen-" + i);
        tl.to(el, { y: -40, opacity: 0, duration: 0.3 }, i * 1.3);
      });
      window.__timelines["06-one-platform"] = tl;
    </script>
  </div>
</template>`;
    const result = await lintHyperframeHtml(html, { isSubComposition: true });
    const finding = result.findings.find((f) => f.code === "caption_exit_missing_hard_kill");
    expect(finding).toBeUndefined();
  });

  it("warns when caption group has nowrap without max-width", async () => {
    const html = `
<html><body>
  <div data-composition-id="captions" data-width="1920" data-height="1080">
    <style>
      .caption-group {
        position: absolute;
        white-space: nowrap;
        text-align: center;
      }
    </style>
    <script>
      window.__timelines = window.__timelines || {};
      var tl = gsap.timeline({ paused: true });
      window.__timelines["captions"] = tl;
    </script>
  </div>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "caption_text_overflow_risk");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("warning");
  });

  it("does not warn when caption group has nowrap with max-width", async () => {
    const html = `
<html><body>
  <div data-composition-id="captions" data-width="1920" data-height="1080">
    <style>
      .caption-group {
        position: absolute;
        white-space: nowrap;
        max-width: 1600px;
        overflow: hidden;
      }
    </style>
    <script>
      window.__timelines = window.__timelines || {};
      var tl = gsap.timeline({ paused: true });
      window.__timelines["captions"] = tl;
    </script>
  </div>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find(
      (f) => f.code === "caption_text_overflow_risk" && f.severity === "warning",
    );
    expect(finding).toBeUndefined();
  });

  it("warns when caption container uses position: relative", async () => {
    const html = `
<html><body>
  <div data-composition-id="captions" data-width="1920" data-height="1080">
    <style>
      .caption-group {
        position: relative;
      }
    </style>
    <script>
      window.__timelines = window.__timelines || {};
      var tl = gsap.timeline({ paused: true });
      window.__timelines["captions"] = tl;
    </script>
  </div>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "caption_container_relative_position");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
  });

  describe("caption_text_overflow_risk — its fix must not create an error", () => {
    const cap = (css: string) => `
<html><body>
  <div data-composition-id="captions" data-width="1920" data-height="1080">
    <style>.caption-group{${css}}</style><div class="caption-group"></div>
  </div>
  <script>
    const tl = gsap.timeline({ paused: true });
    words.forEach((w) => tl.to(w, { scale: 1.3 }));
    window.__timelines = { captions: tl };
  </script>
</body></html>`;

    it("clears when the fixHint is applied as written", async () => {
      // The hint used to say "and overflow: hidden", which is exactly what
      // caption_overflow_clips_scaled_words errors on. Following the warning
      // produced an error.
      const before = await lintHyperframeHtml(cap("position:absolute;white-space:nowrap"));
      expect(before.findings.find((f) => f.code === "caption_text_overflow_risk")).toBeDefined();

      const after = await lintHyperframeHtml(
        cap("position:absolute;white-space:nowrap;max-width:1600px;overflow:visible"),
      );
      const blocking = after.findings.filter((f) => f.severity !== "info");
      expect(blocking.map((f) => f.code)).not.toContain("caption_text_overflow_risk");
      expect(blocking.map((f) => f.code)).not.toContain("caption_overflow_clips_scaled_words");
    });
  });

  describe("caption_transcript_not_inline", () => {
    const captions = (script: string) => `
<html><body>
  <div data-composition-id="captions" data-width="1920" data-height="1080">
    <style>
      .caption-group { position: absolute; }
      .caption-word { display: inline-block; }
    </style>
    <div id="caption-stage"></div>
    <script>
      window.__timelines = window.__timelines || {};
      var tl = gsap.timeline({ paused: true });
      ${script}
      window.__timelines["captions"] = tl;
    </script>
  </div>
</body></html>`;

    const FETCHED = `
      fetch("/assets/transcript.json").then(function (res) {
        return res.json();
      }).then(function (groups) {
        groups.forEach(function (group, groupIndex) {
          var groupEl = document.getElementById("caption-group-" + groupIndex);
          tl.set(groupEl, { opacity: 1 }, group.start);
        });
      });`;

    const INLINE = `
      var TRANSCRIPT = [{ "text": "Every", "start": 0, "end": 0.3 }];
      TRANSCRIPT.forEach(function (word, wordIndex) {
        var wordEl = document.getElementById("caption-word-0-" + wordIndex);
        tl.set(wordEl, { opacity: 1 }, word.start);
      });`;

    it("errors when the transcript is fetched instead of inlined", async () => {
      const { findings } = await lintHyperframeHtml(captions(FETCHED));
      const finding = findings.find((f) => f.code === "caption_transcript_not_inline");
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("error");
    });

    it("does not error when the transcript is inline", async () => {
      const { findings } = await lintHyperframeHtml(captions(INLINE));
      expect(findings.find((f) => f.code === "caption_transcript_not_inline")).toBeUndefined();
    });

    it("does not error when an inline transcript sits alongside a fetch", async () => {
      // The studio editor only needs the inline array to exist; fetching more on
      // top of it is not the failure this rule is about.
      const { findings } = await lintHyperframeHtml(captions(INLINE + FETCHED));
      expect(findings.find((f) => f.code === "caption_transcript_not_inline")).toBeUndefined();
    });

    it("does not error for a non-caption composition that fetches a transcript", async () => {
      const html = `
<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080">
    <style>.headline { position: absolute; }</style>
    <script>
      window.__timelines = window.__timelines || {};
      var tl = gsap.timeline({ paused: true });
      fetch("/assets/transcript.json");
      window.__timelines["main"] = tl;
    </script>
  </div>
</body></html>`;
      const { findings } = await lintHyperframeHtml(html);
      expect(findings.find((f) => f.code === "caption_transcript_not_inline")).toBeUndefined();
    });
  });

  describe("caption_textshadow_on_group_container", () => {
    const captions = (tween: string) => `
<html><body>
  <div data-composition-id="captions" data-width="1920" data-height="1080">
    <style>
      .caption-group { position: absolute; }
      .caption-word { display: inline-block; }
    </style>
    <div id="caption-stage"></div>
    <script>
      window.__timelines = window.__timelines || {};
      var tl = gsap.timeline({ paused: true });
      GROUPS.forEach(function (group, groupIndex) {
        var groupEl = document.getElementById("caption-group-" + groupIndex);
        var wordEl = document.getElementById("caption-word-" + groupIndex + "-0");
        ${tween}
      });
      window.__timelines["captions"] = tl;
    </script>
  </div>
</body></html>`;

    it("warns when textShadow is tweened on the group element", async () => {
      const { findings } = await lintHyperframeHtml(
        captions(`tl.to(groupEl, { textShadow: "0 0 24px #0ff", duration: 0.2 }, group.start);`),
      );
      const finding = findings.find((f) => f.code === "caption_textshadow_on_group_container");
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("warning");
    });

    it("warns when textShadow is tweened on a group selector", async () => {
      const { findings } = await lintHyperframeHtml(
        captions(
          `tl.to(".caption-group", { textShadow: "0 0 24px #0ff", duration: 0.2 }, group.start);`,
        ),
      );
      const finding = findings.find((f) => f.code === "caption_textshadow_on_group_container");
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("warning");
    });

    it("does not warn when textShadow is tweened on the active word", async () => {
      const { findings } = await lintHyperframeHtml(
        captions(`tl.to(wordEl, { textShadow: "0 0 24px #0ff", duration: 0.2 }, group.start);`),
      );
      expect(
        findings.find((f) => f.code === "caption_textshadow_on_group_container"),
      ).toBeUndefined();
    });

    it("does not warn when the group is tweened without textShadow", async () => {
      // The fixHint sends you to scale on the group, so scale must stay clean.
      const { findings } = await lintHyperframeHtml(
        captions(`tl.to(groupEl, { scale: 1.08, duration: 0.2 }, group.start);`),
      );
      expect(
        findings.find((f) => f.code === "caption_textshadow_on_group_container"),
      ).toBeUndefined();
    });
  });

  describe("caption_fittext_scale_mismatch", () => {
    const captions = (maxWidth: number, scale: string) => `
<html><body>
  <div data-composition-id="captions" data-width="1920" data-height="1080">
    <style>.caption-group { position: absolute; }</style>
    <div id="caption-stage"></div>
    <script>
      window.__timelines = window.__timelines || {};
      var tl = gsap.timeline({ paused: true });
      GROUPS.forEach(function (group, groupIndex) {
        var fit = window.__hyperframes.fitTextFontSize(group.text, { maxWidth: ${maxWidth}, fontWeight: 900, fontFamily: "Outfit" });
        var wordEl = document.getElementById("caption-word-" + groupIndex + "-0");
        wordEl.style.fontSize = fit.fontSize + "px";
        tl.to(wordEl, { scale: ${scale}, duration: 0.2 }, group.start);
      });
      window.__timelines["captions"] = tl;
    </script>
  </div>
</body></html>`;

    it("warns when maxWidth times the largest word scale overflows the frame", async () => {
      const { findings } = await lintHyperframeHtml(captions(1600, "1.3"));
      const finding = findings.find((f) => f.code === "caption_fittext_scale_mismatch");
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("warning");
      // 1600 * 1.3 = 2080, and the hint's headroom figure is floor(1700 / 1.3).
      expect(finding?.message).toContain("2080px");
      expect(finding?.fixHint).toContain("1307px");
    });

    it("clears when the maxWidth from the fixHint is applied as written", async () => {
      const { findings } = await lintHyperframeHtml(captions(1307, "1.3"));
      expect(findings.find((f) => f.code === "caption_fittext_scale_mismatch")).toBeUndefined();
    });

    it("does not warn when the scaled width stays inside the frame", async () => {
      const { findings } = await lintHyperframeHtml(captions(1600, "1.05"));
      expect(findings.find((f) => f.code === "caption_fittext_scale_mismatch")).toBeUndefined();
    });

    it("does not warn for a scaled headline outside a caption context", async () => {
      const html = `
<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080">
    <style>.headline { position: absolute; }</style>
    <div id="headline"></div>
    <script>
      window.__timelines = window.__timelines || {};
      var tl = gsap.timeline({ paused: true });
      var headlineEl = document.getElementById("headline");
      var fit = window.__hyperframes.fitTextFontSize(TITLE, { maxWidth: 1600, fontWeight: 900, fontFamily: "Outfit" });
      headlineEl.style.fontSize = fit.fontSize + "px";
      tl.to(headlineEl, { scale: 1.3, duration: 0.2 }, 0);
      window.__timelines["main"] = tl;
    </script>
  </div>
</body></html>`;
      const { findings } = await lintHyperframeHtml(html);
      expect(findings.find((f) => f.code === "caption_fittext_scale_mismatch")).toBeUndefined();
    });
  });
});
