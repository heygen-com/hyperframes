import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

vi.mock("node:child_process", () => {
  const mocked = { ChildProcess: class {}, execFile: vi.fn(), execSync: vi.fn() };
  return { ...mocked, default: mocked };
});

// A Windows disk on any host: these drive-letter files exist, as render would find them.
const ON_DISK = new Set(["C:\\media\\clip.png", "C:\\media\\grain.png"]);
vi.mock("@hyperframes/parsers/asset-resolution", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@hyperframes/parsers/asset-resolution")>();
  return {
    ...actual,
    localAbsoluteAssetFile: (_projectDir: string, src: string) => (ON_DISK.has(src) ? src : null),
  };
});

const { lintProject } = await import("./project.js");

let project: string | undefined;
afterEach(() => {
  if (project) rmSync(project, { recursive: true, force: true });
  project = undefined;
});

async function lintCodes(body: string, files: Record<string, string> = {}): Promise<string[]> {
  project = mkdtempSync(join(tmpdir(), "hf-lint-windows-absolute-"));
  writeFileSync(
    join(project, "index.html"),
    `<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080" data-start="0" data-duration="10">${body}</div>
  <script>window.__timelines = {}; window.__timelines["main"] = gsap.timeline({ paused: true });</script>
</body></html>`,
  );
  for (const [name, text] of Object.entries(files)) writeFileSync(join(project, name), text);
  const { results } = await lintProject(project);
  return results.flatMap((result) => result.result.findings.map((finding) => finding.code));
}

describe("local absolute paths that render copies in", () => {
  it("are not reported as missing media", async () => {
    expect(await lintCodes('<img src="C:\\media\\clip.png" />')).not.toContain(
      "missing_local_asset",
    );
  });

  it("are still reported when the file is not there", async () => {
    expect(await lintCodes('<img src="C:\\media\\gone.png" />')).toContain("missing_local_asset");
  });

  it("are not reported as a missing texture mask in the page's own CSS", async () => {
    const codes = await lintCodes(
      '<style>.grain { mask-image: url("C:\\media\\grain.png"); }</style><div class="grain"></div>',
    );
    expect(codes).not.toContain("texture_mask_asset_not_found");
  });

  it("are still reported from a linked stylesheet, where url() stays a browser URL", async () => {
    const codes = await lintCodes(
      '<link rel="stylesheet" href="styles.css" /><div class="grain"></div>',
      { "styles.css": '.grain { mask-image: url("C:\\media\\grain.png"); }' },
    );
    expect(codes).toContain("texture_mask_asset_not_found");
  });
});
