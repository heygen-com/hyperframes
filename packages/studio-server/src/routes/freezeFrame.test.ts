import { afterEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { registerFreezeFrameRoutes, type FrameExtractor } from "./freezeFrame";
import { fileContentVersion } from "../helpers/fileVersion";
import { stubAdapter } from "./stubAdapter.test-helpers";

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const html = `<div data-composition-id="main" data-start="0" data-duration="6">
<video id="talk" class="clip" src="media/talk.mp4" data-start="0" data-duration="6" data-track-index="0"></video>
</div>`;

function setup(
  extract: FrameExtractor,
  file = { path: "index.html", html },
  stillToken?: () => string,
) {
  const dir = mkdtempSync(join(tmpdir(), "hf-freeze-"));
  tempDirs.push(dir);
  mkdirSync(dirname(join(dir, file.path)), { recursive: true });
  writeFileSync(join(dir, file.path), file.html);
  const app = new Hono();
  registerFreezeFrameRoutes(app, stubAdapter(dir), extract, stillToken);
  const post = (body: unknown) =>
    app.request("http://localhost/projects/demo/file-mutations/freeze-frame", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  return { dir, post };
}

describe("freeze-frame route", () => {
  it("extracts the frame under the playhead and writes split + still in one write", async () => {
    const calls: string[][] = [];
    const { dir, post } = setup(async (args) => {
      calls.push(args);
      writeFileSync(args.at(-1) ?? "", "png");
      return { ok: true };
    });
    const res = await post({
      path: "index.html",
      expectedVersion: fileContentVersion(html),
      target: { id: "talk" },
      playhead: 2.5,
    });
    const body: { before?: string; after?: string; imageSrc?: string; stillPath?: string } =
      await res.json();
    expect(res.status).toBe(200);
    const output = calls[0]?.at(-1) ?? "";
    expect(calls[0]).toEqual([
      "-y",
      "-ss",
      "2.5",
      "-i",
      join(dir, "media/talk.mp4"),
      "-frames:v",
      "1",
      output,
    ]);
    expect(dirname(output)).toBe(join(dir, "assets/freeze"));
    expect(basename(output)).toMatch(/^talk-[0-9a-f]{10}-2500-[0-9a-f]{8}\.png$/);
    expect(body.imageSrc).toBe(`assets/freeze/${basename(output)}`);
    expect(body.stillPath).toBe(`assets/freeze/${basename(output)}`);
    expect(body.before).toBe(html);
    expect(readFileSync(join(dir, "index.html"), "utf-8")).toBe(body.after);
    expect(body.after).toContain('id="talk-freeze"');
  });

  it("refuses a stale version without extracting", async () => {
    const calls: string[][] = [];
    const { post } = setup(async (args) => {
      calls.push(args);
      return { ok: true };
    });
    const res = await post({
      path: "index.html",
      expectedVersion: "stale",
      target: { id: "talk" },
      playhead: 1,
    });
    expect(res.status).toBe(409);
    expect(calls).toEqual([]);
  });

  it("leaves the file untouched, and no partial still, when extraction fails", async () => {
    let still = "";
    const { dir, post } = setup(async (args) => {
      still = args.at(-1) ?? "";
      writeFileSync(still, "partial");
      return { ok: false, error: "boom" };
    });
    const res = await post({
      path: "index.html",
      expectedVersion: fileContentVersion(html),
      target: { id: "talk" },
      playhead: 1,
    });
    expect(res.status).toBe(500);
    expect(readFileSync(join(dir, "index.html"), "utf-8")).toBe(html);
    expect(still).not.toBe("");
    expect(existsSync(still)).toBe(false);
  });

  it("refuses, leaving nothing behind, when ffmpeg succeeds without writing a frame", async () => {
    let still = "";
    const { dir, post } = setup(async (args) => {
      still = args.at(-1) ?? "";
      return { ok: true };
    });
    const res = await post({
      path: "index.html",
      expectedVersion: fileContentVersion(html),
      target: { id: "talk" },
      playhead: 2.5,
    });
    expect(res.status).toBe(500);
    expect(readFileSync(join(dir, "index.html"), "utf-8")).toBe(html);
    expect(still).not.toBe("");
    expect(existsSync(still)).toBe(false);
  });

  it("removes the still it extracted when the page changed before the write", async () => {
    let still = "";
    const { dir, post } = setup(async (args) => {
      still = args.at(-1) ?? "";
      writeFileSync(still, "png");
      writeFileSync(join(dir, "index.html"), `${html}\n<!-- edited meanwhile -->`);
      return { ok: true };
    });
    const res = await post({
      path: "index.html",
      expectedVersion: fileContentVersion(html),
      target: { id: "talk" },
      playhead: 2.5,
    });
    expect(res.status).toBe(409);
    expect(still).not.toBe("");
    expect(existsSync(still)).toBe(false);
  });

  it("keeps a traversal clip id inside assets/freeze, for the ffmpeg output and the still's src", async () => {
    const evil = html.replace('id="talk"', 'id="../../../../outside/frame"');
    const calls: string[][] = [];
    const { dir, post } = setup(
      async (args) => {
        calls.push(args);
        writeFileSync(args.at(-1) ?? "", "png");
        return { ok: true };
      },
      { path: "scenes/a.html", html: evil.replace('src="media/', 'src="../media/') },
    );
    const res = await post({
      path: "scenes/a.html",
      expectedVersion: fileContentVersion(evil.replace('src="media/', 'src="../media/')),
      target: { id: "../../../../outside/frame" },
      playhead: 2.5,
    });
    const body: { imageSrc?: string; after?: string; stillPath?: string } = await res.json();
    expect(res.status).toBe(200);
    const output = calls[0]?.at(-1) ?? "";
    // The history names project files from the project root, not from the page that shows the still.
    expect(body.stillPath).toBe(`assets/freeze/${basename(output)}`);
    expect(basename(output)).toMatch(/^____________outside_frame-[0-9a-f]{10}-2500-/);
    expect(dirname(output)).toBe(join(dir, "assets/freeze"));
    expect(body.imageSrc).toBe(`../assets/freeze/${basename(output)}`);
    expect(body.after).toContain(`src="../assets/freeze/${basename(output)}"`);
    expect(existsSync(join(dir, "..", "outside"))).toBe(false);
  });

  describe("still identity", () => {
    const twoVideos = (
      a: string,
      b: string,
    ) => `<div data-composition-id="main" data-start="0" data-duration="6">
<video id="${a}" class="clip" src="media/a.mp4" data-start="0" data-duration="6" data-track-index="0"></video>
<video id="${b}" class="clip" src="media/b.mp4" data-start="0" data-duration="6" data-track-index="1"></video>
</div>`;

    function writingExtractor(outputs: string[]): FrameExtractor {
      return async (args) => {
        const output = args.at(-1) ?? "";
        outputs.push(output);
        await new Promise((resolve) => setTimeout(resolve, 5));
        try {
          writeFileSync(output, `frame of ${args[4]} #${outputs.length}`, {
            flag: args.includes("-y") ? "w" : "wx",
          });
          return { ok: true };
        } catch (error) {
          return { ok: false, error: String(error) };
        }
      };
    }

    function freeze(post: (body: unknown) => Promise<Response>, dir: string, id: string) {
      return post({
        path: "index.html",
        expectedVersion: fileContentVersion(readFileSync(join(dir, "index.html"), "utf-8")),
        target: { id },
        playhead: 2.5,
      });
    }

    it("gives two ids that sanitise alike distinct stills and keeps the first one's pixels", async () => {
      const outputs: string[] = [];
      const source = twoVideos("a.b", "a_b");
      const { dir, post } = setup(writingExtractor(outputs), { path: "index.html", html: source });
      expect((await freeze(post, dir, "a.b")).status).toBe(200);
      const first = readFileSync(outputs[0] ?? "", "utf-8");
      expect((await freeze(post, dir, "a_b")).status).toBe(200);
      expect(outputs[1]).not.toBe(outputs[0]);
      expect(readFileSync(outputs[0] ?? "", "utf-8")).toBe(first);
    });

    it("keeps ids sharing an 80-character prefix apart", async () => {
      const outputs: string[] = [];
      const prefix = "v".repeat(80);
      const source = twoVideos(`${prefix}1`, `${prefix}2`);
      const { dir, post } = setup(writingExtractor(outputs), { path: "index.html", html: source });
      expect((await freeze(post, dir, `${prefix}1`)).status).toBe(200);
      expect((await freeze(post, dir, `${prefix}2`)).status).toBe(200);
      expect(new Set(outputs).size).toBe(2);
    });

    it("writes a new still when the same clip is frozen again at the same time", async () => {
      const outputs: string[] = [];
      const { dir, post } = setup(writingExtractor(outputs));
      expect((await freeze(post, dir, "talk")).status).toBe(200);
      const first = readFileSync(outputs[0] ?? "", "utf-8");
      writeFileSync(join(dir, "index.html"), html);
      expect((await freeze(post, dir, "talk")).status).toBe(200);
      expect(outputs[1]).not.toBe(outputs[0]);
      expect(readFileSync(outputs[0] ?? "", "utf-8")).toBe(first);
    });

    it("gives concurrent requests distinct stills and keeps only the one the page uses", async () => {
      const outputs: string[] = [];
      const { dir, post } = setup(writingExtractor(outputs));
      const results = await Promise.all([freeze(post, dir, "talk"), freeze(post, dir, "talk")]);
      expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
      expect(new Set(outputs).size).toBe(2);
      const kept = outputs.filter((output) => existsSync(output));
      expect(kept).toHaveLength(1);
      expect(readFileSync(kept[0] ?? "", "utf-8")).toContain("#");
      expect(readFileSync(join(dir, "index.html"), "utf-8")).toContain(basename(kept[0] ?? ""));
    });

    it("keeps the winner's still when two requests race for the same name", async () => {
      const outputs: string[] = [];
      const { dir, post } = setup(writingExtractor(outputs), undefined, () => "fixed");
      const results = await Promise.all([freeze(post, dir, "talk"), freeze(post, dir, "talk")]);
      expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
      expect(outputs).toHaveLength(1);
      expect(existsSync(outputs[0] ?? "")).toBe(true);
      expect(readFileSync(join(dir, "index.html"), "utf-8")).toContain(basename(outputs[0] ?? ""));
    });

    it("refuses, without extracting, when the still's name is already taken", async () => {
      const outputs: string[] = [];
      const { dir, post } = setup(writingExtractor(outputs), undefined, () => "fixed");
      expect((await freeze(post, dir, "talk")).status).toBe(200);
      const first = readFileSync(outputs[0] ?? "", "utf-8");
      writeFileSync(join(dir, "index.html"), html);
      expect((await freeze(post, dir, "talk")).status).toBe(409);
      expect(outputs).toHaveLength(1);
      expect(readFileSync(outputs[0] ?? "", "utf-8")).toBe(first);
      expect(readFileSync(join(dir, "index.html"), "utf-8")).toBe(html);
    });
  });
});
