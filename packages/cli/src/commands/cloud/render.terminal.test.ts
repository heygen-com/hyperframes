import { runCommand } from "citty";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OffloadedMedia } from "../../cloud/offload.js";

const fixture = vi.hoisted(() => ({
  offloaded: undefined as OffloadedMedia[] | undefined,
  swappedFonts: undefined as string[] | undefined,
}));

vi.mock("../../cloud/offload.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../cloud/offload.js")>();
  return {
    ...actual,
    offloadHeavyMedia: async (...args: Parameters<typeof actual.offloadHeavyMedia>) => {
      if (!fixture.offloaded) return actual.offloadHeavyMedia(...args);
      for (const item of fixture.offloaded) args[2].onFile?.(item);
      return fixture.offloaded;
    },
  };
});

vi.mock("../../cloud/fontPreflight.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../cloud/fontPreflight.js")>();
  return {
    ...actual,
    embedSystemFonts: async (...args: Parameters<typeof actual.embedSystemFonts>) =>
      fixture.swappedFonts ?? actual.embedSystemFonts(...args),
  };
});

import render from "./render.js";
import { consumeCommandResult } from "../../utils/commandResult.js";

// Built rather than written: a literal control character in the source is a lint error.
const esc = String.fromCharCode(27);
const colors = new RegExp(`${esc}\\[[0-9;]*m`, "g");

let parent: string;
let dir: string;

beforeEach(() => {
  parent = mkdtempSync(join(tmpdir(), "hf-cloud-render-"));
  dir = join(parent, `video${esc}]0;x${String.fromCharCode(7)}${esc}[2J`);
  mkdirSync(dir);
  writeFileSync(
    join(dir, "index.html"),
    `<!doctype html><html><body><div data-composition-id="main" data-width="1920" data-height="1080" data-duration="1"></div></body></html>`,
  );
  vi.stubEnv("HEYGEN_API_KEY", "fixture-key");
});

afterEach(() => {
  fixture.offloaded = undefined;
  fixture.swappedFonts = undefined;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  consumeCommandResult();
  rmSync(parent, { recursive: true, force: true });
});

async function humanOutput(rawArgs: string[]): Promise<string> {
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  await runCommand(render, { rawArgs });
  return log.mock.calls.map((call) => call.join(" ")).join("\n");
}

// Windows refuses control characters in folder names.
describe.skipIf(process.platform === "win32")("cloud render on a terminal", () => {
  it("prints a folder name with control characters as visible escapes", async () => {
    vi.stubGlobal("fetch", vi.fn());

    const human = await humanOutput([dir, "--dry-run"]);

    expect(human.replace(colors, "")).not.toContain(esc);
    expect(human).toContain("Zipping ");
    expect(human).toContain("video\\x1b]0;x\\x07\\x1b[2J");
  });

  it("prints a left-out file name with control characters as visible escapes", async () => {
    vi.stubGlobal("fetch", vi.fn());
    writeFileSync(join(dir, `.env.${esc}[2J`), "KEY=1");
    // Re-included by the ignore file, so the upload walks it and then leaves it out as private.
    writeFileSync(join(dir, ".hyperframesignore"), "!.env.*\n");

    const human = await humanOutput([dir, "--dry-run"]);

    expect(human).toContain("left out of the upload");
    expect(human.replace(colors, "")).not.toContain(esc);
    expect(human).toContain(".env.\\x1b[2J");
  });

  it("prints archive file paths with control characters as visible escapes", async () => {
    vi.stubGlobal("fetch", vi.fn());
    writeFileSync(join(dir, `clip${esc}[2J.txt`), "text");
    fixture.offloaded = [
      { path: `media/a${esc}]0;x.mp4`, size_bytes: 10, action: "upload" },
      { path: `media/b${esc}[1A.mp4`, size_bytes: 10, action: "upload", kept_in_archive: true },
    ];

    const human = await humanOutput([dir, "--dry-run"]);

    expect(human.replace(colors, "")).not.toContain(esc);
    expect(human).toContain("media/a\\x1b]0;x.mp4 · would upload");
    expect(human).toContain("media/b\\x1b[1A.mp4 also stays in the zip");
    expect(human).toContain("Largest included files:");
    expect(human).toContain("clip\\x1b[2J.txt");
  });

  it("prints swapped font names with control characters as visible escapes", async () => {
    vi.stubGlobal("fetch", vi.fn());
    fixture.swappedFonts = [`Brand${esc}[2J\nSans`];

    const human = await humanOutput([dir, "--dry-run"]);

    expect(human.replace(colors, "")).not.toContain(esc);
    expect(human).toContain("Brand\\x1b[2J\\x0aSans is not on this computer");
  });

  it("prints the upload progress name with control characters as visible escapes", async () => {
    // The first upload attempt fails, so the retry prints a progress line.
    let uploads = 0;
    const server = createServer((request, response) => {
      request.resume();
      request.on("end", () => {
        const replies: Record<string, unknown> = {
          "/v3/assets/direct-uploads": {
            data: { asset_id: "asst_fixture", upload_url: `${baseUrl}/upload`, upload_headers: {} },
          },
          "/upload": {},
          "/v3/assets/asst_fixture/complete": {
            data: { asset_id: "asst_fixture", url: `${baseUrl}/project.zip` },
          },
          "/v3/hyperframes/renders": { data: { render_id: "hfr_fixture" } },
        };
        const path = request.url ?? "";
        response.setHeader("content-type", "application/json");
        if (path === "/v3/hyperframes/renders") response.statusCode = 202;
        if (path === "/upload" && ++uploads === 1) response.statusCode = 503;
        if (!Object.hasOwn(replies, path)) response.statusCode = 404;
        response.end(JSON.stringify(replies[path] ?? {}));
      });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected a TCP listener");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    vi.stubEnv("HEYGEN_API_URL", baseUrl);
    try {
      const human = await humanOutput([dir, "--no-wait"]);

      expect(human.replace(colors, "")).not.toContain(esc);
      expect(human).toContain("video\\x1b]0;x\\x07\\x1b[2J.zip: ");
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
