// fallow-ignore-file code-duplication
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  assertPublicHttpsUrl,
  downloadToTemp,
  fetchPublicHttpsText,
  UrlDownloadError,
} from "./urlDownloader.js";

const fsRaceControls = vi.hoisted(() => ({
  deleteBeforeLstatPath: undefined as string | undefined,
  deleteInjectedWinnerBeforeLstatPath: undefined as string | undefined,
  injectRaceAtLinkPath: undefined as string | undefined,
  deleteBeforeReadPath: undefined as string | undefined,
  replaceStaleLockAfterObservationPath: undefined as string | undefined,
  replaceLockOnReleasePath: undefined as string | undefined,
}));

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    lstatSync: ((...args: unknown[]) => {
      const path = String(args[0]);
      if (path === fsRaceControls.deleteBeforeLstatPath) {
        fsRaceControls.deleteBeforeLstatPath = undefined;
        actual.rmSync(path, { force: true });
      }
      if (path === fsRaceControls.deleteInjectedWinnerBeforeLstatPath && actual.existsSync(path)) {
        fsRaceControls.deleteInjectedWinnerBeforeLstatPath = undefined;
        actual.rmSync(path, { force: true });
      }
      return Reflect.apply(actual.lstatSync, actual, args);
    }) as typeof actual.lstatSync,
    readdirSync: ((...args: unknown[]) => {
      const path = String(args[0]);
      const observed = Reflect.apply(actual.readdirSync, actual, args);
      if (path === fsRaceControls.replaceStaleLockAfterObservationPath) {
        fsRaceControls.replaceStaleLockAfterObservationPath = undefined;
        actual.rmSync(path, { recursive: true, force: true });
        actual.mkdirSync(path);
        actual.mkdirSync(join(path, ".hf-owner-successor"));
      }
      return observed;
    }) as typeof actual.readdirSync,
    rmdirSync: ((...args: unknown[]) => {
      const path = String(args[0]);
      if (path === fsRaceControls.replaceLockOnReleasePath) {
        fsRaceControls.replaceLockOnReleasePath = undefined;
        actual.rmSync(path, { recursive: true, force: true });
        actual.mkdirSync(path);
        actual.mkdirSync(join(path, ".hf-owner-successor"));
      }
      return Reflect.apply(actual.rmdirSync, actual, args);
    }) as typeof actual.rmdirSync,
    linkSync: ((...args: unknown[]) => {
      const destination = String(args[1]);
      if (destination === fsRaceControls.injectRaceAtLinkPath) {
        fsRaceControls.injectRaceAtLinkPath = undefined;
        actual.writeFileSync(destination, "concurrent-winner");
      }
      return Reflect.apply(actual.linkSync, actual, args);
    }) as typeof actual.linkSync,
    createReadStream: ((...args: unknown[]) => {
      const path = String(args[0]);
      if (path === fsRaceControls.deleteBeforeReadPath) {
        fsRaceControls.deleteBeforeReadPath = undefined;
        actual.rmSync(path, { force: true });
      }
      return Reflect.apply(actual.createReadStream, actual, args);
    }) as typeof actual.createReadStream,
  };
});

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-url-download-"));
  tempDirs.push(dir);
  return dir;
}

function temporaryDownloadEntries(dir: string): string[] {
  return readdirSync(dir).filter(
    (name) =>
      name.includes(".partial-") || name.startsWith(".hf-download-") || name.endsWith(".hf-lock"),
  );
}

function isoBmffMediaBytes(marker: string): Buffer {
  const ftyp = Buffer.alloc(24);
  ftyp.writeUInt32BE(24, 0);
  ftyp.write("ftyp", 4, 4, "ascii");
  ftyp.write("isom", 8, 4, "ascii");
  ftyp.writeUInt32BE(0, 12);
  ftyp.write("isom", 16, 4, "ascii");
  ftyp.write("mp42", 20, 4, "ascii");
  return Buffer.concat([ftyp, Buffer.from(marker)]);
}

afterEach(() => {
  vi.unstubAllGlobals();
  fsRaceControls.deleteBeforeLstatPath = undefined;
  fsRaceControls.deleteInjectedWinnerBeforeLstatPath = undefined;
  fsRaceControls.injectRaceAtLinkPath = undefined;
  fsRaceControls.deleteBeforeReadPath = undefined;
  fsRaceControls.replaceStaleLockAfterObservationPath = undefined;
  fsRaceControls.replaceLockOnReleasePath = undefined;
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("assertPublicHttpsUrl — SSRF guard", () => {
  it("accepts public HTTPS URLs", () => {
    expect(() =>
      assertPublicHttpsUrl("https://gen-os-static.s3.us-east-2.amazonaws.com/fonts/font.ttf"),
    ).not.toThrow();
    expect(() => assertPublicHttpsUrl("https://cdn.jsdelivr.net/npm/gsap.min.js")).not.toThrow();
    expect(() => assertPublicHttpsUrl("https://fonts.gstatic.com/s/font.woff2")).not.toThrow();
  });

  it("rejects http:// (non-HTTPS)", () => {
    expect(() => assertPublicHttpsUrl("http://example.com/font.ttf")).toThrow("Only HTTPS");
  });

  it("rejects AWS IMDS (169.254.169.254)", () => {
    expect(() =>
      assertPublicHttpsUrl("https://169.254.169.254/latest/meta-data/iam/security-credentials/"),
    ).toThrow("private/reserved");
    expect(() => assertPublicHttpsUrl("http://169.254.169.254/latest/user-data")).toThrow();
  });

  it("rejects loopback (127.x.x.x)", () => {
    expect(() => assertPublicHttpsUrl("https://127.0.0.1/font.ttf")).toThrow("private/reserved");
    expect(() => assertPublicHttpsUrl("https://127.1.2.3/secret")).toThrow("private/reserved");
  });

  it("rejects localhost", () => {
    expect(() => assertPublicHttpsUrl("https://localhost/font.ttf")).toThrow("private/reserved");
    expect(() => assertPublicHttpsUrl("http://localhost:3000/secret")).toThrow();
  });

  it("rejects RFC1918 — 10.x", () => {
    expect(() => assertPublicHttpsUrl("https://10.0.0.1/secret")).toThrow("private/reserved");
    expect(() => assertPublicHttpsUrl("https://10.255.255.255/secret")).toThrow("private/reserved");
  });

  it("rejects RFC1918 — 172.16–172.31", () => {
    expect(() => assertPublicHttpsUrl("https://172.16.0.1/secret")).toThrow("private/reserved");
    expect(() => assertPublicHttpsUrl("https://172.31.255.255/secret")).toThrow("private/reserved");
  });

  it("allows 172.0–172.15 and 172.32+ (not RFC1918)", () => {
    expect(() => assertPublicHttpsUrl("https://172.15.0.1/font.ttf")).not.toThrow();
    expect(() => assertPublicHttpsUrl("https://172.32.0.1/font.ttf")).not.toThrow();
  });

  it("rejects RFC1918 — 192.168.x", () => {
    expect(() => assertPublicHttpsUrl("https://192.168.1.1/secret")).toThrow("private/reserved");
  });

  it("rejects unspecified address (0.x)", () => {
    expect(() => assertPublicHttpsUrl("https://0.0.0.0/secret")).toThrow("private/reserved");
  });

  it("rejects loopback IPv6 ([::1])", () => {
    expect(() => assertPublicHttpsUrl("https://[::1]/secret")).toThrow("private/reserved");
  });

  it("rejects normalized reserved IPv6 and IPv4-mapped forms", () => {
    for (const url of [
      "https://[::]/secret",
      "https://[fe80::1]/secret",
      "https://[fc00::1]/secret",
      "https://[::ffff:127.0.0.1]/secret",
      "https://[::ffff:169.254.169.254]/latest/meta-data/",
    ]) {
      expect(() => assertPublicHttpsUrl(url), url).toThrow("private/reserved");
    }
  });

  it("rejects CGNAT and other non-public IPv4 ranges", () => {
    for (const url of [
      "https://100.64.0.1/secret",
      "https://198.18.0.1/secret",
      "https://192.0.2.1/secret",
      "https://224.0.0.1/secret",
      "https://240.0.0.1/secret",
      "https://255.255.255.255/secret",
    ]) {
      expect(() => assertPublicHttpsUrl(url), url).toThrow("private/reserved");
    }
  });

  it("rejects invalid URLs", () => {
    expect(() => assertPublicHttpsUrl("not-a-url")).toThrow("Invalid URL");
    expect(() => assertPublicHttpsUrl("")).toThrow("Invalid URL");
  });

  it("never echoes a rejected signed URL in diagnostics", () => {
    const signed = "http://127.0.0.1/private/customer.mp4?X-Amz-Signature=super-secret";
    let message = "";
    try {
      assertPublicHttpsUrl(signed);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).not.toContain("customer.mp4");
    expect(message).not.toContain("super-secret");
  });
});

describe("fetchPublicHttpsText", () => {
  it("validates every redirect before issuing the next request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "https://169.254.169.254/latest/meta-data/" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchPublicHttpsText("https://styles.example/fonts.css", { maxBytes: 1024 }),
    ).rejects.toMatchObject({ kind: "http_rejected", retryable: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("enforces the byte cap while consuming a chunked response", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("123456"));
        controller.enqueue(new TextEncoder().encode("789012"));
      },
      cancel() {
        cancelled = true;
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));

    await expect(
      fetchPublicHttpsText("https://styles.example/large.css", { maxBytes: 10 }),
    ).rejects.toMatchObject({ kind: "length_mismatch", retryable: false });
    expect(cancelled).toBe(true);
  });

  it("keeps the timeout active while the response body is stalled", async () => {
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("partial"));
          init.signal?.addEventListener(
            "abort",
            () => controller.error(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        },
      });
      return new Response(body);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchPublicHttpsText("https://styles.example/stalled.css", {
        maxBytes: 1024,
        timeoutMs: 20,
      }),
    ).rejects.toMatchObject({ kind: "timeout", retryable: true });
  });
});

describe("downloadToTemp atomic publication and bounded retry", () => {
  it("follows a bounded redirect only after validating the next public HTTPS hop", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://media.example/final.mp4" },
        }),
      )
      .mockResolvedValueOnce(new Response("complete"));
    vi.stubGlobal("fetch", fetchMock);
    const dir = makeTempDir();

    const path = await downloadToTemp("https://cdn.example/redirect.mp4", dir, 1_000);

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://media.example/final.mp4",
      expect.objectContaining({
        redirect: "manual",
        headers: { "accept-encoding": "identity" },
      }),
    );
    expect(readFileSync(path, "utf8")).toBe("complete");
    expect(temporaryDownloadEntries(dir)).toEqual([]);
  });

  it("rejects a public redirect to a private host before issuing the second request", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data/" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const dir = makeTempDir();

    await expect(
      downloadToTemp("https://cdn.example/private-redirect.mp4", dir, 1_000),
    ).rejects.toMatchObject({
      kind: "http_rejected",
      retryable: false,
    } satisfies Partial<UrlDownloadError>);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(temporaryDownloadEntries(dir)).toEqual([]);
  });

  it("rejects an IPv4-mapped IMDS redirect before issuing the second request", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "https://[::ffff:169.254.169.254]/latest/meta-data/" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const dir = makeTempDir();

    await expect(
      downloadToTemp("https://cdn.example/mapped-private-redirect.mp4", dir, 1_000),
    ).rejects.toMatchObject({
      kind: "http_rejected",
      retryable: false,
    } satisfies Partial<UrlDownloadError>);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries one HTTP 503 and publishes only the complete final file", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503, statusText: "Service Unavailable" }))
      .mockResolvedValueOnce(new Response("complete"));
    vi.stubGlobal("fetch", fetchMock);
    const dir = makeTempDir();
    const onTransientRetry = vi.fn();

    const path = await downloadToTemp(
      "https://cdn.example/retry-503.mp4",
      dir,
      1_000,
      undefined,
      onTransientRetry,
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onTransientRetry).toHaveBeenCalledOnce();
    expect(onTransientRetry).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "http_transient", retryable: true }),
    );
    expect(readFileSync(path, "utf8")).toBe("complete");
    expect(temporaryDownloadEntries(dir)).toEqual([]);
  });

  it("does not expose a signed URL supplied through hostile HTTP status text", async () => {
    const signedUrl =
      "https://cdn.example/private/customer-video?X-Amz-Signature=super-secret-signature";
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 503, statusText: signedUrl }));
    vi.stubGlobal("fetch", fetchMock);
    const dir = makeTempDir();

    let message = "";
    try {
      await downloadToTemp(signedUrl, dir, 1_000);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(message).toBe("HTTP 503");
    expect(message).not.toContain("customer-video");
    expect(message).not.toContain("super-secret-signature");
  });

  it("rejects a truncated Content-Length response and cleanly refetches once", async () => {
    const complete = isoBmffMediaBytes("complete");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(complete.subarray(0, complete.length - 1), {
          headers: { "content-length": String(complete.length) },
        }),
      )
      .mockResolvedValueOnce(
        new Response(complete, { headers: { "content-length": String(complete.length) } }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const dir = makeTempDir();
    const onTransientRetry = vi.fn();

    const path = await downloadToTemp(
      "https://cdn.example/truncated.mp4",
      dir,
      1_000,
      undefined,
      onTransientRetry,
      {},
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onTransientRetry).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "length_mismatch", retryable: true }),
    );
    expect(readFileSync(path)).toEqual(complete);
    expect(temporaryDownloadEntries(dir)).toEqual([]);
  });

  it("does not publish after two repeated length mismatches", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(new Response("short", { headers: { "content-length": "12" } })),
      );
    vi.stubGlobal("fetch", fetchMock);
    const dir = makeTempDir();

    await expect(
      downloadToTemp("https://cdn.example/always-short.mp4", dir, 1_000),
    ).rejects.toMatchObject({
      kind: "length_mismatch",
      retryable: true,
    } satisfies Partial<UrlDownloadError>);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(readdirSync(dir).filter((name) => name.startsWith("download_"))).toEqual([]);
    expect(temporaryDownloadEntries(dir)).toEqual([]);
  });

  it("rejects an unsolicited well-formed 206 and succeeds after one clean refetch", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("part", {
          status: 206,
          headers: { "content-range": "bytes 0-3/8", "content-length": "4" },
        }),
      )
      .mockResolvedValueOnce(new Response("complete", { headers: { "content-length": "8" } }));
    vi.stubGlobal("fetch", fetchMock);
    const dir = makeTempDir();

    const path = await downloadToTemp("https://cdn.example/unsolicited-range.mp4", dir, 1_000);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(readFileSync(path, "utf8")).toBe("complete");
    expect(temporaryDownloadEntries(dir)).toEqual([]);
  });

  it("rejects malformed 206 responses after exactly one refetch", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("part", {
        status: 206,
        headers: { "content-range": "bytes nonsense" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const dir = makeTempDir();

    await expect(
      downloadToTemp("https://cdn.example/malformed-range.mp4", dir, 1_000),
    ).rejects.toMatchObject({
      kind: "range_protocol",
      retryable: true,
      telemetry: expect.objectContaining({ rangeDisposition: "malformed_206" }),
    } satisfies Partial<UrlDownloadError>);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(temporaryDownloadEntries(dir)).toEqual([]);
  });

  it("accepts a complete identity-encoded object with a noncompliant Content-Range on 200", async () => {
    const onTelemetry = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("complete", {
        status: 200,
        headers: { "content-range": "bytes 0-7/8", "content-length": "8" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const dir = makeTempDir();

    const path = await downloadToTemp(
      "https://cdn.example/full-range-on-200.mp4",
      dir,
      1_000,
      undefined,
      undefined,
      { onTelemetry },
    );

    expect(readFileSync(path, "utf8")).toBe("complete");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "published", rangeDisposition: "full_object_200" }),
    );
  });

  it("rejects Content-Range on a 200 response without a matching declared length", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("complete", {
        status: 200,
        headers: { "content-range": "bytes 0-7/8" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const dir = makeTempDir();

    await expect(
      downloadToTemp("https://cdn.example/range-on-200.mp4", dir, 1_000),
    ).rejects.toMatchObject({
      kind: "range_protocol",
      retryable: true,
    } satisfies Partial<UrlDownloadError>);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects a full-object Content-Range when the streamed body is shorter than declared", async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response("short", {
          status: 200,
          headers: { "content-range": "bytes 0-7/8", "content-length": "8" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const dir = makeTempDir();

    await expect(
      downloadToTemp("https://cdn.example/short-full-range-on-200.mp4", dir, 1_000),
    ).rejects.toMatchObject({
      kind: "length_mismatch",
      retryable: true,
      telemetry: expect.objectContaining({ rangeDisposition: "full_object_200" }),
    } satisfies Partial<UrlDownloadError>);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(temporaryDownloadEntries(dir)).toEqual([]);
  });

  it.each([
    ["partial object", "bytes 0-3/8", "4", undefined],
    ["nonzero start", "bytes 1-7/8", "8", undefined],
    ["wildcard total", "bytes 0-7/*", "8", undefined],
    ["mismatched length", "bytes 0-7/8", "7", undefined],
    ["unsafe integer", "bytes 0-9007199254740991/9007199254740992", "8", undefined],
    ["encoded body", "bytes 0-7/8", "8", "gzip"],
  ])("rejects a %s Content-Range on 200", async (_case, range, length, encoding) => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("complete", {
        status: 200,
        headers: {
          "content-range": range,
          "content-length": length,
          ...(encoding ? { "content-encoding": encoding } : {}),
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const dir = makeTempDir();

    await expect(
      downloadToTemp("https://cdn.example/invalid-range-on-200.mp4", dir, 1_000),
    ).rejects.toMatchObject({
      kind: "range_protocol",
      retryable: true,
      telemetry: expect.objectContaining({ rangeDisposition: "content_range_on_200" }),
    } satisfies Partial<UrlDownloadError>);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a checksum mismatch once and publishes only matching bytes", async () => {
    const corrupt = isoBmffMediaBytes("corrupt");
    const complete = isoBmffMediaBytes("complete");
    const expectedSha256 = createHash("sha256").update(complete).digest("hex");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(corrupt))
      .mockResolvedValueOnce(new Response(complete));
    vi.stubGlobal("fetch", fetchMock);
    const dir = makeTempDir();

    const path = await downloadToTemp(
      "https://cdn.example/checksum.mp4",
      dir,
      1_000,
      undefined,
      undefined,
      { expectedSha256 },
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(readFileSync(path)).toEqual(complete);
  });

  it("rejects a malformed caller checksum before fetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const dir = makeTempDir();

    await expect(
      downloadToTemp("https://cdn.example/checksum.mp4", dir, 1_000, undefined, undefined, {
        expectedSha256: "not-a-sha256",
      }),
    ).rejects.toMatchObject({ kind: "hash_mismatch", retryable: false });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(readdirSync(dir)).toEqual([]);
  });

  it("locally refetches a caller checksum mismatch but keeps the final error non-retryable", async () => {
    const bytes = isoBmffMediaBytes("always-wrong");
    const expectedSha256 = createHash("sha256").update("different").digest("hex");
    const serverSha256 = createHash("sha256").update(bytes).digest("base64");
    const contentMd5 = createHash("md5").update(bytes).digest("base64");
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(bytes, {
          headers: { "x-amz-checksum-sha256": serverSha256, "content-md5": contentMd5 },
        }),
      ),
    );
    const onTransientRetry = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const dir = makeTempDir();

    await expect(
      downloadToTemp(
        "https://cdn.example/caller-checksum.mp4",
        dir,
        1_000,
        undefined,
        onTransientRetry,
        { expectedSha256 },
      ),
    ).rejects.toMatchObject({
      kind: "hash_mismatch",
      retryable: false,
      locallyRetryable: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onTransientRetry).not.toHaveBeenCalled();
  });

  it("prefers a matching caller SHA-256 over contradictory server checksums", async () => {
    const bytes = isoBmffMediaBytes("caller-authoritative");
    const callerSha256 = createHash("sha256").update(bytes).digest("hex");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(bytes, {
        headers: {
          "x-amz-checksum-sha256": Buffer.from("wrong-sha256").toString("base64"),
          "content-md5": Buffer.from("wrong-md5").toString("base64"),
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const dir = makeTempDir();

    const path = await downloadToTemp(
      "https://cdn.example/caller-authoritative.mp4",
      dir,
      1_000,
      undefined,
      undefined,
      { expectedSha256: callerSha256 },
    );

    expect(readFileSync(path)).toEqual(bytes);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("prefers a matching server SHA-256 over a contradictory Content-MD5", async () => {
    const bytes = isoBmffMediaBytes("server-sha-authoritative");
    const serverSha256 = createHash("sha256").update(bytes).digest("base64");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(bytes, {
        headers: {
          "x-amz-checksum-sha256": serverSha256,
          "content-md5": Buffer.from("wrong-md5").toString("base64"),
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const dir = makeTempDir();

    const path = await downloadToTemp("https://cdn.example/server-sha.mp4", dir, 1_000);

    expect(readFileSync(path)).toEqual(bytes);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("accepts a matching Content-MD5 when no SHA-256 is available", async () => {
    const bytes = isoBmffMediaBytes("legacy-md5");
    const contentMd5 = createHash("md5").update(bytes).digest("base64");
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(bytes, { headers: { "content-md5": contentMd5 } }));
    vi.stubGlobal("fetch", fetchMock);
    const dir = makeTempDir();

    const path = await downloadToTemp("https://cdn.example/legacy-md5.mp4", dir, 1_000);

    expect(readFileSync(path)).toEqual(bytes);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps repeated Content-MD5 mismatches retryable upstream", async () => {
    const bytes = isoBmffMediaBytes("legacy-md5-mismatch");
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(bytes, {
          headers: { "content-md5": Buffer.from("wrong-md5").toString("base64") },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const dir = makeTempDir();

    await expect(
      downloadToTemp("https://cdn.example/legacy-md5-mismatch.mp4", dir, 1_000),
    ).rejects.toMatchObject({ kind: "hash_mismatch", retryable: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps repeated server checksum mismatches retryable upstream", async () => {
    const bytes = isoBmffMediaBytes("server-corrupt");
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(bytes, {
          headers: { digest: `sha-256=${Buffer.from("wrong-checksum").toString("base64")}` },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const dir = makeTempDir();

    await expect(
      downloadToTemp("https://cdn.example/server-checksum.mp4", dir, 1_000),
    ).rejects.toMatchObject({ kind: "hash_mismatch", retryable: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("ignores S3 composite checksums that are not full-object SHA-256", async () => {
    const mediaBytes = isoBmffMediaBytes("multipart-object");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(mediaBytes, {
        headers: {
          "x-amz-checksum-sha256": Buffer.from("not-a-full-object-checksum").toString("base64"),
          "x-amz-checksum-type": "COMPOSITE",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const dir = makeTempDir();

    const path = await downloadToTemp(
      "https://cdn.example/multipart.mp4",
      dir,
      1_000,
      undefined,
      undefined,
      {},
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(readFileSync(path)).toEqual(mediaBytes);
  });

  it("rejects an HTML-as-200 media payload without retrying", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("  <!doctype html><html><body>denied</body></html>"));
    vi.stubGlobal("fetch", fetchMock);
    const dir = makeTempDir();

    await expect(
      downloadToTemp("https://cdn.example/html-error.mp4", dir, 1_000, undefined, undefined, {}),
    ).rejects.toMatchObject({
      kind: "invalid_payload",
      retryable: false,
    } satisfies Partial<UrlDownloadError>);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(temporaryDownloadEntries(dir)).toEqual([]);
  });

  it("rejects a BOM-prefixed remote error document without retrying", async () => {
    const payload = Buffer.from("\uFEFF  <!doctype html><html><body>denied</body></html>");
    const fetchMock = vi.fn().mockResolvedValue(new Response(payload));
    vi.stubGlobal("fetch", fetchMock);
    const dir = makeTempDir();

    await expect(
      downloadToTemp("https://cdn.example/bom-error.mp4", dir, 1_000),
    ).rejects.toMatchObject({ kind: "invalid_payload", retryable: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(readdirSync(dir).filter((name) => name.startsWith("download_"))).toEqual([]);
  });

  it("invalidates a cached HTML error document before localizing a font", async () => {
    const url = "https://cdn.example/font.woff2";
    const dir = makeTempDir();
    const cacheName = `download_${createHash("md5").update(url).digest("hex").slice(0, 12)}.woff2`;
    const cachePath = join(dir, cacheName);
    writeFileSync(cachePath, "<!doctype html><html>expired</html>");
    const fontBytes = Buffer.from("wOF2valid-font-payload");
    const fetchMock = vi.fn().mockResolvedValue(new Response(fontBytes));
    vi.stubGlobal("fetch", fetchMock);

    const path = await downloadToTemp(url, dir, 1_000);

    expect(path).toBe(cachePath);
    expect(readFileSync(path)).toEqual(fontBytes);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(temporaryDownloadEntries(dir)).toEqual([]);
  });

  it("rejects a JSON error document served as video without retrying", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{"message":"access denied"}', {
        headers: { "content-type": "video/mp4" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const dir = makeTempDir();

    await expect(
      downloadToTemp(
        "https://cdn.example/wrong-signature.mp4",
        dir,
        1_000,
        undefined,
        undefined,
        {},
      ),
    ).rejects.toMatchObject({ kind: "invalid_payload", retryable: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(readdirSync(dir).filter((name) => name.startsWith("download_"))).toEqual([]);
  });

  it("accepts valid media bytes through a wrong-MIME redirect", async () => {
    const mediaBytes = isoBmffMediaBytes("wrong-mime");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://media.example/asset" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(mediaBytes, { headers: { "content-type": "text/html" } }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const dir = makeTempDir();

    const path = await downloadToTemp(
      "https://cdn.example/wrong-mime",
      dir,
      1_000,
      undefined,
      undefined,
      {},
    );

    expect(readFileSync(path)).toEqual(mediaBytes);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("accepts extensionless media and emits safe complete integrity telemetry", async () => {
    const mediaBytes = isoBmffMediaBytes("extensionless");
    const etag = '"customer-secret-etag"';
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(mediaBytes, {
        headers: { "content-length": String(mediaBytes.length), etag },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const dir = makeTempDir();
    const events: unknown[] = [];
    const signedUrl =
      "https://cdn.example/private/customer-video?X-Amz-Signature=super-secret-signature";

    const path = await downloadToTemp(signedUrl, dir, 1_000, undefined, undefined, {
      onTelemetry: (event) => events.push(event),
    });

    expect(readFileSync(path)).toEqual(mediaBytes);
    expect(events).toEqual([
      expect.objectContaining({
        initialHost: "cdn.example",
        finalHost: "cdn.example",
        attempt: 1,
        outcome: "published",
        status: 200,
        expectedBytes: mediaBytes.length,
        receivedBytes: mediaBytes.length,
        localSize: mediaBytes.length,
        localSha256: createHash("sha256").update(mediaBytes).digest("hex"),
        etagFingerprint: createHash("sha256").update(etag).digest("hex"),
      }),
    ]);
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain("customer-video");
    expect(serialized).not.toContain("super-secret-signature");
    expect(serialized).not.toContain("customer-secret-etag");
  });

  it.each([
    ["aiff", Buffer.from("FORM\0\0\0\0AIFF")],
    ["caf", Buffer.from("caff\0\x01\0\0")],
    ["amr", Buffer.from("#!AMR\n")],
    ["flv", Buffer.from("FLV\x01\x05")],
  ])(
    "does not reject valid %s inputs via a duplicate format allowlist",
    async (kind, mediaBytes) => {
      const fetchMock = vi.fn().mockResolvedValue(new Response(mediaBytes));
      vi.stubGlobal("fetch", fetchMock);
      const dir = makeTempDir();

      const path = await downloadToTemp(`https://cdn.example/extensionless-${kind}`, dir, 1_000);

      expect(readFileSync(path)).toEqual(mediaBytes);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it("redacts signed URLs embedded in underlying fetch failures", async () => {
    const signedUrl =
      "https://cdn.example/private/customer-video?X-Amz-Signature=super-secret-signature";
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new TypeError(`fetch failed while requesting ${signedUrl}`));
    vi.stubGlobal("fetch", fetchMock);
    const dir = makeTempDir();

    let message = "";
    try {
      await downloadToTemp(signedUrl, dir, 1_000);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(message).toContain("transient network error");
    expect(message).not.toContain("customer-video");
    expect(message).not.toContain("super-secret-signature");
  });

  it("cancels a streaming HTTP error body before retrying", async () => {
    let errorBodyCancelled = false;
    const errorBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("error details"));
      },
      cancel() {
        errorBodyCancelled = true;
      },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(errorBody, { status: 503, statusText: "Service Unavailable" }),
      )
      .mockResolvedValueOnce(new Response("complete"));
    vi.stubGlobal("fetch", fetchMock);
    const dir = makeTempDir();

    const path = await downloadToTemp("https://cdn.example/streaming-503.mp4", dir, 1_000);

    expect(errorBodyCancelled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(readFileSync(path, "utf8")).toBe("complete");
    expect(temporaryDownloadEntries(dir)).toEqual([]);
  });

  it("does not retry a deterministic 404", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 404, statusText: "Not Found" }));
    vi.stubGlobal("fetch", fetchMock);
    const dir = makeTempDir();

    await expect(
      downloadToTemp("https://cdn.example/missing-404.mp4", dir, 1_000),
    ).rejects.toMatchObject({
      kind: "http_not_found",
      retryable: false,
      status: 404,
    } satisfies Partial<UrlDownloadError>);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(temporaryDownloadEntries(dir)).toEqual([]);
  });

  it("exhausts the transient retry budget after exactly one retry", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 503, statusText: "Service Unavailable" }));
    vi.stubGlobal("fetch", fetchMock);
    const dir = makeTempDir();

    await expect(
      downloadToTemp("https://cdn.example/always-503.mp4", dir, 1_000),
    ).rejects.toMatchObject({
      kind: "http_transient",
      retryable: true,
      status: 503,
    } satisfies Partial<UrlDownloadError>);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(temporaryDownloadEntries(dir)).toEqual([]);
  });

  it("removes a partial body after a network reset before retrying", async () => {
    const resetBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("partial"));
        const error = Object.assign(new Error("socket reset"), { code: "ECONNRESET" });
        controller.error(error);
      },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(resetBody))
      .mockResolvedValueOnce(new Response("complete"));
    vi.stubGlobal("fetch", fetchMock);
    const dir = makeTempDir();

    const path = await downloadToTemp("https://cdn.example/reset-once.mp4", dir, 1_000);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(readFileSync(path, "utf8")).toBe("complete");
    expect(temporaryDownloadEntries(dir)).toEqual([]);
  });

  it("retries an Undici mid-body disconnect reported through a nested cause", async () => {
    const disconnectedBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("partial"));
        const cause = Object.assign(new Error("other side closed"), {
          code: "UND_ERR_SOCKET",
        });
        controller.error(new TypeError("terminated", { cause }));
      },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(disconnectedBody))
      .mockResolvedValueOnce(new Response("complete"));
    vi.stubGlobal("fetch", fetchMock);
    const dir = makeTempDir();

    const path = await downloadToTemp("https://cdn.example/undici-reset-once.mp4", dir, 1_000);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(readFileSync(path, "utf8")).toBe("complete");
    expect(temporaryDownloadEntries(dir)).toEqual([]);
  });

  it("keeps the deadline active through a stalled response body", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async (_url: string, init: RequestInit) => {
        const stalledBody = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("partial"));
            init.signal?.addEventListener(
              "abort",
              () => controller.error(new DOMException("aborted", "AbortError")),
              { once: true },
            );
          },
        });
        return new Response(stalledBody);
      })
      .mockResolvedValueOnce(new Response("complete"));
    vi.stubGlobal("fetch", fetchMock);
    const dir = makeTempDir();

    const path = await downloadToTemp("https://cdn.example/stalled-body.mp4", dir, 20);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(readFileSync(path, "utf8")).toBe("complete");
    expect(temporaryDownloadEntries(dir)).toEqual([]);
  });

  it("retries a zero-byte 200 response without publishing it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(""))
      .mockResolvedValueOnce(new Response("complete"));
    vi.stubGlobal("fetch", fetchMock);
    const dir = makeTempDir();

    const path = await downloadToTemp("https://cdn.example/empty-once.mp4", dir, 1_000);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(readFileSync(path, "utf8")).toBe("complete");
    expect(temporaryDownloadEntries(dir)).toEqual([]);
  });

  it("retries a 200 response with no body", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null))
      .mockResolvedValueOnce(new Response("complete"));
    vi.stubGlobal("fetch", fetchMock);
    const dir = makeTempDir();

    const path = await downloadToTemp("https://cdn.example/null-body-once.mp4", dir, 1_000);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(readFileSync(path, "utf8")).toBe("complete");
    expect(temporaryDownloadEntries(dir)).toEqual([]);
  });

  it("removes a stale zero-byte final file before downloading", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("complete"));
    vi.stubGlobal("fetch", fetchMock);
    const dir = makeTempDir();
    const stalePath = join(dir, "download_eda0de5dc5a3.mp4");
    writeFileSync(stalePath, "");

    const path = await downloadToTemp("https://cdn.example/stale-empty.mp4", dir, 1_000);

    expect(path).toBe(stalePath);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(readFileSync(path, "utf8")).toBe("complete");
    expect(temporaryDownloadEntries(dir)).toEqual([]);
  });

  it("refetches when the cache path disappears before its first inspection", async () => {
    const url = "https://cdn.example/first-lstat-race.mp4";
    const dir = makeTempDir();
    const cacheName = `download_${createHash("md5").update(url).digest("hex").slice(0, 12)}.mp4`;
    const cachePath = join(dir, cacheName);
    writeFileSync(cachePath, "vanishing-cache-entry");
    fsRaceControls.deleteBeforeLstatPath = cachePath;
    const fetchMock = vi.fn().mockResolvedValue(new Response("complete"));
    vi.stubGlobal("fetch", fetchMock);

    const path = await downloadToTemp(url, dir, 1_000);

    expect(path).toBe(cachePath);
    expect(readFileSync(path, "utf8")).toBe("complete");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(temporaryDownloadEntries(dir)).toEqual([]);
  });

  it("does not trust a nonempty symlink at the final cache path", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("downloaded"));
    vi.stubGlobal("fetch", fetchMock);
    const dir = makeTempDir();
    const target = join(dir, "attacker-controlled.mp4");
    const cachePath = join(dir, "download_eda0de5dc5a3.mp4");
    writeFileSync(target, "not-the-download");
    symlinkSync(target, cachePath);

    const path = await downloadToTemp("https://cdn.example/stale-empty.mp4", dir, 1_000);

    expect(path).toBe(cachePath);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(readFileSync(path, "utf8")).toBe("downloaded");
    expect(readFileSync(target, "utf8")).toBe("not-the-download");
  });

  it("does not retry caller cancellation", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const dir = makeTempDir();
    const controller = new AbortController();
    controller.abort();

    await expect(
      downloadToTemp("https://cdn.example/cancelled.mp4", dir, 1_000, controller.signal),
    ).rejects.toMatchObject({
      kind: "cancelled",
      retryable: false,
    } satisfies Partial<UrlDownloadError>);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(temporaryDownloadEntries(dir)).toEqual([]);
  });

  it("deduplicates concurrent callers for the same URL and destination", async () => {
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          setTimeout(() => resolve(new Response("complete")), 10);
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const dir = makeTempDir();

    const [first, second] = await Promise.all([
      downloadToTemp("https://cdn.example/concurrent.mp4", dir, 1_000),
      downloadToTemp("https://cdn.example/concurrent.mp4", dir, 1_000),
    ]);

    expect(first).toBe(second);
    expect(existsSync(first)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("waits for a cross-process cache-path lock before inspecting the final path", async () => {
    const url = "https://cdn.example/locked.mp4";
    const dir = makeTempDir();
    const cacheName = `download_${createHash("md5").update(url).digest("hex").slice(0, 12)}.mp4`;
    const lockPath = join(dir, `${cacheName}.hf-lock`);
    mkdirSync(lockPath);
    const fetchMock = vi.fn().mockResolvedValue(new Response("complete"));
    vi.stubGlobal("fetch", fetchMock);

    const pending = downloadToTemp(url, dir, 1_000);
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(fetchMock).not.toHaveBeenCalled();
    rmSync(lockPath, { recursive: true, force: true });

    const path = await pending;
    expect(readFileSync(path, "utf8")).toBe("complete");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(temporaryDownloadEntries(dir)).toEqual([]);
  });

  it("recovers a stale cross-process cache-path lock", async () => {
    const url = "https://cdn.example/stale-lock.mp4";
    const dir = makeTempDir();
    const cacheName = `download_${createHash("md5").update(url).digest("hex").slice(0, 12)}.mp4`;
    const lockPath = join(dir, `${cacheName}.hf-lock`);
    mkdirSync(lockPath);
    mkdirSync(join(lockPath, ".hf-owner-stale"));
    const staleTime = new Date(Date.now() - 6 * 60_000);
    utimesSync(lockPath, staleTime, staleTime);
    const fetchMock = vi.fn().mockResolvedValue(new Response("complete"));
    vi.stubGlobal("fetch", fetchMock);

    const path = await downloadToTemp(url, dir, 1_000);

    expect(readFileSync(path, "utf8")).toBe("complete");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(existsSync(lockPath)).toBe(false);
    expect(temporaryDownloadEntries(dir)).toEqual([]);
  });

  it("does not mix a stale lstat with a successor owner read", async () => {
    const url = "https://cdn.example/stale-lock-successor.mp4";
    const dir = makeTempDir();
    const cacheName = `download_${createHash("md5").update(url).digest("hex").slice(0, 12)}.mp4`;
    const lockPath = join(dir, `${cacheName}.hf-lock`);
    mkdirSync(lockPath);
    mkdirSync(join(lockPath, ".hf-owner-stale"));
    const staleTime = new Date(Date.now() - 6 * 60_000);
    utimesSync(lockPath, staleTime, staleTime);
    fsRaceControls.replaceStaleLockAfterObservationPath = lockPath;
    const fetchMock = vi.fn().mockResolvedValue(new Response("complete"));
    vi.stubGlobal("fetch", fetchMock);

    const pending = downloadToTemp(url, dir, 1_000);
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(existsSync(lockPath)).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    rmSync(lockPath, { recursive: true, force: true });

    const path = await pending;
    expect(readFileSync(path, "utf8")).toBe("complete");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(temporaryDownloadEntries(dir)).toEqual([]);
  });

  it("does not release a successor cache lock created at the same path", async () => {
    const url = "https://cdn.example/successor-lock.mp4";
    const dir = makeTempDir();
    const cacheName = `download_${createHash("md5").update(url).digest("hex").slice(0, 12)}.mp4`;
    const cachePath = join(dir, cacheName);
    const lockPath = `${cachePath}.hf-lock`;
    writeFileSync(cachePath, "cached");
    fsRaceControls.replaceLockOnReleasePath = lockPath;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const path = await downloadToTemp(url, dir, 1_000);

    expect(path).toBe(cachePath);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(existsSync(lockPath)).toBe(true);
    rmSync(lockPath, { recursive: true, force: true });
  });

  it("keeps the replacement path intact across cross-signal stale-cache callers", async () => {
    const url = "https://cdn.example/stale-concurrent.woff2";
    const dir = makeTempDir();
    const cacheName = `download_${createHash("md5").update(url).digest("hex").slice(0, 12)}.woff2`;
    writeFileSync(join(dir, cacheName), "<!doctype html><html>expired</html>");
    const firstController = new AbortController();
    const secondController = new AbortController();
    const body = Buffer.from("wOF2replacement");
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          setTimeout(() => resolve(new Response(body)), 10);
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const [first, second] = await Promise.all([
      downloadToTemp(url, dir, 1_000, firstController.signal),
      downloadToTemp(url, dir, 1_000, secondController.signal),
    ]);

    expect(first).toBe(second);
    expect(existsSync(first)).toBe(true);
    expect(readFileSync(first)).toEqual(body);
    expect(temporaryDownloadEntries(dir)).toEqual([]);
  });

  it("never overwrites an artifact returned by a concurrent checksum scope", async () => {
    const firstBytes = isoBmffMediaBytes("first-version");
    const secondBytes = isoBmffMediaBytes("second-version");
    const firstSha = createHash("sha256").update(firstBytes).digest("hex");
    const secondSha = createHash("sha256").update(secondBytes).digest("hex");
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) =>
            setTimeout(() => resolve(new Response(firstBytes)), 20),
          ),
      )
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) =>
            setTimeout(() => resolve(new Response(secondBytes)), 5),
          ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const dir = makeTempDir();
    const url = "https://cdn.example/versioned.mp4";

    const [firstPath, secondPath] = await Promise.all([
      downloadToTemp(url, dir, 1_000, undefined, undefined, {
        expectedSha256: firstSha,
      }),
      downloadToTemp(url, dir, 1_000, undefined, undefined, {
        expectedSha256: secondSha,
      }),
    ]);

    expect(firstPath).not.toBe(secondPath);
    expect(readFileSync(firstPath)).toEqual(firstBytes);
    expect(readFileSync(secondPath)).toEqual(secondBytes);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("locally refetches when a concurrent race winner disappears before validation", async () => {
    const url = "https://cdn.example/vanishing-race-winner.mp4";
    const dir = makeTempDir();
    const cacheName = `download_${createHash("md5").update(url).digest("hex").slice(0, 12)}.mp4`;
    const cachePath = join(dir, cacheName);
    fsRaceControls.injectRaceAtLinkPath = cachePath;
    fsRaceControls.deleteBeforeReadPath = cachePath;
    const onTelemetry = vi.fn();
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response("complete")));
    vi.stubGlobal("fetch", fetchMock);

    const path = await downloadToTemp(url, dir, 1_000, undefined, undefined, { onTelemetry });

    expect(path).toBe(cachePath);
    expect(readFileSync(path, "utf8")).toBe("complete");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "attempt_failed", failureKind: "filesystem" }),
    );
    expect(onTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "retrying", failureKind: "filesystem" }),
    );
    expect(temporaryDownloadEntries(dir)).toEqual([]);
  });

  it("locally refetches when an EEXIST race winner disappears before its first lstat", async () => {
    const url = "https://cdn.example/vanishing-race-winner-before-lstat.mp4";
    const dir = makeTempDir();
    const cacheName = `download_${createHash("md5").update(url).digest("hex").slice(0, 12)}.mp4`;
    const cachePath = join(dir, cacheName);
    fsRaceControls.injectRaceAtLinkPath = cachePath;
    fsRaceControls.deleteInjectedWinnerBeforeLstatPath = cachePath;
    const onTelemetry = vi.fn();
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response("complete")));
    vi.stubGlobal("fetch", fetchMock);

    const path = await downloadToTemp(url, dir, 1_000, undefined, undefined, { onTelemetry });

    expect(path).toBe(cachePath);
    expect(readFileSync(path, "utf8")).toBe("complete");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "attempt_failed", failureKind: "filesystem" }),
    );
    expect(onTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "retrying", failureKind: "filesystem" }),
    );
    expect(temporaryDownloadEntries(dir)).toEqual([]);
  });

  it("does not let one caller cancellation abort another caller", async () => {
    const firstController = new AbortController();
    const secondController = new AbortController();
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async (_url: string, init: RequestInit) => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("partial"));
            init.signal?.addEventListener(
              "abort",
              () => controller.error(new DOMException("aborted", "AbortError")),
              { once: true },
            );
          },
        });
        return new Response(body);
      })
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            setTimeout(() => resolve(new Response("complete")), 10);
          }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const dir = makeTempDir();

    const first = downloadToTemp(
      "https://cdn.example/cancellation-isolation-a.mp4",
      dir,
      1_000,
      firstController.signal,
    );
    const second = downloadToTemp(
      "https://cdn.example/cancellation-isolation-a.mp4",
      dir,
      1_000,
      secondController.signal,
    );
    firstController.abort();

    await expect(first).rejects.toMatchObject({
      kind: "cancelled",
      retryable: false,
    } satisfies Partial<UrlDownloadError>);
    const path = await second;
    expect(readFileSync(path, "utf8")).toBe("complete");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(temporaryDownloadEntries(dir)).toEqual([]);
  });

  it("does not let a later caller cancellation abort the first caller", async () => {
    const firstController = new AbortController();
    const secondController = new AbortController();
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            setTimeout(() => resolve(new Response("complete")), 10);
          }),
      )
      .mockImplementationOnce(async (_url: string, init: RequestInit) => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("partial"));
            init.signal?.addEventListener(
              "abort",
              () => controller.error(new DOMException("aborted", "AbortError")),
              { once: true },
            );
          },
        });
        return new Response(body);
      });
    vi.stubGlobal("fetch", fetchMock);
    const dir = makeTempDir();

    const first = downloadToTemp(
      "https://cdn.example/cancellation-isolation-b.mp4",
      dir,
      1_000,
      firstController.signal,
    );
    const second = downloadToTemp(
      "https://cdn.example/cancellation-isolation-b.mp4",
      dir,
      1_000,
      secondController.signal,
    );
    secondController.abort();

    await expect(second).rejects.toMatchObject({
      kind: "cancelled",
      retryable: false,
    } satisfies Partial<UrlDownloadError>);
    const path = await first;
    expect(readFileSync(path, "utf8")).toBe("complete");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(temporaryDownloadEntries(dir)).toEqual([]);
  });
});
