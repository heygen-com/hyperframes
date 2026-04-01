import { describe, it, expect } from "vitest";
import { lintHyperframeHtml } from "../hyperframeLinter.js";

describe("adapter rules", () => {
  it("reports error when GSAP is used without a GSAP script tag", () => {
    const html = `
<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080"></div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.to("#box", { x: 100, duration: 1 }, 0);
    window.__timelines["main"] = tl;
  </script>
</body></html>`;
    const result = lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "missing_gsap_script");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
    expect(finding?.message).toContain("GSAP");
  });

  it("does not report missing_gsap_script when GSAP CDN script is present", () => {
    const html = `
<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080"></div>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.to("#box", { x: 100, duration: 1 }, 0);
    window.__timelines["main"] = tl;
  </script>
</body></html>`;
    const result = lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "missing_gsap_script");
    expect(finding).toBeUndefined();
  });

  it("reports error when Lottie container exists without a Lottie script tag", () => {
    const html = `
<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080">
    <div id="lottie-player" data-lottie-src="animation.json"></div>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    window.__timelines["main"] = gsap.timeline({ paused: true });
  </script>
</body></html>`;
    const result = lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "missing_lottie_script");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
    expect(finding?.message).toContain("Lottie");
  });

  it("reports error when lottie.loadAnimation is used without a Lottie script tag", () => {
    const html = `
<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080"></div>
  <script>
    window.__timelines = window.__timelines || {};
    window.__timelines["main"] = gsap.timeline({ paused: true });
    lottie.loadAnimation({ container: document.getElementById('lottie'), path: 'anim.json' });
  </script>
</body></html>`;
    const result = lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "missing_lottie_script");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
  });

  it("does not report missing_lottie_script when Lottie CDN script is present", () => {
    const html = `
<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080">
    <div id="lottie-player" data-lottie-src="animation.json"></div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/lottie-web@5/build/player/lottie.min.js"></script>
  <script>
    window.__timelines = window.__timelines || {};
    window.__timelines["main"] = gsap.timeline({ paused: true });
  </script>
</body></html>`;
    const result = lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "missing_lottie_script");
    expect(finding).toBeUndefined();
  });

  it("reports error when Three.js is used without a Three.js script tag", () => {
    const html = `
<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080"></div>
  <script>
    window.__timelines = window.__timelines || {};
    window.__timelines["main"] = gsap.timeline({ paused: true });
    const scene = new THREE.Scene();
    const renderer = new THREE.WebGLRenderer();
  </script>
</body></html>`;
    const result = lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "missing_three_script");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
    expect(finding?.message).toContain("Three.js");
  });

  it("does not report missing_three_script when Three.js CDN script is present", () => {
    const html = `
<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080"></div>
  <script src="https://cdn.jsdelivr.net/npm/three@0.160/build/three.min.js"></script>
  <script>
    window.__timelines = window.__timelines || {};
    window.__timelines["main"] = gsap.timeline({ paused: true });
    const scene = new THREE.Scene();
    const renderer = new THREE.WebGLRenderer();
  </script>
</body></html>`;
    const result = lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "missing_three_script");
    expect(finding).toBeUndefined();
  });

  it("does not report any adapter errors for composition with no adapter usage", () => {
    const html = `
<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080">
    <div id="content">Hello World</div>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    window.__timelines["main"] = { totalDuration: function() { return 3; } };
  </script>
</body></html>`;
    const result = lintHyperframeHtml(html);
    const adapterFindings = result.findings.filter((f) =>
      ["missing_gsap_script", "missing_lottie_script", "missing_three_script"].includes(f.code),
    );
    expect(adapterFindings).toHaveLength(0);
  });
});
