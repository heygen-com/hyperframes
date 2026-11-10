// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it, vi } from "vitest";
import { scheduleCliExit } from "../utils/commandResult.js";
import snapshotCommand from "./snapshot.js";

vi.mock("../utils/commandResult.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/commandResult.js")>()),
  scheduleCliExit: vi.fn(),
}));

const root = mkdtempSync(join(tmpdir(), "hf-snapshot-exit-"));

afterAll(() => rmSync(root, { recursive: true, force: true }));

it("asks the CLI to end the process once its stills are saved, as render does", async () => {
  writeFileSync(
    join(root, "index.html"),
    `<!doctype html><html><body style="margin:0;background:#000">
<div id="root" data-composition-id="main" data-start="0" data-duration="5" data-width="320" data-height="180" style="width:320px;height:180px"></div>
<script>
  window.__timelines = { main: { pause() {}, time() { return 0; }, duration() { return 5; }, seek() {} } };
</script></body></html>`,
  );
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);

  await snapshotCommand.run?.({
    args: {
      dir: root,
      at: "1",
      end: false,
      json: true,
      output: join(root, "out"),
      describe: "false",
      "browser-gpu": false,
    },
  } as never);

  expect(scheduleCliExit).toHaveBeenCalledExactlyOnceWith(0);
});
