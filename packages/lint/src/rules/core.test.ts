import { describe, it, expect } from "vitest";
import { lintHyperframeHtml } from "../hyperframeLinter.js";

function compositionWithHead(headContent: string): string {
  return `
<html>
<head>
${headContent}
</head>
<body>
  <div data-composition-id="c1" data-width="1920" data-height="1080"></div>
  <script>window.__timelines = {};</script>
</body>
</html>`;
}

function compositionWithHeadBoundary(boundaryContent: string): string {
  return `
<html>
<head>
  <style>
    body { margin: 0; }
  </style>
</head>
${boundaryContent}
<body>
  <div data-composition-id="c1" data-width="1920" data-height="1080"></div>
  <script>window.__timelines = {};</script>
</body>
</html>`;
}

function compositionWithBodyPrefix(prefixContent: string, rootContent = ""): string {
  return `
<html>
<head>
  <style>
    body { margin: 0; }
  </style>
</head>
<body>
${prefixContent}
  <div data-composition-id="c1" data-width="1920" data-height="1080">
${rootContent}
  </div>
  <script>window.__timelines = {};</script>
</body>
</html>`;
}

function compositionWithImplicitBodyPrefix(prefixContent: string): string {
  return `
<html>
<head>
  <style>
    body { margin: 0; }
  </style>
</head>
${prefixContent}
<div data-composition-id="c1" data-width="1920" data-height="1080"></div>
<script>window.__timelines = {};</script>
</html>`;
}

function templateCompositionWithHead(headContent: string): string {
  return `
<template>
  <html>
    <head>
${headContent}
    </head>
    <body>
      <div data-composition-id="c1" data-width="1920" data-height="1080"></div>
    </body>
  </html>
</template>`;
}

describe("core rules", () => {
  it("reports error when root is missing data-composition-id", async () => {
    const html = `
<html><body>
  <div id="root" data-width="1920" data-height="1080"></div>
  <script>window.__timelines = {};</script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "root_missing_composition_id");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
  });

  it("reports error when root is missing data-width or data-height", async () => {
    const html = `
<html><body>
  <div id="root" data-composition-id="c1"></div>
  <script>window.__timelines = {};</script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "root_missing_dimensions");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
  });

  it("accepts body as the composition root", async () => {
    const html = `
<html><body data-composition-id="c1" data-width="1920" data-height="1080">
  <div id="overlay-flash"></div>
  <script>window.__timelines = window.__timelines || {};</script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    expect(result.findings.find((f) => f.code === "root_missing_composition_id")).toBeUndefined();
    expect(result.findings.find((f) => f.code === "root_missing_dimensions")).toBeUndefined();
  });

  it("reports error when timeline registry is missing", async () => {
    const html = `
<html><body>
  <div id="root" data-composition-id="c1" data-width="1920" data-height="1080"></div>
  <script>
    const tl = gsap.timeline({ paused: true });
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "missing_timeline_registry");
    expect(finding).toBeDefined();
  });

  it("does not flag missing_timeline_registry on a sub-composition (inherits from host)", async () => {
    const html = `
<html><body>
  <div id="root" data-composition-id="c1" data-width="1920" data-height="1080"></div>
  <script>
    const tl = gsap.timeline({ paused: true });
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html, { isSubComposition: true });
    const finding = result.findings.find((f) => f.code === "missing_timeline_registry");
    expect(finding).toBeUndefined();
  });

  it("reports error for composition host missing data-composition-id", async () => {
    const html = `
<html><body>
  <div id="root" data-composition-id="c1" data-width="1920" data-height="1080">
    <div id="host1" data-composition-src="child.html"></div>
  </div>
  <script>window.__timelines = {};</script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "host_missing_composition_id");
    expect(finding).toBeDefined();
  });

  it("reports error when timeline registry is assigned without initializing", async () => {
    const html = `
<html><body>
  <div id="root" data-composition-id="c1" data-width="1920" data-height="1080">
    <div id="stage"></div>
  </div>
  <script>
    const tl = gsap.timeline({ paused: true });
    tl.to("#stage", { opacity: 1, duration: 1 }, 0);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "timeline_registry_missing_init");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
    expect(finding?.message).toContain("without initializing");
  });

  it("reports error when dot timeline registry is assigned without initializing", async () => {
    const html = `
<html><body>
  <div id="root" data-composition-id="c1" data-width="1920" data-height="1080">
    <div id="stage"></div>
  </div>
  <script>
    const tl = gsap.timeline({ paused: true });
    tl.to("#stage", { opacity: 1, duration: 1 }, 0);
    window.__timelines.c1 = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "timeline_registry_missing_init");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
  });

  it("does not flag timeline assignment when init guard is present", async () => {
    const validComposition = `
<html>
<body>
  <div id="root" data-composition-id="comp-1" data-width="1920" data-height="1080">
    <div id="stage"></div>
  </div>
  <script src="https://cdn.gsap.com/gsap.min.js"></script>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.to("#stage", { opacity: 1, duration: 1 }, 0);
    window.__timelines["comp-1"] = tl;
  </script>
</body>
</html>`;
    const result = await lintHyperframeHtml(validComposition);
    const finding = result.findings.find((f) => f.code === "timeline_registry_missing_init");
    expect(finding).toBeUndefined();
  });

  it("reports error when CSS text is left outside a style block in the document head", async () => {
    const html = compositionWithHead(`
  <style>
    body { margin: 0; }
  </style>
  </style>
  /* Decorative Elements */
  .particle {
    position: absolute;
    width: 4px;
    height: 4px;
    background: #fff;
  }
`);
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "head_leaked_text");

    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
    expect(finding?.message).toContain("<head>");
    expect(finding?.snippet).toContain(".particle");
  });

  it("reports error when CSS variables leak between head and body", async () => {
    const html = compositionWithHeadBoundary(`
  --bg-color: #F5F1E8;
  --text-color: #212121;
}

body {
  background-color: var(--bg-color);
  color: var(--text-color);
}
`);
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "head_leaked_text");

    expect(finding).toBeDefined();
    expect(finding?.message).toContain("<head>");
    expect(finding?.snippet).toContain("body");
  });

  it("reports error when stray close tags leak between head and body", async () => {
    const html = compositionWithHeadBoundary(`
  </style>
  </script>
`);
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "head_leaked_text");

    expect(finding).toBeDefined();
    expect(finding?.snippet).toContain("</style>");
  });

  it("reports error when markdown code fences leak between head and body", async () => {
    const html = compositionWithHeadBoundary(`
  \`\`\`css
  .particle {
    color: white;
  }
  \`\`\`
`);
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "head_leaked_text");

    expect(finding).toBeDefined();
    expect(finding?.snippet).toContain("```css");
  });

  it("reports error when CSS at-rules leak between head and body", async () => {
    const html = compositionWithHeadBoundary(`
  @media (min-width: 800px) {
    .particle {
      transform: scale(1.2);
    }
  }
`);
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "head_leaked_text");

    expect(finding).toBeDefined();
    expect(finding?.snippet).toContain("@media");
  });

  it("does not report leaked text for valid script and style blocks around the head boundary", async () => {
    const html = compositionWithHeadBoundary(`
  <script>
    window.__headReady = true;
  </script>
  <template>
    <style>
      .template-only { color: red; }
    </style>
  </template>
`);
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "head_leaked_text");

    expect(finding).toBeUndefined();
  });

  it("reports error when CSS text leaks before the composition root", async () => {
    const html = compositionWithBodyPrefix(`
  .orphan {
    position: absolute;
    inset: 0;
  }
`);
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "head_leaked_text");

    expect(finding).toBeDefined();
    expect(finding?.snippet).toContain(".orphan");
  });

  it("reports error when CSS text leaks before the composition root without an explicit body", async () => {
    const html = compositionWithImplicitBodyPrefix(`
  .implicit-body-orphan {
    position: absolute;
    inset: 0;
  }
`);
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "head_leaked_text");

    expect(finding).toBeDefined();
    expect(finding?.snippet).toContain(".implicit-body-orphan");
  });

  it("does not report leaked text for valid script and style blocks before the composition root", async () => {
    const html = compositionWithBodyPrefix(`
  <style>
    .pre-root-helper { color: red; }
  </style>
  <script>
    window.__preRootReady = true;
  </script>
`);
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "head_leaked_text");

    expect(finding).toBeUndefined();
  });

  it("does not report CSS-looking educational text inside the composition root", async () => {
    const html = compositionWithBodyPrefix(
      "",
      `
    <pre>
      body {
        margin: 0;
      }
    </pre>
`,
    );
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "head_leaked_text");

    expect(finding).toBeUndefined();
  });

  it("reports error when a stray style close tag is left in the document head", async () => {
    const html = compositionWithHead(`
  <style>
    body { margin: 0; }
  </style>
  </style>
`);
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "head_leaked_text");

    expect(finding).toBeDefined();
    expect(finding?.snippet).toContain("</style>");
  });

  it("reports error when a stray script close tag is left in the document head", async () => {
    const html = compositionWithHead(`
  <script>
    window.__headReady = true;
  </script>
  </script>
`);
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "head_leaked_text");

    expect(finding).toBeDefined();
    expect(finding?.snippet).toContain("</script>");
  });

  it("does not report leaked head text for valid closing tags with trailing whitespace", async () => {
    const html = compositionWithHead(`
  <style>
    body { margin: 0; }
  </style data-parser-error-close>
  <script>
    window.__headReady = true;
  </script
    data-parser-error-close>
  <title>Particle Field</title	>
`);
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "head_leaked_text");

    expect(finding).toBeUndefined();
  });

  it("reports error when markdown code fences leak into the document head", async () => {
    const withLanguage = compositionWithHead(`
  \`\`\`css
  .particle {
    position: absolute;
  }
  \`\`\`
`);
    const withoutLanguage = compositionWithHead(`
  \`\`\`
  .particle {
    position: absolute;
  }
  \`\`\`
`);
    const withTsxLanguage = compositionWithHead(`
  \`\`\`tsx
  export function Particle() {
    return <div className="particle" />;
  }
  \`\`\`
`);
    const withLanguageResult = await lintHyperframeHtml(withLanguage);
    const withoutLanguageResult = await lintHyperframeHtml(withoutLanguage);
    const withTsxLanguageResult = await lintHyperframeHtml(withTsxLanguage);
    const languageFinding = withLanguageResult.findings.find((f) => f.code === "head_leaked_text");
    const unlabeledFinding = withoutLanguageResult.findings.find(
      (f) => f.code === "head_leaked_text",
    );
    const tsxLanguageFinding = withTsxLanguageResult.findings.find(
      (f) => f.code === "head_leaked_text",
    );

    expect(languageFinding).toBeDefined();
    expect(languageFinding?.snippet).toContain("```css");
    expect(unlabeledFinding).toBeDefined();
    expect(unlabeledFinding?.snippet).toContain("```");
    expect(tsxLanguageFinding).toBeDefined();
    expect(tsxLanguageFinding?.snippet).toContain("```tsx");
  });

  it("reports error when CSS at-rules leak into the document head", async () => {
    const html = compositionWithHead(`
  @media (min-width: 800px) {
    .particle {
      transform: scale(1.2);
    }
  }
`);
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "head_leaked_text");

    expect(finding).toBeDefined();
    expect(finding?.snippet).toContain("@media");
  });

  it("reports leaked CSS when a style block is unclosed in the document head", async () => {
    const html = compositionWithHead(`
  <style>
    .particle {
      color: white;
    }
`);
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "head_leaked_text");

    expect(finding).toBeDefined();
    expect(finding?.snippet).toContain(".particle");
  });

  it("does not report leaked head text for commented CSS", async () => {
    const html = compositionWithHead(`
  <!-- .particle { color: red; } -->
`);
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "head_leaked_text");

    expect(finding).toBeUndefined();
  });

  it("does not report leaked head text for valid noscript content", async () => {
    const html = compositionWithHead(`
  <noscript>
    .no-js { display: block; }
  </noscript>
`);
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "head_leaked_text");

    expect(finding).toBeUndefined();
  });

  it("does not report orphan CSS for valid head metadata and style blocks", async () => {
    const html = compositionWithHead(`
  <title>Particle Field</title>
  <meta name="description" content="Particle field">
  <link rel="preconnect" href="https://fonts.gstatic.com">
  <base href="https://example.com/">
  <style>
    .particle {
      position: absolute;
      width: 4px;
      height: 4px;
    }
  </style>
`);
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "head_leaked_text");

    expect(finding).toBeUndefined();
  });

  it("reports leaked head text inside template-wrapped sub-compositions", async () => {
    const html = templateCompositionWithHead(`
      </style>
      .particle { color: white; }
`);
    const result = await lintHyperframeHtml(html, { isSubComposition: true });
    const finding = result.findings.find((f) => f.code === "head_leaked_text");

    expect(finding).toBeDefined();
    expect(finding?.snippet).toContain(".particle");
  });

  describe("timeline_id_mismatch", () => {
    it("accepts dot timeline registration", async () => {
      const html = `
<html><body>
  <div data-composition-id="launch" data-width="1920" data-height="1080"></div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    window.__timelines.launch = tl;
  </script>
</body></html>`;
      const result = await lintHyperframeHtml(html);
      const finding = result.findings.find((f) => f.code === "timeline_id_mismatch");
      expect(finding).toBeUndefined();
    });

    it("reports mismatched dot timeline registration", async () => {
      const html = `
<html><body>
  <div data-composition-id="launch" data-width="1920" data-height="1080"></div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    window.__timelines.intro = tl;
  </script>
</body></html>`;
      const result = await lintHyperframeHtml(html);
      const finding = result.findings.find((f) => f.code === "timeline_id_mismatch");
      expect(finding).toBeDefined();
      expect(finding?.message).toContain('Timeline registered as "intro"');
    });

    it("accepts bracket timeline registration for hyphenated ids", async () => {
      const html = `
<html><body>
  <div data-composition-id="product-launch" data-width="1920" data-height="1080"></div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    window.__timelines["product-launch"] = tl;
  </script>
</body></html>`;
      const result = await lintHyperframeHtml(html);
      const finding = result.findings.find((f) => f.code === "timeline_id_mismatch");
      expect(finding).toBeUndefined();
    });
  });

  it("warns when a timeline-visible element has no stable id for Studio editing", async () => {
    const html = `
<html><body>
  <div id="root" data-composition-id="c1" data-width="1920" data-height="1080">
    <section class="clip hero-card" data-start="0" data-duration="3"></section>
  </div>
  <script>window.__timelines = {};</script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "studio_missing_editable_id");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("warning");
    expect(finding?.message).toContain('<section class="hero-card" data-start="0">');
    expect(finding?.fixHint).toContain("stable, human-readable id");
  });

  it("does not warn about the composition root or timeline elements with ids", async () => {
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080" data-start="0">
    <section id="hero-card" class="clip hero-card" data-start="0" data-duration="3"></section>
  </div>
  <script>window.__timelines = {};</script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "studio_missing_editable_id");
    expect(finding).toBeUndefined();
  });

  describe("non_deterministic_code", () => {
    it("detects Math.random() in script content", async () => {
      const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080"></div>
  <script>
    window.__timelines = window.__timelines || {};
    const x = Math.random();
    window.__timelines["c1"] = gsap.timeline({ paused: true });
  </script>
</body></html>`;
      const result = await lintHyperframeHtml(html);
      const finding = result.findings.find((f) => f.code === "non_deterministic_code");
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("error");
      expect(finding?.message).toContain("Math.random");
    });

    it("detects Date.now() in script content", async () => {
      const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080"></div>
  <script>
    window.__timelines = window.__timelines || {};
    const ts = Date.now();
    window.__timelines["c1"] = gsap.timeline({ paused: true });
  </script>
</body></html>`;
      const result = await lintHyperframeHtml(html);
      const finding = result.findings.find((f) => f.code === "non_deterministic_code");
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("error");
      expect(finding?.message).toContain("Date.now");
    });

    it("does not flag non-deterministic calls inside single-line comments", async () => {
      const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080"></div>
  <script>
    window.__timelines = window.__timelines || {};
    // const x = Math.random();
    // Date.now() is not used here
    window.__timelines["c1"] = gsap.timeline({ paused: true });
  </script>
</body></html>`;
      const result = await lintHyperframeHtml(html);
      const finding = result.findings.find((f) => f.code === "non_deterministic_code");
      expect(finding).toBeUndefined();
    });
  });

  describe("composition_self_attribute_selector", () => {
    it("warns when inline CSS targets the root composition id", async () => {
      const html = `
<html><body>
  <div id="scene" data-composition-id="scene" data-width="1920" data-height="1080">
    <style>
      [data-composition-id="scene"] .title { opacity: 0; }
      [data-composition-id="other"] .title { color: red; }
    </style>
    <h1 class="title">Hello</h1>
  </div>
  <script>window.__timelines = {};</script>
</body></html>`;
      const result = await lintHyperframeHtml(html);
      const findings = result.findings.filter(
        (f) => f.code === "composition_self_attribute_selector",
      );

      expect(findings).toHaveLength(1);
      expect(findings[0]?.severity).toBe("warning");
      expect(findings[0]?.selector).toBe('[data-composition-id="scene"] .title');
      expect(findings[0]?.fixHint).toContain("#scene");
      expect(findings[0]?.fixHint).not.toContain("#556");
    });

    it("warns when external CSS targets the root composition id", async () => {
      const html = `
<html><body>
  <div id="scene" data-composition-id="scene" data-width="1920" data-height="1080"></div>
  <script>window.__timelines = {};</script>
</body></html>`;
      const result = await lintHyperframeHtml(html, {
        externalStyles: [
          {
            href: "scene.css",
            content: '[data-composition-id="scene"] .title { opacity: 0; }',
          },
        ],
      });
      const finding = result.findings.find((f) => f.code === "composition_self_attribute_selector");

      expect(finding).toBeDefined();
      expect(finding?.selector).toBe('[data-composition-id="scene"] .title');
    });

    it("does not warn when CSS targets a different composition id", async () => {
      const html = `
<html><body>
  <div id="scene" data-composition-id="scene" data-width="1920" data-height="1080">
    <style>[data-composition-id="other"] .title { opacity: 0; }</style>
  </div>
  <script>window.__timelines = {};</script>
</body></html>`;
      const result = await lintHyperframeHtml(html);
      const finding = result.findings.find((f) => f.code === "composition_self_attribute_selector");

      expect(finding).toBeUndefined();
    });
  });
});
