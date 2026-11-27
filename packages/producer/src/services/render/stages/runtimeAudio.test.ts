import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "puppeteer-core";
import {
  materializeBlobAudioSources,
  materializeDataAudioSources,
  RUNTIME_AUDIO_SUBDIR,
} from "./runtimeAudio.js";

function stubPage(handler: (url: string, limit: number) => unknown): Page {
  return {
    evaluate: async (_fn: unknown, url: string, limit: number) => handler(url, limit),
  } as unknown as Page;
}

describe("materializeBlobAudioSources", () => {
  it("materializes same-origin blobs with MIME extensions and skips cross-origin blobs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-rt-blob-"));
    const sample = Buffer.from("RIFF$\x00\x00\x00WAVEfmt ", "binary");
    const evaluated: string[] = [];
    const page = stubPage((url) => {
      evaluated.push(url);
      return { ok: true, base64: sample.toString("base64"), mimeType: "audio/mpeg; codecs=mp3" };
    });
    const audios = [
      { id: "ok", src: "blob:http://127.0.0.1:4321/aaa" },
      { id: "cross-origin", src: "blob:https://other.example/bbb" },
      { id: "wrong-port", src: "blob:http://127.0.0.1:9999/ccc" },
      { id: "local", src: "assets/music.mp3" },
    ];
    try {
      await materializeBlobAudioSources({
        page,
        fileServerUrl: "http://127.0.0.1:4321/",
        audios,
        compiledDir: dir,
      });

      expect(evaluated).toEqual(["blob:http://127.0.0.1:4321/aaa"]);
      expect(audios[0]!.src).toMatch(new RegExp(`^${RUNTIME_AUDIO_SUBDIR}/[0-9a-f]{16}\\.mp3$`));
      expect(readFileSync(join(dir, audios[0]!.src)).equals(sample)).toBe(true);
      expect(audios[1]!.src).toBe("blob:https://other.example/bbb");
      expect(audios[2]!.src).toBe("blob:http://127.0.0.1:9999/ccc");
      expect(audios[3]!.src).toBe("assets/music.mp3");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("leaves src unchanged when a blob is revoked, empty, or exceeds byte limits", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-rt-blob-fail-"));
    const small = Buffer.from("0123456789");
    const page = stubPage((url) => {
      if (url.endsWith("/revoked")) return { ok: false, reason: "fetch_failed" };
      if (url.endsWith("/huge")) {
        return {
          ok: true,
          base64: Buffer.alloc(32).toString("base64"),
          mimeType: "audio/wav",
        };
      }
      return {
        ok: true,
        base64: small.toString("base64"),
        mimeType: "application/octet-stream",
      };
    });
    const audios = [
      { id: "revoked", src: "blob:http://127.0.0.1:5000/revoked" },
      { id: "huge", src: "blob:http://127.0.0.1:5000/huge" },
      { id: "first", src: "blob:http://127.0.0.1:5000/first" },
      { id: "over-total", src: "blob:http://127.0.0.1:5000/second" },
    ];
    try {
      await materializeBlobAudioSources({
        page,
        fileServerUrl: "http://127.0.0.1:5000",
        audios,
        compiledDir: dir,
        limits: { maxPerClipBytes: 16, maxTotalBytes: 12 },
      });

      expect(audios[0]!.src).toBe("blob:http://127.0.0.1:5000/revoked");
      expect(audios[1]!.src).toBe("blob:http://127.0.0.1:5000/huge");
      expect(audios[2]!.src).toMatch(new RegExp(`^${RUNTIME_AUDIO_SUBDIR}/[0-9a-f]{16}\\.bin$`));
      expect(audios[3]!.src).toBe("blob:http://127.0.0.1:5000/second");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("materializeDataAudioSources", () => {
  it("decodes base64 and percent-encoded data URIs, deduplicates, and rejects invalid or oversized inputs", () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-rt-data-"));
    const payload = Buffer.from("RIFFDATA", "ascii");
    const validUri = `data:audio/wav;base64,${payload.toString("base64")}`;
    const audios = [
      { id: "a1", src: validUri },
      { id: "a2", src: validUri },
      { id: "pct", src: "data:audio/ogg,OggS" },
      { id: "bad", src: "data:audio/wav;base64,!!!not-base64!!!" },
      { id: "empty", src: "data:audio/wav;base64," },
      { id: "big", src: `data:audio/wav;base64,${Buffer.alloc(32).toString("base64")}` },
    ];
    try {
      materializeDataAudioSources({
        audios,
        compiledDir: dir,
        limits: { maxPerClipBytes: 16, maxTotalBytes: 32 },
      });

      expect(audios[0]!.src).toMatch(new RegExp(`^${RUNTIME_AUDIO_SUBDIR}/[0-9a-f]{16}\\.wav$`));
      expect(audios[1]!.src).toBe(audios[0]!.src);
      expect(readFileSync(join(dir, audios[0]!.src)).equals(payload)).toBe(true);
      expect(audios[2]!.src).toMatch(new RegExp(`^${RUNTIME_AUDIO_SUBDIR}/[0-9a-f]{16}\\.ogg$`));
      expect(readFileSync(join(dir, audios[2]!.src), "ascii")).toBe("OggS");
      expect(audios[3]!.src).toBe("data:audio/wav;base64,!!!not-base64!!!");
      expect(audios[4]!.src).toBe("data:audio/wav;base64,");
      expect(audios[5]!.src).toStartWith("data:audio/wav;base64,");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
