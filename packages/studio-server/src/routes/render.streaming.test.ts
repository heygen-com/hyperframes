import { afterEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import {
  closeSync,
  existsSync,
  ftruncateSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readlinkSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { registerRenderRoutes } from "./render";
import { stubAdapter } from "./stubAdapter.test-helpers";

const dirs: string[] = [];
const routes = [
  "/projects/demo/renders/file/saved.mov",
  "/render/saved/view",
  "/render/saved/download",
];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function savedRender(size?: number) {
  const dir = mkdtempSync(join(tmpdir(), "hf-render-stream-"));
  dirs.push(dir);
  const path = join(dir, "saved.mov");
  writeFileSync(path, "render-bytes");
  if (size !== undefined) {
    const fd = openSync(path, "r+");
    try {
      ftruncateSync(fd, size);
      writeSync(fd, "end", size - 3);
    } finally {
      closeSync(fd);
    }
  }
  const app = new Hono();
  registerRenderRoutes(app, { ...stubAdapter(dir), rendersDir: () => dir });
  expect((await app.request("/projects/demo/renders")).status).toBe(200);
  return { app, path };
}

describe("serving saved renders", () => {
  it.each(routes)("streams an export over 2 GiB through %s", async (route) => {
    const size = 3 * 1024 * 1024 * 1024;
    const { app } = await savedRender(size);
    const response = await app.request(route);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Length")).toBe(String(size));
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Missing render body");
    try {
      const first = await reader.read();
      expect(new TextDecoder().decode(first.value?.subarray(0, 12))).toBe("render-bytes");
      expect(first.done).toBe(false);
    } finally {
      await reader.cancel();
    }
  });

  it.each(routes.flatMap((route) => ["GET", "HEAD"].map((method) => ({ route, method }))))(
    "serves $method metadata and body through $route",
    async ({ route, method }) => {
      const { app } = await savedRender();
      const response = await app.request(route, { method });
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("video/quicktime");
      expect(response.headers.get("Content-Length")).toBe("12");
      expect(response.headers.get("Content-Disposition")).toMatch(
        route.endsWith("download") ? /^attachment;/ : /^inline;/,
      );
      expect(await response.text()).toBe(method === "HEAD" ? "" : "render-bytes");
    },
  );

  it.skipIf(!existsSync("/proc/self/fd"))(
    "does not retain render descriptors after HEAD",
    async () => {
      const { app, path } = await savedRender(1024 * 1024);
      const openFiles = () =>
        readdirSync("/proc/self/fd").filter((fd) => {
          try {
            return readlinkSync(`/proc/self/fd/${fd}`) === path;
          } catch {
            return false;
          }
        }).length;
      expect(openFiles()).toBe(0);
      for (const route of routes) {
        for (let i = 0; i < 3; i++) {
          const response = await app.request(route, { method: "HEAD" });
          expect(response.status).toBe(200);
          expect(await response.text()).toBe("");
        }
      }
      // Hono can finish HEAD before a file stream's asynchronous open completes.
      await setTimeout(50);
      expect(openFiles()).toBe(0);
    },
  );
});
