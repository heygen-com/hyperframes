import { afterEach, describe, expect, it, vi } from "vitest";
import { AudioTooLong, DECODE_MAX_SECONDS, decodeAudioWithin } from "./audioDecode";

const decoded = {} as AudioBuffer;
const context = () => ({ decodeAudioData: vi.fn(async () => decoded) });
const served = () =>
  vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }) as Response);
const decodeWith = (ctx: ReturnType<typeof context>, ...rest: [string, object?]) =>
  decodeAudioWithin(ctx as unknown as BaseAudioContext, ...rest);

afterEach(() => vi.unstubAllGlobals());

describe("decodeAudioWithin", () => {
  it("decodes a file whose header says ten minutes or less", async () => {
    vi.stubGlobal("mediaHeaderSeconds", () => DECODE_MAX_SECONDS);
    const ctx = context();
    const fetch = served();
    await expect(decodeWith(ctx, "/a.mp3", { fetch })).resolves.toBe(decoded);
    expect(fetch).toHaveBeenCalledWith("/a.mp3");
  });

  it("refuses an hour-long file before a byte of it is fetched or decoded", async () => {
    vi.stubGlobal("mediaHeaderSeconds", () => 3600);
    const ctx = context();
    const fetch = served();
    const refused = decodeWith(ctx, "/hour.mp3", { fetch });
    await expect(refused).rejects.toBeInstanceOf(AudioTooLong);
    await expect(refused).rejects.toMatchObject({ seconds: 3600 });
    expect(fetch).not.toHaveBeenCalled();
    expect(ctx.decodeAudioData).not.toHaveBeenCalled();
  });

  it("refuses a file whose length cannot be read", async () => {
    vi.stubGlobal("mediaHeaderSeconds", () => null);
    const fetch = served();
    await expect(decodeWith(context(), "/odd.bin", { fetch })).rejects.toMatchObject({
      name: "AudioTooLong",
      seconds: null,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("takes the length the caller's own element read over the header", async () => {
    const header = vi.fn(() => 3600);
    vi.stubGlobal("mediaHeaderSeconds", header);
    await expect(
      decodeWith(context(), "/a.mp3", { fetch: served(), knownSeconds: 30 }),
    ).resolves.toBe(decoded);
    vi.stubGlobal("mediaHeaderSeconds", () => 30);
    await expect(
      decodeWith(context(), "/a.mp3", { fetch: served(), knownSeconds: 3600 }),
    ).rejects.toBeInstanceOf(AudioTooLong);
    expect(header).not.toHaveBeenCalled();
  });

  it("does not decode a refused request's error page", async () => {
    const ctx = context();
    const fetch = vi.fn(async () => ({ ok: false, status: 404 }) as Response);
    await expect(decodeWith(ctx, "/gone.mp3", { fetch })).rejects.toThrow("404");
    expect(ctx.decodeAudioData).not.toHaveBeenCalled();
  });
});
