import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import { createFileServer } from "./fileServer.js";

describe("file server media responses", () => {
  it.each([
    ["avif", "image/avif"],
    ["flac", "audio/flac"],
    ["M4A", "audio/mp4"],
    ["mov", "video/quicktime"],
    ["ico", "image/vnd.microsoft.icon"],
  ])("serves .%s with its content type and unchanged bytes", async (ext, type) => {
    const projectDir = mkdtempSync(join(tmpdir(), "hf-engine-media-type-"));
    const bytes = new Uint8Array([0, 255, 128, 64, 32]);
    try {
      writeFileSync(join(projectDir, `asset.${ext}`), bytes);
      const server = await createFileServer({ projectDir });
      try {
        const response = await fetch(`${server.url}/asset.${ext}`);
        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toBe(type);
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
      } finally {
        server.close();
      }
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});

function firstExternalIpv4(): string | undefined {
  return Object.values(networkInterfaces())
    .flat()
    .find((address) => address?.family === "IPv4" && !address.internal)?.address;
}

describe("file server listener", () => {
  it("answers on loopback and not on another interface", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "hf-engine-bind-"));
    try {
      writeFileSync(join(projectDir, "index.html"), "<html></html>");
      const server = await createFileServer({ projectDir });
      try {
        expect((await fetch(`${server.url}/index.html`)).status).toBe(200);
        expect((await fetch(`http://127.0.0.1:${server.port}/index.html`)).status).toBe(200);
        const external = firstExternalIpv4();
        if (external) {
          const remote = fetch(`http://${external}:${server.port}/index.html`, {
            signal: AbortSignal.timeout(1_000),
          });
          await expect(remote).rejects.toThrow();
        }
      } finally {
        server.close();
      }
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});
