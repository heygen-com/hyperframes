import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

  it("returns 416 for an unsatisfiable range", async () => {
    const body = Buffer.from("abc", "utf-8");
    const { url } = await serveWith(body);
    const res = await fetch(`${url}tone.wav`, { headers: { Range: "bytes=99-200" } });
    expect(res.status).toBe(416);
    expect(res.headers.get("content-range")).toBe(`bytes */${body.length}`);
  });
});
