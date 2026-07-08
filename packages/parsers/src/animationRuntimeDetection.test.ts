import { describe, expect, it } from "vitest";
import { classifyAnimationRuntime } from "./animationRuntimeDetection.js";

describe("classifyAnimationRuntime", () => {
  it("classifies a pure GSAP file as gsap", () => {
    const html = `<!doctype html>
<html>
  <body>
    <script>
      const tl = gsap.timeline({ paused: true });
      gsap.to(".box", { x: 300, duration: 2 });
      window.__timelines = [tl];
    </script>
  </body>
</html>`;

    const result = classifyAnimationRuntime(html);

    expect(result.verdict).toBe("gsap");
    expect(result.blocks).toMatchObject([{ engine: "gsap", insideTemplate: false }]);
    expect(html.slice(result.blocks[0]?.start, result.blocks[0]?.end)).toContain("gsap.timeline");
  });

  it("classifies a pure anime.js file as animejs", () => {
    const result = classifyAnimationRuntime(`<!doctype html>
<html>
  <body>
    <script>
      const tl = anime.createTimeline({ autoplay: false });
      tl.add(".box", { x: 300, duration: 2000 }, 0);
      hyperframesAnime.register("main", tl);
    </script>
  </body>
</html>`);

    expect(result.verdict).toBe("animejs");
    expect(result.blocks).toMatchObject([{ engine: "animejs", insideTemplate: false }]);
  });

  it("classifies files with both engines as mixed and preserves per-block tags", () => {
    const result = classifyAnimationRuntime(`<!doctype html>
<html>
  <body>
    <script>
      gsap.set(".box", { opacity: 0 });
      anime.animate(".box", { opacity: 1, duration: 2000 });
    </script>
    <script>
      gsap.from(".headline", { y: 40, duration: 1 });
    </script>
  </body>
</html>`);

    expect(result.verdict).toBe("mixed");
    expect(result.blocks.map((block) => block.engine)).toEqual(["mixed", "gsap"]);
  });

  it("classifies helper-only anime registration without the anime global as animejs", () => {
    const result = classifyAnimationRuntime(`<!doctype html>
<html>
  <body>
    <script>
      const scopedTimeline = buildScopedTimeline();
      hyperframesAnime.register("main", scopedTimeline);
      window.__hfAnime.push(scopedTimeline);
    </script>
  </body>
</html>`);

    expect(result.verdict).toBe("animejs");
    expect(result.blocks).toMatchObject([{ engine: "animejs" }]);
  });

  it("ignores comment-only engine mentions when classifying scripts", () => {
    const result = classifyAnimationRuntime(`<!doctype html>
<html>
  <body>
    <script>
      // this used to use gsap.timeline()
      /* anime.createTimeline setup */
      anime.animate(".box", { x: 100, duration: 2000 });
    </script>
  </body>
</html>`);

    expect(result.verdict).toBe("animejs");
    expect(result.blocks).toMatchObject([{ engine: "animejs" }]);
  });

  it("classifies empty files and files without meaningful inline scripts as none", () => {
    expect(classifyAnimationRuntime("").verdict).toBe("none");
    expect(
      classifyAnimationRuntime(
        '<!doctype html><script src="https://cdn.jsdelivr.net/npm/gsap/dist/gsap.min.js"></script>',
      ).verdict,
    ).toBe("none");
    expect(classifyAnimationRuntime("<script>   \n\t </script>").verdict).toBe("none");
  });

  it("includes template script blocks but excludes template-only engines from the file verdict", () => {
    const result = classifyAnimationRuntime(`<!doctype html>
<html>
  <body>
    <template>
      <script>
        gsap.to(".template-box", { opacity: 1 });
      </script>
    </template>
  </body>
</html>`);

    expect(result.verdict).toBe("none");
    expect(result.blocks).toMatchObject([{ engine: "gsap", insideTemplate: true }]);
  });
});
