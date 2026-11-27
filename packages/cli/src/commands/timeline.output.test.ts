import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "citty";
import { afterEach, expect, it, vi } from "vitest";
import timeline from "./timeline.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it("shows control characters in a runtime query's answer as text, and keeps its lines", async () => {
  // Built rather than written: a literal control character in the source is a lint error.
  const bell = String.fromCharCode(7);
  const dir = mkdtempSync(join(tmpdir(), "hf-timeline-out-"));
  writeFileSync(join(dir, "index.html"), "<html></html>");
  vi.stubEnv("HF_INSPECT_URL", "http://127.0.0.1:4599");
  vi.stubGlobal("fetch", async (url: string) =>
    url.endsWith("/info")
      ? new Response(JSON.stringify({ project: dir }))
      : new Response(JSON.stringify({ text: `#hero${bell}\n  0s to 2s` })),
  );
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    await runCommand(timeline, { rawArgs: [dir, "--at", "1"] });

    expect(log.mock.calls).toEqual([["#hero\\x07\n  0s to 2s"]]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
