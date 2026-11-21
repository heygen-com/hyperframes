import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { compileForRender, MAX_REMOTE_ASSETS } from "./htmlCompiler.js";

const transport = vi.hoisted(() => ({ requested: [] as string[], inFlight: 0, mostInFlight: 0 }));
vi.mock("../utils/urlDownloader.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/urlDownloader.js")>()),
  downloadToTemp: (url: string) => {
    transport.requested.push(url);
    transport.inFlight += 1;
    transport.mostInFlight = Math.max(transport.mostInFlight, transport.inFlight);
    return new Promise<string>((_resolve, reject) =>
      setImmediate(() => {
        transport.inFlight -= 1;
        reject(new Error("offline test"));
      }),
    );
  },
  fetchPublicHttpsText: async () => {
    throw new Error("offline test");
  },
}));

const dirs: string[] = [];
afterEach(() => {
  Object.assign(transport, { requested: [], inFlight: 0, mostInFlight: 0 });
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const images = (count: number) =>
  Array.from({ length: count }, (_, i) => `<img src="https://media.example.com/i${i}.png">`).join(
    "",
  );
const backgrounds = (count: number) =>
  Array.from(
    { length: count },
    (_, i) => `<div style="background-image: url(https://media.example.com/b${i}.jpg)"></div>`,
  ).join("");

function compile(body: string) {
  const dir = mkdtempSync(join(tmpdir(), "hf-asset-cap-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "index.html"),
    `<!doctype html><html><head></head><body><main data-composition-id="root" data-start="0" data-duration="1" data-width="16" data-height="16">${body}</main></body></html>`,
  );
  return compileForRender(dir, join(dir, "index.html"), join(dir, "out"), {
    allowSystemFontCapture: false,
  });
}

// fails without the fix: every distinct remote asset of a pass started downloading at once.
it("keeps at most a few asset downloads in flight", async () => {
  await compile(images(50));

  expect(transport.requested).toHaveLength(50);
  expect(transport.mostInFlight).toBeLessThanOrEqual(8);
});

// fails without the fix: no count limited the remote assets one compile downloads.
it("refuses a composition naming more remote assets than the cap before downloading them", async () => {
  await expect(compile(images(MAX_REMOTE_ASSETS + 1))).rejects.toThrow(
    `at most ${MAX_REMOTE_ASSETS} are downloaded`,
  );
  expect(transport.requested).toHaveLength(0);
});

it("refuses the pass that would cross the cap before it starts any of its downloads", async () => {
  const half = MAX_REMOTE_ASSETS / 2 + 1;
  await expect(compile(images(half) + backgrounds(half))).rejects.toThrow(
    `at most ${MAX_REMOTE_ASSETS} are downloaded`,
  );
  expect(transport.requested.filter((url) => url.endsWith(".png"))).toHaveLength(half);
  expect(transport.requested.filter((url) => url.endsWith(".jpg"))).toHaveLength(0);
});

it("downloads a composition at the cap", async () => {
  await compile(images(MAX_REMOTE_ASSETS));

  expect(new Set(transport.requested).size).toBe(MAX_REMOTE_ASSETS);
});
