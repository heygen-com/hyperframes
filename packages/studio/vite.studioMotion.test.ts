import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createStudioDevRenderBodyScripts } from "./vite.studioMotion";

describe("createStudioDevRenderBodyScripts", () => {
  let projectDir: string | null = null;

  afterEach(() => {
    if (!projectDir) return;
    rmSync(projectDir, { recursive: true, force: true });
    projectDir = null;
  });

  function createProject(): string {
    projectDir = mkdtempSync(join(tmpdir(), "hf-studio-motion-"));
    mkdirSync(join(projectDir, ".hyperframes"), { recursive: true });
    return projectDir;
  }

  it("injects both manual edit and Studio GSAP motion render scripts in dev", () => {
    const dir = createProject();
    writeFileSync(
      join(dir, ".hyperframes/studio-manual-edits.json"),
      JSON.stringify({
        version: 1,
        edits: [{ kind: "text", target: { sourceFile: "index.html" } }],
      }),
    );
    writeFileSync(
      join(dir, ".hyperframes/studio-motion.json"),
      JSON.stringify({
        version: 1,
        motions: [
          {
            kind: "gsap-motion",
            target: { sourceFile: "index.html", selector: ".card" },
            start: 0,
            duration: 0.6,
            ease: "power3.out",
            from: { y: 32, autoAlpha: 0 },
            to: { y: 0, autoAlpha: 1 },
          },
        ],
      }),
    );

    const scripts = createStudioDevRenderBodyScripts(dir, {
      activeCompositionPath: "compositions/scene.html",
    });

    expect(scripts).toHaveLength(2);
    expect(scripts[0]).toContain("__hfStudioManualEditsApply");
    expect(scripts[1]).toContain("__hfStudioMotionApply");
    expect(scripts.join("\n")).toContain("compositions/scene.html");
  });
});
