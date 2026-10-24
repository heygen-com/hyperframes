import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import snapshotCommand from "./snapshot.js";

// One layer per test (an img, a CSS background or an SVG image), revealed by the seek and served slowly.
// Each kind must be waited for on its own, so a screenshot taken right after the seek settles shows it blank.
const LATE_MS = 800;
const COLORS = { red: [255, 0, 0], green: [0, 255, 0], blue: [0, 0, 255] } as const;

let server: Server;
let base: string;
let root: string;
const pngs: Record<string, Buffer> = {};

beforeAll(async () => {
  for (const [name, [r, g, b]] of Object.entries(COLORS)) {
    pngs[name] = await sharp({
      create: { width: 4, height: 4, channels: 3, background: { r, g, b } },
    })
      .png()
      .toBuffer();
  }
  server = createServer((req, res) => {
    const name = (req.url ?? "").replace(/^\/|\.png$/g, "");
    if (name === "hang") return; // never answers
    const png = pngs[name];
    if (!png) return void res.writeHead(404).end();
    setTimeout(() => res.writeHead(200, { "Content-Type": "image/png" }).end(png), LATE_MS);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  root = mkdtempSync(join(tmpdir(), "hf-snapshot-late-images-"));
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
  rmSync(root, { recursive: true, force: true });
});

function writeProject(name: string, reveal: string): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "index.html"),
    `<!doctype html><html><body style="margin:0;background:#000">
<div id="root" data-composition-id="main" data-start="0" data-duration="5" data-width="320" data-height="180" style="position:relative;width:320px;height:180px">
  <img id="a" style="position:absolute;left:0;top:0;width:100px;height:180px">
  <div id="b" style="position:absolute;left:110px;top:0;width:100px;height:180px"></div>
  <svg style="position:absolute;left:220px;top:0" width="100" height="180"><image id="c" width="100" height="180" preserveAspectRatio="none"/></svg>
</div>
<script>
  window.__timelines = window.__timelines || {};
  let revealed = false;
  window.__timelines["main"] = {
    pause() {}, time() { return 0; }, duration() { return 5; },
    seek(t) { if (t >= 1 && !revealed) { revealed = true; ${reveal} } },
  };
</script></body></html>`,
  );
  return dir;
}

async function snapshotAt(dir: string, time: string) {
  const output = join(dir, "out");
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  try {
    await snapshotCommand.run?.({
      args: {
        dir,
        at: time,
        end: false,
        json: true,
        output,
        describe: "false",
        "browser-gpu": false,
      },
    } as never);
    const envelope = JSON.parse(String(log.mock.calls.at(-1)?.[0]));
    return { envelope, output };
  } finally {
    vi.restoreAllMocks();
  }
}

async function pixel(file: string, x: number, y: number): Promise<number[]> {
  const { data, info } = await sharp(file)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const o = (y * info.width + x) * info.channels;
  return [data[o]!, data[o + 1]!, data[o + 2]!];
}

it.each([
  ["an <img>", `document.getElementById("a").src = "BASE/red.png";`, 50, [255, 0, 0]],
  [
    "a CSS background-image",
    `document.getElementById("b").style.backgroundImage = "url(BASE/green.png)";`,
    160,
    [0, 255, 0],
  ],
  [
    "an SVG <image>",
    `document.getElementById("c").setAttribute("href", "BASE/blue.png");`,
    270,
    [0, 0, 255],
  ],
])(
  "shows %s that the seek reveals and that loads late",
  async (kind, reveal, x, color) => {
    const dir = writeProject(`late-${x}`, reveal.replaceAll("BASE", base));

    const { envelope } = await snapshotAt(dir, "1.5");

    expect(await pixel(envelope.frames[0].path as string, x, 90)).toEqual(color);
    expect(envelope.warnings ?? []).toEqual([]);
  },
  120_000,
);

it("names an image layer that has not loaded by the cap in the warnings of the --json envelope", async () => {
  const dir = writeProject("hung", `document.getElementById("a").src = "${base}/hang.png";`);

  const { envelope, output } = await snapshotAt(dir, "1.5");

  expect(readdirSync(output).some((f) => f.endsWith(".png"))).toBe(true);
  expect(envelope.warnings).toEqual([expect.stringContaining(`${base}/hang.png`)]);
}, 120_000);
