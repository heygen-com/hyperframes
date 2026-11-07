import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { projectFingerprint } from "@hyperframes/share";
import { latestShareRender, prepareShareRender, shareContentFingerprint } from "./render.js";
const rendering = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../commands/render/plan.js", () => ({ createRenderPlan: (plan: unknown) => plan }));
vi.mock("../commands/render/execute.js", () => ({ executeRenderPlan: rendering.execute }));
vi.mock("../commands/render.js", () => ({
  renderLocal: vi.fn(),
  checkRenderResolutionPreflight: vi.fn(),
}));
const dirs: string[] = [];
function folder() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "hf-share-")));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
describe("local sharing render boundary", () => {
  it("rejects a symlinked state directory before creating descendants", async () => {
    const dir = folder();
    const outside = folder();
    writeFileSync(join(dir, "index.html"), "<html></html>");
    symlinkSync(outside, join(dir, ".hyperframes"));
    await expect(prepareShareRender(dir)).rejects.toThrow("without symlinks");
  });
  it("does not accept a sidecar pointing outside the project", () => {
    const dir = folder();
    mkdirSync(join(dir, ".hyperframes"));
    writeFileSync(
      join(dir, ".hyperframes", "share-render.json"),
      JSON.stringify({ id: "../../escape", path: "/tmp/escape.mp4", fingerprint: "f" }),
    );
    expect(latestShareRender(dir)).toBeNull();
  });
  it("reuses only the exact locally recorded file", () => {
    const dir = folder();
    const id = "41c4587b-abcd-42ab-87ab-21a7b64cc010";
    const output = join(dir, ".hyperframes", "share-renders", `${id}.mp4`);
    mkdirSync(join(dir, ".hyperframes", "share-renders"), { recursive: true });
    writeFileSync(output, "video");
    writeFileSync(
      join(dir, ".hyperframes", "share-render.json"),
      JSON.stringify({ id, path: output, fingerprint: "f" }),
    );
    expect(latestShareRender(dir)).toEqual({ id, path: output, fingerprint: "f" });
  });
  it.each([".media/voice.mp3", ".hyperframes/studio-manual-edits.json"])(
    "invalidates a cached render when %s changes",
    async (path) => {
      const dir = folder();
      writeFileSync(join(dir, "index.html"), '<audio src=".media/voice.mp3"></audio>');
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), "original");
      rendering.execute.mockImplementation(async ({ output }: { output: string }) => {
        writeFileSync(output, "rendered video");
      });
      await prepareShareRender(dir);
      const original = latestShareRender(dir);
      const watcher = await projectFingerprint(dir);
      await prepareShareRender(dir);
      expect(latestShareRender(dir)?.id).toBe(original?.id);
      writeFileSync(join(dir, path), "changed");
      expect(await projectFingerprint(dir)).toBe(watcher);
      expect(await shareContentFingerprint(dir)).not.toBe(original?.contentFingerprint);
      await prepareShareRender(dir);
      expect(latestShareRender(dir)?.id).not.toBe(original?.id);
    },
  );
});
