import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { latestShareRender, prepareShareRender } from "./render.js";
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
});
