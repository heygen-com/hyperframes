import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { get as httpsGet } from "node:https";
import type { ClientRequest, IncomingMessage } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadFile, REDIRECT_CODES, redirectTarget } from "./download.js";

const { unlinkSyncMock } = vi.hoisted(() => ({
  unlinkSyncMock: vi.fn(),
}));

vi.mock("node:https", () => ({ get: vi.fn() }));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  unlinkSyncMock.mockImplementation(actual.unlinkSync);
  return { ...actual, unlinkSync: unlinkSyncMock };
});

const mockGet = vi.mocked(httpsGet);
const tempDirs: string[] = [];

function httpsResponse(
  statusCode: number,
  headers: Record<string, string> = {},
  body?: string | ((url: string) => string),
): typeof httpsGet {
  return ((_url: string, callback: (response: IncomingMessage) => void) => {
    const response = new PassThrough() as PassThrough & {
      statusCode: number;
      headers: Record<string, string>;
    };
    response.statusCode = statusCode;
    response.headers = headers;
    const request = new EventEmitter() as ClientRequest;
    request.setTimeout = vi.fn();
    callback(response as unknown as IncomingMessage);
    if (body !== undefined) {
      queueMicrotask(() => response.end(typeof body === "function" ? body(_url) : body));
    }
    return request;
  }) as typeof httpsGet;
}

afterEach(() => {
  vi.clearAllMocks();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("downloadFile", () => {
  it("keeps concurrent partial downloads separate", async () => {
    mockGet.mockImplementation(httpsResponse(200, {}, (url) => url));

    const dir = mkdtempSync(join(tmpdir(), "hyperframes-download-"));
    tempDirs.push(dir);
    const dest = join(dir, "model.onnx");
    const first = "https://example.test/first";
    const second = "https://example.test/second";

    await Promise.all([downloadFile(first, dest), downloadFile(second, dest)]);
    expect([first, second]).toContain(readFileSync(dest, "utf-8"));
  });

  it("rejects a response that exceeds its byte limit", async () => {
    mockGet.mockImplementation(httpsResponse(200, {}, "too large"));

    const dir = mkdtempSync(join(tmpdir(), "hyperframes-download-"));
    tempDirs.push(dir);
    const dest = join(dir, "model.onnx");

    await expect(
      downloadFile("https://example.test/model.onnx", dest, { maxBytes: 3 }),
    ).rejects.toThrow("Download exceeded 3 bytes");
    expect(existsSync(dest)).toBe(false);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("rejects an idle response and removes the partial file", async () => {
    const actualFs = await vi.importActual<typeof import("node:fs")>("node:fs");
    let responseClosed = false;
    unlinkSyncMock.mockImplementation((path) => {
      if (!responseClosed) {
        const error = new Error("file is locked");
        Object.assign(error, { code: "EBUSY" });
        throw error;
      }
      actualFs.unlinkSync(path);
    });

    mockGet.mockImplementation(((_url: string, callback: (response: IncomingMessage) => void) => {
      const response = new PassThrough() as PassThrough & {
        statusCode: number;
        headers: Record<string, string>;
      };
      response.statusCode = 200;
      response.headers = {};
      response.once("close", () => {
        responseClosed = true;
      });

      class FakeRequest extends EventEmitter {
        private timeout: ReturnType<typeof setTimeout> | undefined;
        private fallback = setTimeout(() => this.destroy(new Error("late shutdown")), 50);
        private destroyed = false;

        setTimeout(ms: number, onTimeout: () => void): this {
          this.timeout = setTimeout(onTimeout, ms);
          return this;
        }

        destroy(error: Error): void {
          if (this.destroyed) return;
          this.destroyed = true;
          clearTimeout(this.timeout);
          clearTimeout(this.fallback);
          response.destroy(error);
          this.emit("error", error);
        }
      }

      const request = new FakeRequest();
      callback(response as unknown as IncomingMessage);
      return request as unknown as ClientRequest;
    }) as typeof httpsGet);

    const dir = mkdtempSync(join(tmpdir(), "hyperframes-download-"));
    tempDirs.push(dir);
    const dest = join(dir, "model.onnx");

    await expect(
      downloadFile("https://example.test/model.onnx", dest, { timeoutMs: 10 }),
    ).rejects.toThrow("Download timed out after 10ms");
    expect(existsSync(`${dest}.tmp`)).toBe(false);
    expect(existsSync(dest)).toBe(false);
  });
});

describe("redirect handling", () => {
  it("rejects a redirect that the HTTPS client cannot follow", async () => {
    mockGet
      .mockImplementationOnce(
        httpsResponse(307, { location: "http://cdn.example.test/model.onnx" }),
      )
      .mockImplementationOnce(() => {
        throw new TypeError('Protocol "http:" not supported');
      });

    const dir = mkdtempSync(join(tmpdir(), "hyperframes-download-"));
    tempDirs.push(dir);
    await expect(
      downloadFile("https://example.test/model.onnx", join(dir, "model.onnx")),
    ).rejects.toThrow('Protocol "http:" not supported');
  });

  it("follows every redirect a host may answer with", () => {
    // 307 is the one that broke: HuggingFace answers the tokenizer with it,
    // and the original set stopped at 302, so the download fell through to the
    // not-200 branch and hung.
    for (const code of [301, 302, 303, 307, 308]) {
      expect(REDIRECT_CODES.has(code)).toBe(true);
    }
  });

  it("does not treat a success or an error as a redirect", () => {
    for (const code of [200, 204, 404, 500]) {
      expect(REDIRECT_CODES.has(code)).toBe(false);
    }
  });

  it("resolves a relative location against the url that sent it", () => {
    // The actual failure: handing this path back as a request target is not a
    // valid URL, so nothing was ever fetched.
    expect(
      redirectTarget(
        "/api/resolve-cache/models/x/tokenizer.json",
        "https://huggingface.co/x/resolve/main/tokenizer.json",
      ),
    ).toBe("https://huggingface.co/api/resolve-cache/models/x/tokenizer.json");
  });

  it("keeps an absolute location as it is", () => {
    expect(redirectTarget("https://cdn.example.com/blob", "https://huggingface.co/a/b")).toBe(
      "https://cdn.example.com/blob",
    );
  });

  it("resolves a sibling-relative location", () => {
    expect(redirectTarget("other.json", "https://example.com/a/b/file.json")).toBe(
      "https://example.com/a/b/other.json",
    );
  });
});
