import { describe, it, expect } from "vitest";
import { lintHyperframeHtml } from "../hyperframeLinter.js";

describe("caption rules", () => {
  it("warns when caption exit has no hard kill tl.set", () => {
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
    const result = lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "caption_exit_missing_hard_kill");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("warning");
  });

  it("does not warn when caption exit has hard kill tl.set", () => {
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
    const result = lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "caption_exit_missing_hard_kill");
    expect(finding).toBeUndefined();
  });

  it("warns when caption group has nowrap without max-width", () => {
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
    const result = lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "caption_text_overflow_risk");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("warning");
  });

  it("does not warn when caption group has nowrap with max-width", () => {
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
    const result = lintHyperframeHtml(html);
    const finding = result.findings.find(
      (f) => f.code === "caption_text_overflow_risk" && f.severity === "warning",
    );
    expect(finding).toBeUndefined();
  });

  it("warns when caption container uses position: relative", () => {
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
    const result = lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "caption_container_relative_position");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("warning");
  });
});
