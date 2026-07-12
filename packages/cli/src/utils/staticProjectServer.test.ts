import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serveStaticProjectHtml, type StaticProjectServer } from "./staticProjectServer.js";

let server: StaticProjectServer | undefined;
let dir: string | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

async function serveWith(bytes: Buffer): Promise<{ url: string }> {
  dir = mkdtempSync(join(tmpdir(), "hf-static-"));
  writeFileSync(join(dir, "tone.wav"), bytes);
  server = await serveStaticProjectHtml(dir, "<html></html>");
  return { url: server.url };
}

describe("serveStaticProjectHtml range support", () => {
  it("answers a Range request with 206 + the requested byte slice", async () => {
    // Chromium needs byte-range seekability or WAV `.duration` reports Infinity,
    // which makes `hyperframes validate` falsely warn it cannot read the duration.
    const body = Buffer.from("0123456789", "utf-8");
    const { url } = await serveWith(body);

    const res = await fetch(`${url}tone.wav`, { headers: { Range: "bytes=2-5" } });
    expect(res.status).toBe(206);
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("content-range")).toBe(`bytes 2-5/${body.length}`);
    expect(await res.text()).toBe("2345");
  });

  it("advertises Accept-Ranges even on a full 200 response", async () => {
    const { url } = await serveWith(Buffer.from("abcdef", "utf-8"));
    const res = await fetch(`${url}tone.wav`);
    expect(res.status).toBe(200);
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(await res.text()).toBe("abcdef");
  });

  it("streams a small slice out of a large file without buffering the whole thing", async () => {
    // 8MB file, ask for 4 bytes deep inside it. The handler must createReadStream
    // the [start,end] window only, not readFileSync the whole 8MB and slice.
    const size = 8 * 1024 * 1024;
    const big = Buffer.alloc(size, 0x61); // 'a' everywhere...
    big.write("WXYZ", 5_000_000); // ...except a 4-byte marker
    const { url } = await serveWith(big);

    const res = await fetch(`${url}tone.wav`, { headers: { Range: "bytes=5000000-5000003" } });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe(`bytes 5000000-5000003/${size}`);
    expect(res.headers.get("content-length")).toBe("4");
    expect(await res.text()).toBe("WXYZ");
  });

  it("returns 416 for an unsatisfiable range", async () => {
    const body = Buffer.from("abc", "utf-8");
    const { url } = await serveWith(body);
    const res = await fetch(`${url}tone.wav`, { headers: { Range: "bytes=99-200" } });
    expect(res.status).toBe(416);
    expect(res.headers.get("content-range")).toBe(`bytes */${body.length}`);
  });
});

describe("serveStaticProjectHtml asset roots", () => {
  const extraDirs: string[] = [];
  const mk = (): string => {
    const d = mkdtempSync(join(tmpdir(), "hf-static-root-"));
    extraDirs.push(d);
    return d;
  };
  afterEach(() => {
    for (const d of extraDirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("serves files from an extra asset root when the project dir lacks them", async () => {
    // extra root (e.g. localized-assets temp dir) resolves same-origin
    const projectDir = mk();
    const assetDir = mk();
    mkdirSync(join(assetDir, "_remote_media"), { recursive: true });
    writeFileSync(join(assetDir, "_remote_media", "img.jpg"), "PIXELS");
    server = await serveStaticProjectHtml(projectDir, "<html></html>", undefined, [assetDir]);

    const res = await fetch(`${server.url}_remote_media/img.jpg`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("PIXELS");
  });

  it("prefers the project dir over an asset root for the same path", async () => {
    const projectDir = mk();
    const assetDir = mk();
    writeFileSync(join(projectDir, "a.txt"), "PROJECT");
    writeFileSync(join(assetDir, "a.txt"), "ASSET");
    server = await serveStaticProjectHtml(projectDir, "<html></html>", undefined, [assetDir]);

    const res = await fetch(`${server.url}a.txt`);
    expect(await res.text()).toBe("PROJECT");
  });

  it("404s a path present in no root", async () => {
    const projectDir = mk();
    server = await serveStaticProjectHtml(projectDir, "<html></html>", undefined, [mk()]);
    const res = await fetch(`${server.url}nope.txt`);
    expect(res.status).toBe(404);
  });
});
