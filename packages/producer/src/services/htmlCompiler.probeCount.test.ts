import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  createReadStream,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileForRender } from "./htmlCompiler.js";

const SOURCES = 3;
const SCENES = 40;

describe("compileForRender media probes", () => {
  const projectDir = mkdtempSync(join(tmpdir(), "hf-compiler-probe-count-"));
  const mediaDir = mkdtempSync(join(tmpdir(), "hf-compiler-probe-media-"));
  const logPath = join(projectDir, "ffprobe.log");
  const sourceFiles = new Map<string, string>();
  let server: Server;
  let origin = "";
  const savedProbePath = process.env.HYPERFRAMES_FFPROBE_PATH;

  beforeAll(async () => {
    const ffmpeg = process.env.HYPERFRAMES_FFMPEG_PATH || "ffmpeg";
    mkdirSync(join(projectDir, "compositions"));
    for (let i = 0; i < SOURCES; i++) {
      const made = spawnSync(
        ffmpeg,
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-f",
          "lavfi",
          "-i",
          `color=c=red:s=16x16:r=1:d=${10 + i}`,
        ].concat(["-c:v", "libx264", "-pix_fmt", "yuv420p", "-y", join(mediaDir, `s${i}.mp4`)]),
        { encoding: "utf8" },
      );
      if (made.status !== 0) throw new Error(made.stderr || "failed to create fixture");
      sourceFiles.set(`s${i}.mp4`, join(mediaDir, `s${i}.mp4`));
    }
    for (let n = 0; n < SCENES; n++) {
      writeFileSync(
        join(projectDir, "compositions", `scene${n}.html`),
        `<template id="scene${n}-template"><div data-composition-id="scene${n}" data-width="16" data-height="16"><video id="v${n}" muted src="../s${n % SOURCES}.mp4" data-start="0" data-track-index="0"></video></div></template>`,
      );
    }
    server = createServer((req, res) => {
      const file = sourceFiles.get((req.url ?? "").split("?")[0]!.slice(1));
      if (!file) {
        res.writeHead(404).end();
        return;
      }
      const size = statSync(file).size;
      const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? "");
      const start = range ? Number(range[1]) : 0;
      const end = range?.[2] ? Number(range[2]) : size - 1;
      res.writeHead(range ? 206 : 200, {
        "Content-Type": "video/mp4",
        "Accept-Ranges": "bytes",
        "Content-Length": end - start + 1,
        ...(range ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}),
      });
      createReadStream(file, { start, end }).pipe(res);
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const real = spawnSync("sh", ["-c", "command -v ffprobe"], { encoding: "utf8" }).stdout.trim();
    const shim = join(projectDir, "ffprobe-shim.sh");
    writeFileSync(
      shim,
      `#!/bin/sh\nstart=$(date +%s%N)\n${real} "$@"\ncode=$?\necho "$start $(date +%s%N) $(eval echo \\\${$#})" >> ${logPath}\nexit $code\n`,
    );
    chmodSync(shim, 0o755);
    process.env.HYPERFRAMES_FFPROBE_PATH = shim;
  });

  afterAll(() => {
    if (savedProbePath === undefined) delete process.env.HYPERFRAMES_FFPROBE_PATH;
    else process.env.HYPERFRAMES_FFPROBE_PATH = savedProbePath;
    server?.close();
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(mediaDir, { recursive: true, force: true });
  });

  it("probes each unique remote source once however many elements use it", async () => {
    const scenes = Array.from(
      { length: SCENES },
      (_, n) =>
        `<div data-composition-id="scene${n}" data-composition-src="compositions/scene${n}.html" data-start="0" data-duration="5" data-width="16" data-height="16"></div>`,
    ).join("");
    const htmlPath = join(projectDir, "index.html");
    writeFileSync(
      htmlPath,
      `<!doctype html><html><body><main data-composition-id="root" data-start="0" data-duration="5" data-width="16" data-height="16">${scenes}</main></body></html>`,
    );
    await compileForRender(projectDir, htmlPath, projectDir, {
      allowSystemFontCapture: false,
      urlByAbsentLocalPath: new Map(
        Array.from({ length: SOURCES }, (_, i) => [
          join(projectDir, `s${i}.mp4`),
          `${origin}/s${i}.mp4`,
        ]),
      ),
    });
    const perFile = new Map<string, number>();
    for (const row of readFileSync(logPath, "utf8").trim().split("\n")) {
      const file = row.split(" ").slice(2).join(" ");
      perFile.set(file, (perFile.get(file) ?? 0) + 1);
    }
    for (let i = 0; i < SOURCES; i++) {
      // one stream-and-format read and one keyframe scan
      expect(perFile.get(`${origin}/s${i}.mp4`)).toBeLessThanOrEqual(2);
    }
  });
});
