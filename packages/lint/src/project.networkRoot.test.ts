import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

vi.mock("node:child_process", () => {
  const mocked = { ChildProcess: class {}, execFile: vi.fn(), execSync: vi.fn() };
  return { ...mocked, default: mocked };
});

// Which srcs name another computer's share is Windows path logic, tested in parsers; here any src on
// `attacker.example` does, and every src lint resolves on disk is recorded.
const resolved = vi.hoisted(() => [] as string[]);
vi.mock("@hyperframes/parsers/asset-resolution", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@hyperframes/parsers/asset-resolution")>();
  return {
    ...actual,
    srcOnAnotherNetworkRoot: (_projectDir: string, src: string) => src.includes("attacker.example"),
    resolveProjectRelativeSrc: (src: string, ...rest: [string, string?]) => {
      resolved.push(src);
      return actual.resolveProjectRelativeSrc(src, ...rest);
    },
  };
});

const { lintProject } = await import("./project.js");

let project: string | undefined;
afterEach(() => {
  if (project) rmSync(project, { recursive: true, force: true });
  project = undefined;
  resolved.length = 0;
});

async function lintAudio(src: string): Promise<string[]> {
  project = mkdtempSync(join(tmpdir(), "hf-lint-network-root-"));
  writeFileSync(
    join(project, "index.html"),
    `<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080" data-start="0" data-duration="10">
    <audio id="voice" src="${src}" data-start="0" data-duration="5" data-track-index="0"></audio>
  </div>
  <script>window.__timelines = {}; window.__timelines["main"] = gsap.timeline({ paused: true });</script>
</body></html>`,
  );
  const { results } = await lintProject(project);
  return results.flatMap((result) => result.result.findings.map((finding) => finding.code));
}

describe("audio on another computer's share", () => {
  it("is not looked for or reported", async () => {
    const codes = await lintAudio("\\\\attacker.example\\share\\voice.wav");
    expect(resolved.filter((src) => src.includes("attacker.example"))).toEqual([]);
    expect(codes).not.toContain("audio_src_not_found");
  });

  it("leaves a missing project audio file reported", async () => {
    const codes = await lintAudio("assets/gone.wav");
    expect(resolved).toContain("assets/gone.wav");
    expect(codes).toContain("audio_src_not_found");
  });
});
