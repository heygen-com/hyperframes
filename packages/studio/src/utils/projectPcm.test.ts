// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { readPcm, readPcmChannels } from "./projectPcm";

afterEach(() => vi.unstubAllGlobals());

const serving = (samples: number[], channels?: number) =>
  vi.fn(
    async () =>
      new Response(new Float32Array(samples).buffer, {
        headers: channels ? { "x-channels": String(channels) } : {},
      }),
  );
const noContext = () => ({}) as BaseAudioContext;
const file = "/api/projects/p/preview/assets/mix.wav";

it("hands beat detection each channel apart, from the server's interleaved frames", async () => {
  const fetch = serving([1, -1, 0.5, -0.5], 2);
  vi.stubGlobal("fetch", fetch);
  const [left, right] = await readPcmChannels(file, 48_000, noContext);
  expect([...left!]).toEqual([1, 0.5]);
  expect([...right!]).toEqual([-1, -0.5]);
  expect(String(fetch.mock.calls[0]![0])).toMatch(
    /\/api\/projects\/p\/pcm\/assets\/mix\.wav\?rate=48000&channels=all$/,
  );
});

it("hands the fx the first channel, asked for alone", async () => {
  const fetch = serving([0.25, 0.75]);
  vi.stubGlobal("fetch", fetch);
  expect([...(await readPcm(file, 24_000, noContext))]).toEqual([0.25, 0.75]);
  expect(String(fetch.mock.calls[0]![0])).toMatch(/\/pcm\/assets\/mix\.wav\?rate=24000$/);
});
