import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, expect, it, vi } from "vitest";
import snapshotCommand from "./snapshot.js";

const dir = mkdtempSync(join(tmpdir(), "hf-snapshot-scene-svg-ids-"));

afterAll(() => rmSync(dir, { recursive: true, force: true }));

// Two scenes drawn with the same SVG ids; the corner piece fills from a gradient both share at page level.
const portrait = (
  color: string,
) => `<svg viewBox="0 0 160 90" width="160" height="90" style="position:absolute;inset:0">
  <defs><linearGradient id="skin"><stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="${color}"/></linearGradient>
  <clipPath id="face"><circle cx="80" cy="45" r="40"/></clipPath>
  <symbol id="portrait" viewBox="0 0 160 90"><rect width="160" height="90" fill="${color}"/></symbol></defs>
  <rect width="160" height="90" fill="url(#skin)" clip-path="url(#face)"/>
  <use href="#portrait" x="0" y="0" width="40" height="20"/>
  <rect x="140" y="70" width="20" height="20" fill="url(#page)"/>
</svg>`;
writeFileSync(
  join(dir, "index.html"),
  `<!doctype html><html><body style="margin:0;background:#000">
<svg width="0" height="0" style="position:absolute"><linearGradient id="page"><stop offset="0" stop-color="#0f0"/><stop offset="1" stop-color="#0f0"/></linearGradient></svg>
<div id="root" data-composition-id="main" data-start="0" data-duration="20" data-width="160" data-height="90" style="position:relative;width:160px;height:90px;background:#000">
  <div data-start="0" data-duration="10" data-track-index="0" style="position:absolute;inset:0">${portrait("#f00")}</div>
  <div data-start="10" data-duration="10" data-track-index="0" style="position:absolute;inset:0">${portrait("#00f")}</div>
</div>
<script>
  window.__timelines = window.__timelines || {};
  window.__timelines["main"] = { pause() {}, time() { return 0; }, duration() { return 20; }, seek() {} };
</script></body></html>`,
);

const colourAt = async (path: string, x: number, y: number) => {
  const { data, info } = await sharp(path).raw().toBuffer({ resolveWithObject: true });
  const at = (y * info.width + x) * info.channels;
  const [r, g, b] = [data[at]!, data[at + 1]!, data[at + 2]!];
  return r > 200 ? "red" : b > 200 ? "blue" : g > 200 ? "green" : "none";
};

// fails without the fix: at 14 s the second scene's face painted nothing and its corner showed the first's red.
it("shows each scene's own SVG portrait when two scenes reuse the same ids", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  try {
    await snapshotCommand.run?.({
      args: {
        dir,
        at: "4,14",
        end: false,
        json: true,
        output: join(dir, "out"),
        describe: "false",
        "browser-gpu": false,
      },
    } as never);
    const { frames } = JSON.parse(String(log.mock.calls.at(-1)?.[0])) as {
      frames: { path: string; time: number }[];
    };
    const seen = await Promise.all(
      frames.map(async ({ path, time }) => [
        time,
        await colourAt(path, 80, 45),
        await colourAt(path, 10, 5),
        await colourAt(path, 150, 80),
      ]),
    );
    expect(seen).toEqual([
      [4, "red", "red", "green"],
      [14, "blue", "blue", "green"],
    ]);
  } finally {
    vi.restoreAllMocks();
  }
}, 120_000);
