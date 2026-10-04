import { afterEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { isAtomicTempPath } from "@hyperframes/core/atomic-file";
import { registerFreezeFrameRoutes, type FrameExtractor } from "./freezeFrame";
import { fileContentVersion } from "../helpers/fileVersion";
import { openProjectHistory, type ProjectHistory } from "../history";
import { stubAdapter } from "./stubAdapter.test-helpers";

const tempDirs: string[] = [];
const histories: ProjectHistory[] = [];
afterEach(async () => {
  for (const history of histories.splice(0)) await history.close();
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

function pngWriter(calls: string[][]): FrameExtractor {
  return async (args) => {
    calls.push(args);
    writeFileSync(args.at(-1) ?? "", "png");
    return { ok: true };
  };
}

const stillOf = (output: string) => output.replace(/\.hf[0-9a-f]{6}\.tmp$/, "");
const freezeFiles = (dir: string) => readdirSync(join(dir, "assets/freeze"));

describe("freeze-frame route", () => {
  it("extracts the frame under the playhead and writes split + still in one write", async () => {
    const calls: string[][] = [];
    const { dir, post } = setup(pngWriter(calls));
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
    expect(calls[0]?.slice(0, 5)).toEqual(["-y", "-ss", "2.5", "-i", join(dir, "media/talk.mp4")]);
    expect(isAtomicTempPath(output)).toBe(true);
    const still = stillOf(output);
    expect(dirname(still)).toBe(join(dir, "assets/freeze"));
    expect(basename(still)).toMatch(/^talk-[0-9a-f]{10}-2500-[0-9a-f]{8}\.png$/);
    expect(body.imageSrc).toBe(`assets/freeze/${basename(still)}`);
    expect(body.stillPath).toBe(`assets/freeze/${basename(still)}`);
    expect(readFileSync(still, "utf-8")).toBe("png");
    expect(freezeFiles(dir)).toEqual([basename(still)]);
    expect(body.before).toBe(html);
    expect(readFileSync(join(dir, "index.html"), "utf-8")).toBe(body.after);
    expect(body.after).toContain('id="talk-freeze"');
  });

  it("keeps the still out of history until it is whole, so undo removes it after a slow extraction", async () => {
    let history: ProjectHistory | undefined;
    const { dir, post } = setup(async (args) => {
      // ffmpeg outlasting the watcher's quiet time: history commits the project with the still half written.
      writeFileSync(args.at(-1) ?? "", "pn");
      await history?.flush();
      writeFileSync(args.at(-1) ?? "", "png");
      return { ok: true };
    });
    const historyRoot = mkdtempSync(join(tmpdir(), "hf-freeze-history-"));
    tempDirs.push(historyRoot);
    history = await openProjectHistory({ projectDir: dir, historyRoot });
    histories.push(history);
    const res = await post({
      path: "index.html",
      expectedVersion: fileContentVersion(html),
      target: { id: "talk" },
      playhead: 2.5,
    });
    const { stillPath = "" }: { stillPath?: string } = await res.json();
    expect(res.status).toBe(200);
    const you = { kind: "person" as const, name: "You" };
    const claimed = await history.claim(you, "Freeze frame", ["index.html", stillPath]);
    expect(await history.undo(claimed?.id ?? "", { who: you })).toMatchObject({ ok: true });
    expect(existsSync(join(dir, stillPath))).toBe(false);
    expect(readFileSync(join(dir, "index.html"), "utf-8")).toBe(html);
    expect(history.list().map((entry) => entry.who.kind)).not.toContain("outside");
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

  it.each([
    ["extraction fails after a partial write", "partial", false],
    ["ffmpeg succeeds without writing a frame", null, true],
  ] as const)("leaves the file untouched, and no still, when %s", async (_, written, ok) => {
    let output = "";
    const { dir, post } = setup(async (args) => {
      output = args.at(-1) ?? "";
      if (written) writeFileSync(output, written);
      return ok ? { ok } : { ok, error: "boom" };
    });
    const res = await post({
      path: "index.html",
      expectedVersion: fileContentVersion(html),
      target: { id: "talk" },
      playhead: 2.5,
    });
    expect(res.status).toBe(500);
    expect(readFileSync(join(dir, "index.html"), "utf-8")).toBe(html);
    expect(output).not.toBe("");
    expect(freezeFiles(dir)).toEqual([]);
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
    expect(freezeFiles(dir)).toEqual([]);
  });

  it("keeps a traversal clip id inside assets/freeze, for the ffmpeg output and the still's src", async () => {
    const evil = html.replace('id="talk"', 'id="../../../../outside/frame"');
    const calls: string[][] = [];
    const { dir, post } = setup(pngWriter(calls), {
      path: "scenes/a.html",
      html: evil.replace('src="media/', 'src="../media/'),
    });
    const res = await post({
      path: "scenes/a.html",
      expectedVersion: fileContentVersion(evil.replace('src="media/', 'src="../media/')),
      target: { id: "../../../../outside/frame" },
      playhead: 2.5,
    });
    const body: { imageSrc?: string; after?: string; stillPath?: string } = await res.json();
    expect(res.status).toBe(200);
    const output = stillOf(calls[0]?.at(-1) ?? "");
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

    /** Each extraction writes only once `together` of them have started, so concurrent requests overlap. */
    function writingExtractor(outputs: string[], together = 1): FrameExtractor {
      let allStarted = () => {};
      const started = new Promise<void>((resolve) => (allStarted = resolve));
      return async (args) => {
        const output = args.at(-1) ?? "";
        outputs.push(stillOf(output));
        if (outputs.length >= together) allStarted();
        await started;
        writeFileSync(output, `frame of ${args[4]} #${outputs.length}`);
        return { ok: true };
      };
    }

    /** Freezes talk, puts the page back, and freezes it again: the first still's bytes and the second reply. */
    async function freezeTalkTwice(
      post: (body: unknown) => Promise<Response>,
      dir: string,
      outputs: string[],
    ) {
      expect((await freeze(post, dir, "talk")).status).toBe(200);
      const first = readFileSync(outputs[0] ?? "", "utf-8");
      writeFileSync(join(dir, "index.html"), html);
      return { first, second: await freeze(post, dir, "talk") };
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
      const { first, second } = await freezeTalkTwice(post, dir, outputs);
      expect(second.status).toBe(200);
      expect(outputs[1]).not.toBe(outputs[0]);
      expect(readFileSync(outputs[0] ?? "", "utf-8")).toBe(first);
    });

    it("gives concurrent requests distinct stills and keeps only the one the page uses", async () => {
      const outputs: string[] = [];
      const { dir, post } = setup(writingExtractor(outputs, 2));
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
      const { dir, post } = setup(writingExtractor(outputs, 2), undefined, () => "fixed");
      const results = await Promise.all([freeze(post, dir, "talk"), freeze(post, dir, "talk")]);
      expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
      expect(new Set(outputs).size).toBe(1);
      expect(freezeFiles(dir)).toEqual([basename(outputs[0] ?? "")]);
      expect(readFileSync(join(dir, "index.html"), "utf-8")).toContain(basename(outputs[0] ?? ""));
    });

    it("refuses, keeping the first still, when the still's name is already taken", async () => {
      const outputs: string[] = [];
      const { dir, post } = setup(writingExtractor(outputs), undefined, () => "fixed");
      const { first, second } = await freezeTalkTwice(post, dir, outputs);
      expect(second.status).toBe(409);
      expect(readFileSync(outputs[0] ?? "", "utf-8")).toBe(first);
      expect(freezeFiles(dir)).toEqual([basename(outputs[0] ?? "")]);
      expect(readFileSync(join(dir, "index.html"), "utf-8")).toBe(html);
    });
  });
});
