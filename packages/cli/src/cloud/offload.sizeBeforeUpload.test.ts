import { mkdtempSync, mkdirSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, onTestFinished } from "vitest";
import { offloadHeavyMedia, type Reencoder } from "./offload.js";
import { stagePublishFiles } from "../utils/publishProject.js";

const cliEntry = resolve(fileURLToPath(import.meta.url), "..", "..", "cli.ts");
const MiB = 1024 * 1024;
const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]);

function makeOverLimitProject(extraHtml = ""): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-size-before-upload-"));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  // hero.png is offloadable (<img src>); raw/stay.mov is mentioned in a comment so it stays in the zip.
  writeFileSync(
    join(dir, "index.html"),
    `<!doctype html><!-- raw/stay.mov --><html><body><div data-composition-id="main" data-width="1920" data-height="1080"><img src="hero.png">${extraHtml}</div></body></html>`,
    "utf-8",
  );
  writeFileSync(
    join(dir, "hero.png"),
    Buffer.concat([PNG_HEAD, Buffer.alloc(6 * MiB - PNG_HEAD.length, 1)]),
  );
  mkdirSync(join(dir, "raw"));
  writeFileSync(join(dir, "raw", "stay.mov"), "");
  truncateSync(join(dir, "raw", "stay.mov"), 210 * MiB);
  return dir;
}

describe("cloud render size check before upload", () => {
  it("runs beforeUpload against the projected archive before uploading or encoding any media", async () => {
    const dir = makeOverLimitProject('<video src="take.mkv"></video>');
    writeFileSync(join(dir, "take.mkv"), Buffer.alloc(6 * MiB, 2));
    const fileMap = stagePublishFiles(dir, 5 * MiB);
    const uploads: string[] = [];
    const reencodes: string[] = [];
    const seenProjected: string[][] = [];
    const reencoder: Reencoder = {
      choose: async () => "video",
      hasVideo: async () => true,
      run: async (sourcePath) => {
        reencodes.push(sourcePath);
        return { bytes: Buffer.from("encoded"), filename: "take.mp4", contentType: "video/mp4" };
      },
    };

    await expect(
      offloadHeavyMedia(dir, fileMap, {
        apiBaseUrl: "https://api.example.test",
        cachePath: join(dir, "cache.json"),
        zipBudgetBytes: 190 * MiB,
        reencoder,
        upload: async (file) => {
          uploads.push(file.filename);
          return { asset_id: "asst_1", url: `https://assets.example.test/${file.filename}` };
        },
        beforeUpload: (projected) => {
          seenProjected.push([...projected.keys()].sort());
          throw new Error("archive over limit");
        },
      }),
    ).rejects.toThrow("archive over limit");

    expect(uploads).toEqual([]);
    expect(reencodes).toEqual([]);
    // hero.png and take.mkv would be offloaded, while raw/stay.mov stays in the projected archive.
    expect(seenProjected).toEqual([["index.html", "raw/stay.mov"]]);
  });

  it("uploads normally when beforeUpload passes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-size-before-upload-ok-"));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    writeFileSync(
      join(dir, "index.html"),
      `<!doctype html><html><body><div data-composition-id="main" data-width="1920" data-height="1080"><img src="hero.png"></div></body></html>`,
      "utf-8",
    );
    writeFileSync(
      join(dir, "hero.png"),
      Buffer.concat([PNG_HEAD, Buffer.alloc(6 * MiB - PNG_HEAD.length, 1)]),
    );
    const fileMap = stagePublishFiles(dir, 5 * MiB);
    const events: string[] = [];

    const offloaded = await offloadHeavyMedia(dir, fileMap, {
      apiBaseUrl: "https://api.example.test",
      cachePath: join(dir, "cache.json"),
      zipBudgetBytes: 1 * MiB,
      beforeUpload: () => void events.push("beforeUpload"),
      upload: async (file) => {
        events.push(`upload:${file.filename}`);
        return { asset_id: "asst_1", url: "https://assets.example.test/hero.png" };
      },
    });

    expect(events).toEqual(["beforeUpload", "upload:hero.png"]);
    expect(offloaded.map((entry) => entry.path)).toEqual(["hero.png"]);
    expect(fileMap.has("hero.png")).toBe(false);
  });

  it("refuses an over-limit project before making any upload HTTP call", async () => {
    const dir = makeOverLimitProject();
    const requests: string[] = [];
    const server = createServer((req, res) => {
      requests.push(`${req.method} ${req.url}`);
      res.writeHead(500).end("should not be called");
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    onTestFinished(() => void server.close());
    const { port } = server.address() as { port: number };

    const result = spawnSync("bun", ["run", cliEntry, "cloud", "render", dir, "--json"], {
      encoding: "utf-8",
      timeout: 30_000,
      env: {
        ...process.env,
        CI: "1",
        HEYGEN_API_KEY: "test_key",
        HEYGEN_API_URL: `http://127.0.0.1:${port}`,
        HYPERFRAMES_NO_UPDATE_CHECK: "1",
        HOME: dir,
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Project too large for cloud render");
    expect(result.stderr).toContain("raw/stay.mov");
    expect(result.stderr).not.toContain("Media upload failed");
    expect(requests).toEqual([]);
  });
});
