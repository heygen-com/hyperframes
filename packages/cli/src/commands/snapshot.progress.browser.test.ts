import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it, vi } from "vitest";
import snapshotCommand from "./snapshot.js";

const root = mkdtempSync(join(tmpdir(), "hf-snapshot-progress-"));

afterAll(() => rmSync(root, { recursive: true, force: true }));

it("prints a progress line on stderr as each frame starts, and keeps stdout one --json envelope", async () => {
  writeFileSync(
    join(root, "index.html"),
    `<!doctype html><html><body style="margin:0;background:#000">
<div id="root" data-composition-id="main" data-start="0" data-duration="5" data-width="320" data-height="180" style="width:320px;height:180px"></div>
<script>
  window.__timelines = { main: { pause() {}, time() { return 0; }, duration() { return 5; }, seek() {} } };
</script></body></html>`,
  );
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  try {
    await snapshotCommand.run?.({
      args: {
        dir: root,
        at: "1,2.5",
        end: false,
        json: true,
        output: join(root, "out"),
        describe: "false",
        "browser-gpu": false,
      },
    } as never);
    const progress = error.mock.calls
      .map(([line]) => String(line))
      .filter((line) => line.startsWith("[hyperframes] snapshot:"));

    expect(progress).toEqual([
      "[hyperframes] snapshot: frame 1/2 at 1s",
      "[hyperframes] snapshot: frame 2/2 at 2.5s",
    ]);
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(log.mock.calls[0]?.[0])).frames).toHaveLength(2);
  } finally {
    vi.restoreAllMocks();
  }
}, 120_000);
