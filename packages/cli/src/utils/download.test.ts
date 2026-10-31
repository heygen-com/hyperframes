import { randomUUID } from "node:crypto";
import { MODELS_DIR, ensureModel } from "../whisper/manager.js";
import { EventEmitter } from "node:events";
import { spawnSync } from "node:child_process";
import fs, {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { get as httpsGet } from "node:https";
import type { ClientRequest, IncomingMessage } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadFile, REDIRECT_CODES, redirectTarget } from "./download.js";

vi.mock("node:https", () => ({ get: vi.fn() }));

const mockGet = vi.mocked(httpsGet);
const tempDirs: string[] = [];

function httpsResponse(
  statusCode: number,
  headers: Record<string, string> = {},
  body?: string | ((url: string) => string),
  onResponse?: (response: IncomingMessage) => void,
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
    const message = response as unknown as IncomingMessage;
    onResponse?.(message);
    callback(message);
    if (body !== undefined) {
      queueMicrotask(() => response.end(typeof body === "function" ? body(_url) : body));
    }
    return request;
  }) as typeof httpsGet;
}

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("downloadFile", () => {
  it("hands https.get the caller's signal, so aborting a model download removes the partial file", async () => {
    let seen: AbortSignal | undefined;
    mockGet.mockImplementation(((
      _url: string,
      options: { signal?: AbortSignal },
      callback: (response: IncomingMessage) => void,
    ) => {
      seen = options.signal;
      const response = Object.assign(new PassThrough(), { statusCode: 200, headers: {} });
      const request = new EventEmitter() as ClientRequest;
      request.setTimeout = vi.fn();
      callback(response as unknown as IncomingMessage);
      response.write("partial");
      // What Node does with a request whose signal aborts.
      options.signal?.addEventListener("abort", () =>
        request.emit(
          "error",
          Object.assign(new Error("The operation was aborted"), { name: "AbortError" }),
        ),
      );
      return request;
    }) as unknown as typeof httpsGet);
    const controller = new AbortController();
    const model = `test-${randomUUID()}`;

    const download = ensureModel(model, { signal: controller.signal });
    await new Promise((resolve) => setImmediate(resolve));
    controller.abort();

    await expect(download).rejects.toThrow("The operation was aborted");
    expect(seen).toBe(controller.signal);
    expect(readdirSync(MODELS_DIR).filter((name) => name.includes(model))).toEqual([]);
  });

  it("carries model download progress through the real pipeline and stays quiet on cache hits", async () => {
    mockGet.mockImplementation(httpsResponse(200, { "content-length": "5" }, "hello"));
    const events: unknown[] = [];
    const model = `test-${randomUUID()}`;
    const options = {
      onDownloadProgress: (receivedBytes: number, totalBytes: number | null) =>
        events.push({ receivedBytes, totalBytes }),
    };
    const modelPath = await ensureModel(model, options);
    try {
      expect(readFileSync(modelPath, "utf8")).toBe("hello");
      expect(events).toEqual([
        { receivedBytes: 0, totalBytes: 5 },
        { receivedBytes: 5, totalBytes: 5 },
      ]);
      events.length = 0;
      expect(await ensureModel(model, options)).toBe(modelPath);
      expect(events).toEqual([]);
      expect(mockGet).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(modelPath);
    }
  });

  it.each([
    [{ "content-length": "5" }, 5],
    [{}, null],
    [{ "content-length": "invalid" }, null],
  ])("reports actual response bytes with total %j", async (headers, totalBytes) => {
    mockGet.mockImplementation(httpsResponse(200, headers as Record<string, string>, "hello"));
    const dir = mkdtempSync(join(tmpdir(), "hyperframes-download-"));
    tempDirs.push(dir);
    const events: unknown[] = [];
    await downloadFile("https://example.test/model", join(dir, "model"), {
      onProgress: (receivedBytes, total) => events.push({ receivedBytes, totalBytes: total }),
    });
    expect(events).toContainEqual({ receivedBytes: 5, totalBytes });
    expect(readFileSync(join(dir, "model"), "utf8")).toBe("hello");
  });

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
    let responseClosed = false;
    const realUnlinkSync = fs.unlinkSync;
    vi.spyOn(fs, "unlinkSync").mockImplementation((path) => {
      if (!responseClosed) {
        const error = new Error("file is locked");
        Object.assign(error, { code: "EBUSY" });
        throw error;
      }
      realUnlinkSync(path);
    });
    // Node's named exports of a builtin follow its default export only once synced.
    syncBuiltinESMExports();

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

describe("stalled downloads", () => {
  async function onDisk(path: string, bytes: number): Promise<void> {
    while (!(existsSync(path) && statSync(path).size >= bytes)) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  // A host whose every connection stops after `cut` bytes. Its idle timeout fires once those
  // bytes are in `part`, never on a clock, so a slow disk cannot turn a stall into no progress.
  function stallingHost(
    content: Buffer,
    cut: number,
    honourRange: boolean,
    ranges: (string | undefined)[],
    part: string,
  ) {
    return ((_url: string, optionsOrCallback: unknown, maybeCallback?: unknown) => {
      const callback = (
        typeof optionsOrCallback === "function" ? optionsOrCallback : maybeCallback
      ) as (response: IncomingMessage) => void;
      const range = (optionsOrCallback as { headers?: { Range?: string } }).headers?.Range;
      ranges.push(range);
      const start = honourRange && range ? Number(/bytes=(\d+)-/.exec(range)?.[1]) : 0;
      const response = new PassThrough() as PassThrough & {
        statusCode: number;
        headers: Record<string, string>;
      };
      response.statusCode = start > 0 ? 206 : 200;
      response.headers = {
        "content-length": String(content.length - start),
        ...(start > 0
          ? { "content-range": `bytes ${start}-${content.length - 1}/${content.length}` }
          : {}),
      };
      class FakeRequest extends EventEmitter {
        onTimeout: (() => void) | undefined;
        setTimeout(_ms: number, onTimeout: () => void): this {
          this.onTimeout = onTimeout;
          return this;
        }
        destroy(error: Error): void {
          response.destroy(error);
          this.emit("error", error);
        }
      }
      const request = new FakeRequest();
      callback(response as unknown as IncomingMessage);
      const end = Math.min(start + cut, content.length);
      queueMicrotask(() => {
        response.write(content.subarray(start, end));
        if (end === content.length) response.end();
        else void onDisk(part, end).then(() => request.onTimeout?.());
      });
      return request as unknown as ClientRequest;
    }) as typeof httpsGet;
  }

  it("resumes a download that stalls at the same byte count on every connection", async () => {
    const content = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251));
    const ranges: (string | undefined)[] = [];
    const dir = mkdtempSync(join(tmpdir(), "hyperframes-download-"));
    tempDirs.push(dir);
    const dest = join(dir, "model.onnx");
    mockGet.mockImplementation(stallingHost(content, 300, true, ranges, `${dest}.part`));
    const progress: number[] = [];

    await downloadFile("https://example.test/model.onnx", dest, {
      timeoutMs: 10,
      onProgress: (received) => progress.push(received),
    });

    expect(readFileSync(dest).equals(content)).toBe(true);
    expect(ranges).toEqual([undefined, "bytes=300-", "bytes=600-", "bytes=900-"]);
    expect(progress.at(-1)).toBe(1000);
    expect(readdirSync(dir)).toEqual(["model.onnx"]);
  });

  it("resumes from the bytes on disk when a reset drops chunks the file had not written", async () => {
    const chunk = 64 * 1024;
    const content = Buffer.from(Array.from({ length: 64 * chunk }, (_, i) => (i * 7) % 256));
    const ranges: (string | undefined)[] = [];
    const dir = mkdtempSync(join(tmpdir(), "hyperframes-download-"));
    tempDirs.push(dir);
    const dest = join(dir, "model.onnx");
    mockGet.mockImplementation(((
      _url: string,
      optionsOrCallback: unknown,
      maybeCallback?: unknown,
    ) => {
      const callback = (
        typeof optionsOrCallback === "function" ? optionsOrCallback : maybeCallback
      ) as (response: IncomingMessage) => void;
      const range = (optionsOrCallback as { headers?: { Range?: string } }).headers?.Range;
      ranges.push(range);
      const start = range ? Number(/bytes=(\d+)-/.exec(range)?.[1]) : 0;
      const response = new PassThrough({ highWaterMark: chunk }) as PassThrough & {
        statusCode: number;
        headers: Record<string, string>;
      };
      response.statusCode = start > 0 ? 206 : 200;
      response.headers = {
        "content-length": String(content.length - start),
        ...(start > 0
          ? { "content-range": `bytes ${start}-${content.length - 1}/${content.length}` }
          : {}),
      };
      const request = new EventEmitter() as ClientRequest;
      request.setTimeout = vi.fn().mockReturnValue(request);
      callback(response as unknown as IncomingMessage);
      queueMicrotask(() => {
        if (start > 0) {
          response.end(content.subarray(start));
          return;
        }
        // A quarter lands on disk; then a burst arrives and the connection resets before the file writes it.
        const quarter = content.length / 4;
        for (let at = 0; at < quarter; at += chunk)
          response.write(content.subarray(at, at + chunk));
        const written = setInterval(() => {
          const partial = readdirSync(dir).find((name) => name.endsWith(".part"));
          if (!partial || fs.statSync(join(dir, partial)).size < quarter) return;
          clearInterval(written);
          for (let at = quarter; at < 2 * quarter; at += chunk)
            response.write(content.subarray(at, at + chunk));
          response.destroy(new Error("socket hang up"));
        }, 1);
      });
      return request;
    }) as typeof httpsGet);

    await downloadFile("https://example.test/model.onnx", dest, { timeoutMs: 1000 });

    expect(ranges).toHaveLength(2);
    expect(readFileSync(dest).equals(content)).toBe(true);
  });

  it("keeps a slow download going past the timeout while bytes still arrive", async () => {
    const content = Buffer.alloc(200, 3);
    mockGet.mockImplementation(((_url: string, callback: (response: IncomingMessage) => void) => {
      const response = new PassThrough() as PassThrough & {
        statusCode: number;
        headers: Record<string, string>;
      };
      response.statusCode = 200;
      response.headers = { "content-length": "200" };
      class FakeRequest extends EventEmitter {
        private timeout: ReturnType<typeof setTimeout> | undefined;
        private onTimeout = () => {};
        private ms = 0;
        // Like a socket idle timeout: each received chunk re-arms it.
        setTimeout(ms: number, onTimeout: () => void): this {
          this.ms = ms;
          this.onTimeout = onTimeout;
          this.rearm();
          return this;
        }
        rearm(): void {
          clearTimeout(this.timeout);
          this.timeout = setTimeout(this.onTimeout, this.ms);
        }
        destroy(error: Error): void {
          clearTimeout(this.timeout);
          clearInterval(drip);
          response.destroy(error);
          this.emit("error", error);
        }
      }
      const request = new FakeRequest();
      callback(response as unknown as IncomingMessage);
      let sent = 0;
      const drip = setInterval(() => {
        response.write(content.subarray(sent, sent + 10));
        sent += 10;
        request.rearm();
        if (sent >= content.length) {
          clearInterval(drip);
          request.destroy = () => {};
          response.end();
        }
      }, 5);
      return request as unknown as ClientRequest;
    }) as typeof httpsGet);
    const dir = mkdtempSync(join(tmpdir(), "hyperframes-download-"));
    tempDirs.push(dir);
    const dest = join(dir, "model.onnx");
    const started = Date.now();

    await downloadFile("https://example.test/model.onnx", dest, { timeoutMs: 25 });

    expect(Date.now() - started).toBeGreaterThan(25 * 2);
    expect(readFileSync(dest).equals(content)).toBe(true);
  });

  it("gives up when a retry brings no new bytes", async () => {
    const content = Buffer.alloc(1000, 7);
    const ranges: (string | undefined)[] = [];
    const dir = mkdtempSync(join(tmpdir(), "hyperframes-download-"));
    tempDirs.push(dir);
    const dest = join(dir, "model.onnx");
    mockGet.mockImplementation(stallingHost(content, 300, false, ranges, `${dest}.part`));

    await expect(
      downloadFile("https://example.test/model.onnx", dest, { timeoutMs: 10 }),
    ).rejects.toThrow("Download timed out after 10ms");
    expect(ranges).toEqual([undefined, "bytes=300-"]);
    expect(readdirSync(dir)).toEqual([]);
  });
});

describe("redirect handling", () => {
  it("closes each redirect response before opening the next request", async () => {
    const responses: IncomingMessage[] = [];
    const capture = (response: IncomingMessage) => responses.push(response);
    mockGet
      .mockImplementationOnce(httpsResponse(302, { location: "/second" }, undefined, capture))
      .mockImplementationOnce(
        httpsResponse(307, { location: "/model" }, undefined, (response) => {
          expect(responses[0]?.destroyed).toBe(true);
          capture(response);
        }),
      )
      .mockImplementationOnce(
        httpsResponse(200, {}, "hello", () => {
          expect(responses[1]?.destroyed).toBe(true);
        }),
      );
    const dir = mkdtempSync(join(tmpdir(), "hyperframes-download-redirect-"));
    tempDirs.push(dir);
    await downloadFile("https://example.test/first", join(dir, "model"));

    expect(responses).toHaveLength(2);
    expect(responses.every((response) => response.destroyed)).toBe(true);
    expect(mockGet).toHaveBeenCalledTimes(3);
    expect(readFileSync(join(dir, "model"), "utf8")).toBe("hello");
  });

  it("does not let a discarded redirect request fail the active download", async () => {
    mockGet
      .mockImplementationOnce(httpsResponse(302, { location: "/model" }))
      .mockImplementationOnce(httpsResponse(200, {}, "hello"));
    const dir = mkdtempSync(join(tmpdir(), "hyperframes-download-redirect-"));
    tempDirs.push(dir);
    const pending = downloadFile("https://example.test/first", join(dir, "model"));
    const firstRequest = mockGet.mock.results[0]?.value;
    firstRequest?.emit("error", new Error("old redirect socket failed"));

    await expect(pending).resolves.toBeUndefined();
    expect(readFileSync(join(dir, "model"), "utf8")).toBe("hello");
    expect(readdirSync(dir)).toEqual(["model"]);
  });

  it("closes redirect loop responses when reaching the hop limit", async () => {
    const responses: IncomingMessage[] = [];
    mockGet.mockImplementation(
      httpsResponse(302, { location: "/loop" }, undefined, (response) => responses.push(response)),
    );
    const dir = mkdtempSync(join(tmpdir(), "hyperframes-download-redirect-"));
    tempDirs.push(dir);

    await expect(downloadFile("https://example.test/loop", join(dir, "model"))).rejects.toThrow(
      "more than 10 redirects",
    );
    expect(responses).toHaveLength(11);
    expect(responses.every((response) => response.destroyed)).toBe(true);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("keeps a signed query out of the redirect-limit error", async () => {
    mockGet.mockImplementation(httpsResponse(302, { location: "/loop" }));
    const dir = mkdtempSync(join(tmpdir(), "hyperframes-download-redirect-"));
    tempDirs.push(dir);

    const error = await downloadFile(
      "https://example.test/handler.zip?X-Amz-Signature=secret",
      join(dir, "handler.zip"),
    ).then(
      () => {
        throw new Error("expected the download to fail");
      },
      (caught: unknown) => caught as Error,
    );
    expect(error.message).toContain("https://example.test/handler.zip");
    expect(error.message).not.toContain("secret");
  });

  it.each([302, 404, 503])("closes rejected HTTP %s responses", async (status) => {
    const responses: IncomingMessage[] = [];
    mockGet.mockImplementation(
      httpsResponse(status, {}, undefined, (response) => responses.push(response)),
    );
    const dir = mkdtempSync(join(tmpdir(), "hyperframes-download-http-error-"));
    tempDirs.push(dir);

    await expect(downloadFile("https://example.test/model", join(dir, "model"))).rejects.toThrow(
      `HTTP ${status}`,
    );
    expect(responses[0]?.destroyed).toBe(true);
    expect(readdirSync(dir)).toEqual([]);
  });

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

describe("resuming across runs", () => {
  const url = "https://example.test/model.onnx";
  const deadPid = () => spawnSync(process.execPath, ["-e", ""]).pid;

  type Headers = Record<string, string> | undefined;

  function getArgs(optionsOrCallback: unknown, maybeCallback?: unknown) {
    if (typeof optionsOrCallback === "function") {
      return { headers: undefined, callback: optionsOrCallback as (r: IncomingMessage) => void };
    }
    const { headers } = optionsOrCallback as { headers?: Record<string, string> };
    return { headers, callback: maybeCallback as (r: IncomingMessage) => void };
  }

  function rangeStart(headers: Headers, etag: string): number {
    const asked = Number(/bytes=(\d+)-/.exec(headers?.Range ?? "")?.[1] ?? 0);
    return (headers?.["If-Range"] ?? etag) === etag ? asked : 0;
  }

  function rangedResponse(file: string, etag: string, start: number) {
    const range = { etag, "content-range": `bytes ${start}-${file.length - 1}/${file.length}` };
    return Object.assign(new PassThrough(), {
      statusCode: start ? 206 : 200,
      headers: start ? range : { etag, "content-length": String(file.length) },
    });
  }

  /** A host that honours `Range`, and `If-Range` only while the file still has `etag`. */
  function rangedHost(file: string, etag: string, seen: Headers[]) {
    return ((_url: string, optionsOrCallback: unknown, maybeCallback?: unknown) => {
      const { headers, callback } = getArgs(optionsOrCallback, maybeCallback);
      seen.push(headers);
      const start = rangeStart(headers, etag);
      const response = rangedResponse(file, etag, start);
      const request = new EventEmitter() as ClientRequest;
      request.setTimeout = vi.fn();
      callback(response as unknown as IncomingMessage);
      queueMicrotask(() => response.end(file.slice(start)));
      return request;
    }) as typeof httpsGet;
  }

  /** What a run stopped mid-download leaves: the partial bytes, their validator and its lock. */
  function stoppedRun(partial: string, etag: string): { dir: string; dest: string } {
    const dir = mkdtempSync(join(tmpdir(), "hyperframes-download-"));
    tempDirs.push(dir);
    const dest = join(dir, "model.onnx");
    writeFileSync(`${dest}.part`, partial);
    writeFileSync(`${dest}.part.json`, JSON.stringify({ url, etag }));
    writeFileSync(`${dest}.lock`, String(deadPid()));
    return { dir, dest };
  }

  it("finishes the one partial file a run stopped mid-download left behind", async () => {
    const { dir, dest } = stoppedRun("hel", '"v1"');
    const seen: Headers[] = [];
    mockGet.mockImplementation(rangedHost("hello", '"v1"', seen));

    await downloadFile(url, dest);

    expect(seen[0]).toMatchObject({ Range: "bytes=3-", "If-Range": '"v1"' });
    expect(readFileSync(dest, "utf8")).toBe("hello");
    expect(readdirSync(dir)).toEqual(["model.onnx"]);
  });

  it("downloads a file that changed since the stopped run whole, never stitched", async () => {
    const { dir, dest } = stoppedRun("hel", '"v1"');
    mockGet.mockImplementation(rangedHost("HELLO", '"v2"', []));

    await downloadFile(url, dest);

    expect(readFileSync(dest, "utf8")).toBe("HELLO");
    expect(readdirSync(dir)).toEqual(["model.onnx"]);
  });

  it("keeps the partial file for the next run when a resumed attempt gets no bytes", async () => {
    const { dest } = stoppedRun("hel", '"v1"');
    mockGet.mockImplementation((() => {
      const request = new EventEmitter() as ClientRequest;
      request.setTimeout = vi.fn();
      queueMicrotask(() => request.emit("error", new Error("socket hang up")));
      return request;
    }) as unknown as typeof httpsGet);

    await expect(downloadFile(url, dest)).rejects.toThrow("socket hang up");

    expect(readFileSync(`${dest}.part`, "utf8")).toBe("hel");
    expect(existsSync(`${dest}.part.json`)).toBe(true);
    expect(existsSync(`${dest}.lock`)).toBe(false);
  });

  it("removes partial files stopped runs named by process, but not a live run's", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hyperframes-download-"));
    tempDirs.push(dir);
    const dest = join(dir, "model.onnx");
    const stray = `model.onnx.${deadPid()}.${randomUUID()}.tmp`;
    const live = `model.onnx.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(join(dir, stray), "stale");
    writeFileSync(join(dir, live), "in use");
    mockGet.mockImplementation(rangedHost("hello", '"v1"', []));

    await downloadFile(url, dest);

    expect(readdirSync(dir).sort()).toEqual([live, "model.onnx"].sort());
  });

  it("takes over a lock a past run left under this process's pid", async () => {
    const { dir, dest } = stoppedRun("hel", '"v1"');
    writeFileSync(`${dest}.lock`, String(process.pid));
    mockGet.mockImplementation(rangedHost("hello", '"v1"', []));

    await downloadFile(url, dest, { signal: AbortSignal.timeout(2000) });

    expect(readFileSync(dest, "utf8")).toBe("hello");
    expect(readdirSync(dir)).toEqual(["model.onnx"]);
  });

  it("discards a finished file its check refuses", async () => {
    const { dir, dest } = stoppedRun("hel", '"v1"');
    mockGet.mockImplementation(rangedHost("hello", '"v1"', []));

    await expect(
      downloadFile(url, dest, { verify: async () => Promise.reject(new Error("bad sha")) }),
    ).rejects.toThrow("bad sha");

    expect(readdirSync(dir)).toEqual([]);
  });
});
