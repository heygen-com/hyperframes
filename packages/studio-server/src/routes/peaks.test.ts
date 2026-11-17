import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerPeakRoutes } from "./peaks";
import { AUDIO_DECODE_LIMIT } from "../helpers/audioDecodes";
import { stubAdapter } from "./stubAdapter.test-helpers";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setup(decode: (path: string) => Promise<number[]>) {
  const dir = mkdtempSync(join(tmpdir(), "hf-peaks-route-"));
  dirs.push(dir);
  writeFileSync(join(dir, "talk.mp4"), "video");
  mkdirSync(join(dir, "media"));
  writeFileSync(join(dir, "media", "talk.mp4"), "video");
  const app = new Hono();
  registerPeakRoutes(app, stubAdapter(dir), decode);
  return app;
}

describe("GET /projects/:id/peaks/*", () => {
  it("answers absolute bins once per file and serves the cache after", async () => {
    const decode = vi.fn(async () => [0.2, 0.99]);
    const app = setup(decode);
    for (let i = 0; i < 2; i++) {
      const res = await app.request("http://localhost/projects/p/peaks/talk.mp4");
      expect(await res.json()).toEqual({ binSeconds: 0.05, bins: [0.2, 0.99] });
    }
    expect(decode).toHaveBeenCalledTimes(1);
  });

  it("decodes a file once when several clips ask at the same time", async () => {
    let finish: (bins: number[]) => void = () => {};
    const decode = vi.fn(() => new Promise<number[]>((resolve) => (finish = resolve)));
    const app = setup(decode);
    const both = Promise.all([
      app.request("http://localhost/projects/p/peaks/talk.mp4"),
      app.request("http://localhost/projects/p/peaks/talk.mp4"),
    ]);
    await vi.waitFor(() => expect(decode).toHaveBeenCalled());
    finish([0.5]);
    for (const res of await both) expect((await res.json()).bins).toEqual([0.5]);
    expect(decode).toHaveBeenCalledTimes(1);
  });

  it("decodes a file once however the request spells its path", async () => {
    const decode = vi.fn(async () => [0.4]);
    const app = setup(decode);
    for (const spelling of ["media/talk.mp4", "media//talk.mp4", "media/talk.mp4/"]) {
      const res = await app.request(`http://localhost/projects/p/peaks/${spelling}`);
      expect((await res.json()).bins).toEqual([0.4]);
    }
    expect(decode).toHaveBeenCalledTimes(1);
  });

  it("runs a bounded number of decodes at once, and stops the ones nobody waits for", async () => {
    const live = new Set<AbortSignal>();
    let most = 0;
    const decode = vi.fn(
      (_path: string, signal: AbortSignal) =>
        new Promise<number[]>((_resolve, reject) => {
          live.add(signal);
          most = Math.max(most, live.size);
          signal.addEventListener("abort", () => {
            live.delete(signal);
            reject(new Error("aborted"));
          });
        }),
    );
    const dir = mkdtempSync(join(tmpdir(), "hf-peaks-route-"));
    dirs.push(dir);
    const files = Array.from({ length: AUDIO_DECODE_LIMIT * 2 }, (_, i) => `clip-${i}.wav`);
    for (const file of files) writeFileSync(join(dir, file), "audio");
    const app = new Hono();
    registerPeakRoutes(app, stubAdapter(dir), decode);

    const gone = files.map(() => new AbortController());
    const requests = files.map((file, i) =>
      app.request(`http://localhost/projects/p/peaks/${file}`, { signal: gone[i]!.signal }),
    );
    await vi.waitFor(() => expect(live.size).toBe(AUDIO_DECODE_LIMIT));
    for (const controller of gone) controller.abort();
    await Promise.allSettled(requests);

    expect(most).toBe(AUDIO_DECODE_LIMIT);
    expect(live.size).toBe(0);
    expect(decode).toHaveBeenCalledTimes(AUDIO_DECODE_LIMIT);
  });

  it("keeps a shared decode running while one of its requests is still waiting", async () => {
    let finish: (bins: number[]) => void = () => {};
    let stopped = false;
    const decode = vi.fn(
      (_path: string, signal: AbortSignal) =>
        new Promise<number[]>((resolve) => {
          finish = resolve;
          signal.addEventListener("abort", () => (stopped = true));
        }),
    );
    const app = setup(decode);
    const gone = new AbortController();
    const left = app.request("http://localhost/projects/p/peaks/talk.mp4", { signal: gone.signal });
    const stays = app.request("http://localhost/projects/p/peaks/talk.mp4");
    await vi.waitFor(() => expect(decode).toHaveBeenCalled());
    gone.abort();
    await Promise.allSettled([left]);
    finish([0.7]);
    expect((await (await stays).json()).bins).toEqual([0.7]);
    expect(stopped).toBe(false);
    expect(decode).toHaveBeenCalledTimes(1);
  });

  it("404s a missing file and a path outside the project", async () => {
    const app = setup(async () => []);
    expect((await app.request("http://localhost/projects/p/peaks/nope.mp4")).status).toBe(404);
    expect(
      (await app.request("http://localhost/projects/p/peaks/..%2F..%2Fetc%2Fpasswd")).status,
    ).toBe(404);
  });
});
