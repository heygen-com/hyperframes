import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it, vi } from "vitest";
import snapshotCommand from "./snapshot.js";

const root = mkdtempSync(join(tmpdir(), "hf-snapshot-sourceless-video-"));

afterAll(() => rmSync(root, { recursive: true, force: true }));

function writeProject(name: string, clipStart: number): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "index.html"),
    `<!doctype html><html><body style="margin:0;background:#000">
<div id="root" data-composition-id="main" data-start="0" data-duration="5" data-width="320" data-height="180" style="position:relative;width:320px;height:180px">
  <video id="v" class="clip" data-start="${clipStart}" data-duration="2" data-track-index="0" muted style="position:absolute;inset:0;width:320px;height:180px"></video>
</div>
<script>
  window.__timelines = window.__timelines || {};
  window.__timelines["main"] = { pause() {}, time() { return 0; }, duration() { return 5; }, seek() {} };
</script></body></html>`,
  );
  return dir;
}

async function warningsAt(dir: string, time: string): Promise<string[]> {
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  try {
    await snapshotCommand.run?.({
      args: {
        dir,
        at: time,
        end: false,
        json: true,
        output: join(dir, "out"),
        describe: "false",
        "browser-gpu": false,
      },
    } as never);
    return JSON.parse(String(log.mock.calls.at(-1)?.[0])).warnings ?? [];
  } finally {
    vi.restoreAllMocks();
  }
}

it("warns when a video on screen has no source to read its frame from", async () => {
  const warnings = await warningsAt(writeProject("on-screen", 1), "1.5");

  expect(warnings).toEqual(["1 video frames missing at 1.5s"]);
}, 120_000);

it("says nothing about a sourceless video whose clip has not started", async () => {
  const warnings = await warningsAt(writeProject("not-yet", 3), "1.5");

  expect(warnings).toEqual([]);
}, 120_000);
