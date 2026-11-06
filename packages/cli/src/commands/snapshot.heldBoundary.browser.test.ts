import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, expect, it, vi } from "vitest";
import snapshotCommand from "./snapshot.js";

const dir = mkdtempSync(join(tmpdir(), "hf-snapshot-held-boundary-"));

afterAll(() => rmSync(dir, { recursive: true, force: true }));

// A title held across two back-to-back clips; the second starts a hair past 100 s, as a start chained after a media
// clip's measured length lands.
writeFileSync(
  join(dir, "index.html"),
  `<!doctype html><html><body style="margin:0;background:#000">
<div id="root" data-composition-id="main" data-start="0" data-duration="110" data-width="160" data-height="90" style="position:relative;width:160px;height:90px;background:#000">
  <div id="held" data-start="90" data-duration="10" data-track-index="0" style="position:absolute;inset:0;background:#f00"></div>
  <div id="rest" data-start="100.00002" data-duration="10" data-track-index="0" style="position:absolute;inset:0;background:#f00"></div>
</div>
<script>
  window.__timelines = window.__timelines || {};
  window.__timelines["main"] = { pause() {}, time() { return 0; }, duration() { return 110; }, seek() {} };
</script></body></html>`,
);

const redAtCentre = async (path: string) => {
  const { data, info } = await sharp(path).raw().toBuffer({ resolveWithObject: true });
  const at =
    (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * info.channels;
  return data[at]! > 200 && data[at + 1]! < 60;
};

// fails without the fix: the still at exactly 100 s came out black, while 98 s, 102 s and the render show the title.
it("keeps a title held across back-to-back clips on screen at the exact second the second clip takes over", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  try {
    await snapshotCommand.run?.({
      args: {
        dir,
        at: "98,100,102",
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
    const shown = await Promise.all(
      frames.map(async (frame) => [frame.time, await redAtCentre(frame.path)]),
    );
    expect(shown).toEqual([
      [98, true],
      [100, true],
      [102, true],
    ]);
  } finally {
    vi.restoreAllMocks();
  }
}, 120_000);
