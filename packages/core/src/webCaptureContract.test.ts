import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
// @ts-expect-error -- ffprobe-static ships no type declarations.
import ffprobeStatic from "ffprobe-static";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
// @ts-expect-error -- wawoff2 ships no type declarations.
import wawoff2 from "wawoff2";
import {
  buildWebCaptureText as buildContractText,
  parseWebCaptureText as parseContractText,
  utf8ByteLength,
  WEB_CAPTURE_AUDIENCE,
  WEB_CAPTURE_BUDGETS,
  WEB_CAPTURE_CUSTOM_MIME,
  WEB_CAPTURE_REPRESENTATION_KINDS,
  WEB_CAPTURE_ROUTE_PREFIX,
  withinWebCaptureBudget,
  type WebCaptureEnvelopeInput,
  type WebCaptureResourceInspection,
  type WebCaptureResourceMaterializer,
} from "./webCaptureContract";

const { decompress: decompressWoff2 } = wawoff2 as {
  decompress: (bytes: Uint8Array) => Promise<Uint8Array>;
};
const { path: ffprobePath } = ffprobeStatic as { path: string };

const HELLO_SHA256 = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
const PNG_DATA =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const PNG_SHA256 = "431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460";
const REAL_MP4_DATA = readFileSync(
  resolve(
    process.cwd(),
    "../../packages/producer/tests/distributed/plan-v2-partial-color/src/partial-color.mp4",
  ),
).toString("base64");
const REAL_MP4_SHA256 = "ce6b3deecd76d6d80f7b2d3dc4c33f988acf7826b14f670edd62c9c312c89af6";
const CORRUPT_WEBM_DATA = "GkXfo4AYU4BnmxVJqWaHRImERHoAABZUrmuKrojghrCBAbqBAQ==";
const CORRUPT_WEBM_SHA256 = "1aaebb3fd29e1d3feb9c77b685f4c90bb8f34a8d30828deb78bd91dba959beff";
const REAL_WOFF2_DATA = readFileSync(
  resolve(
    process.cwd(),
    "../../skills/embedded-captions/modes/standard/fonts/files/orbitron-latin-400-normal.woff2",
  ),
).toString("base64");
const REAL_WOFF2_SHA256 = "9320ca80be2f4275e7aaa009bc058b9ea46264d4f92b06f0b822c3405cf45841";
const FAKE_WOFF2_DATA = "d09GMgAAAAAAAAAwAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const FAKE_WOFF2_SHA256 = "8c64bf1b3b10243825da4f8db78273b50fa5e0a5fdec8006583ed14edb270c5b";
const WOFF2_MAX_EXPANSION_DATA = "d09GMgAAAAAAAAAwAAAAAP////8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const WOFF2_MAX_EXPANSION_SHA256 =
  "a29190d9f719369ea855febcf74e92e79129c713fa5e4e5c00c059bab9aee784";
const CORRUPT_PNG_DATA = "iVBORw0KGgoAAAAASUhEUgAAAAEAAAAB";
const CORRUPT_PNG_SHA256 = "82233833031b185813af84278169c2c5c553091bbc6fac4a0a57446a18dd46f6";

async function materializeImage(
  bytes: Uint8Array,
  inspected: WebCaptureResourceInspection,
): Promise<WebCaptureResourceInspection | null> {
  try {
    const { info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
    return { mime: inspected.mime, width: info.width, height: info.height };
  } catch {
    return null;
  }
}

async function materializeFont(bytes: Uint8Array): Promise<WebCaptureResourceInspection | null> {
  try {
    const decoded = await decompressWoff2(bytes);
    return { mime: "font/woff2", decodedBytes: decoded.byteLength };
  } catch {
    return null;
  }
}

interface FfprobeResult {
  streams?: Array<{ codec_type?: string; width?: number; height?: number }>;
  format?: { duration?: string };
}

function parseFfprobeResult(stdout: string, mime: "video/mp4" | "video/webm") {
  const result = JSON.parse(stdout) as FfprobeResult;
  const video = result.streams?.find(({ codec_type }) => codec_type === "video");
  const duration = Number(result.format?.duration);
  return video?.width && video.height && Number.isFinite(duration)
    ? { mime, width: video.width, height: video.height, durationMs: Math.round(duration * 1000) }
    : null;
}

function materializeMedia(
  bytes: Uint8Array,
  inspected: WebCaptureResourceInspection,
): Promise<WebCaptureResourceInspection | null> {
  return new Promise((resolveMaterialization) => {
    const child = spawn(ffprobePath, [
      "-v",
      "error",
      "-show_entries",
      "format=duration:stream=codec_type,width,height",
      "-of",
      "json",
      "-i",
      "pipe:0",
    ]);
    let stdout = "";
    let settled = false;
    const finish = (value: WebCaptureResourceInspection | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolveMaterialization(value);
    };
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      finish(null);
    }, 1000);
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.on("error", () => finish(null));
    child.on("close", (code) =>
      finish(
        code === 0
          ? parseFfprobeResult(stdout, inspected.mime as "video/mp4" | "video/webm")
          : null,
      ),
    );
    child.stdin.on("error", () => undefined);
    child.stdin.end(bytes);
  });
}

const materializeResource: WebCaptureResourceMaterializer = (bytes, inspected) => {
  if (inspected.mime.startsWith("image/")) return materializeImage(bytes, inspected);
  if (inspected.mime === "font/woff2") return materializeFont(bytes);
  return materializeMedia(bytes, inspected);
};

const buildWebCaptureText = (input: WebCaptureEnvelopeInput) =>
  buildContractText(input, { materializeResource });
const parseWebCaptureText = (sourceText: string, customMimeText?: string) =>
  parseContractText(sourceText, { materializeResource, customMimeText });

const editableInput = (
  overrides: Partial<WebCaptureEnvelopeInput> = {},
): WebCaptureEnvelopeInput => ({
  artifact: {
    kind: "editable-dom",
    html: "<section>caf\u00e9</section>",
    css: "section{color:#151513}",
    width: 320,
    height: 180,
  },
  resources: [],
  diagnostics: [{ code: "animation.staticized", count: 1 }],
  claims: {
    sourceFrame: { width: 320, height: 180, devicePixelRatio: 2 },
    time: { kind: "locked-frame", atMs: 0 },
    reflow: "fixed-viewport",
  },
  ...overrides,
});

async function mustBuild(input: WebCaptureEnvelopeInput): Promise<string> {
  const result = await buildWebCaptureText(input);
  expect(result).toMatchObject({ ok: true });
  if (!result.ok) throw new Error(result.code);
  return result.text;
}

describe("web capture v2 contract", () => {
  it("keeps rejection in the classifier union but outside persistable artifacts", () => {
    expect(WEB_CAPTURE_REPRESENTATION_KINDS).toEqual([
      "editable-dom",
      "finite-local-media",
      "still",
      "rejected",
    ]);
  });

  it("builds canonical producer bytes that the shared consumer parser accepts", async () => {
    const text = await mustBuild(editableInput());
    const result = await parseWebCaptureText(text);

    expect(text.startsWith(`${WEB_CAPTURE_ROUTE_PREFIX}\n`)).toBe(true);
    expect(result).toMatchObject({
      ok: true,
      envelope: {
        version: "2.0",
        audience: WEB_CAPTURE_AUDIENCE,
        artifact: { kind: "editable-dom", width: 320, height: 180 },
      },
    });
  });

  it("produces byte-identical output for equivalent key and diagnostic ordering", async () => {
    const first = await mustBuild(
      editableInput({
        diagnostics: [
          { code: "still.cropped", count: 1 },
          { code: "animation.staticized", count: 1 },
        ],
      }),
    );
    const second = await mustBuild(
      editableInput({
        diagnostics: [
          { code: "animation.staticized", count: 1 },
          { code: "still.cropped", count: 1 },
        ],
      }),
    );

    expect(first).toBe(second);
  });

  it.each(["2.1", "3.0"])(
    "returns an upgrade outcome for unsupported version %s",
    async (version) => {
      const text = (await mustBuild(editableInput())).replace(
        '"version":"2.0"',
        `"version":"${version}"`,
      );
      expect(await parseWebCaptureText(text)).toEqual({
        ok: false,
        code: "protocol.unsupported-version",
        version,
      });
    },
  );

  it("rejects the dormant v1 marker explicitly", async () => {
    expect(await parseWebCaptureText('hyperframes-clipboard:v1\n{"kind":"dom-element"}')).toEqual({
      ok: false,
      code: "protocol.legacy-v1",
    });
  });

  it("leaves unrelated clipboard text unclaimed", async () => {
    expect(await parseWebCaptureText("ordinary clipboard text")).toEqual({
      ok: false,
      code: "route.unrecognized",
    });
  });

  it("fails closed on malformed recognized JSON and trailing data", async () => {
    expect(await parseWebCaptureText(`${WEB_CAPTURE_ROUTE_PREFIX}\n{`)).toMatchObject({
      ok: false,
      code: "grammar.malformed",
    });
    expect(await parseWebCaptureText(`${WEB_CAPTURE_ROUTE_PREFIX}\n{} trailing`)).toMatchObject({
      ok: false,
      code: "grammar.malformed",
    });
    expect(
      await parseWebCaptureText(
        `${WEB_CAPTURE_ROUTE_PREFIX}\n{"audience":"hyperframes-studio","version":1e999}`,
      ),
    ).toEqual({ ok: false, code: "grammar.malformed" });
    expect(await parseWebCaptureText(`${WEB_CAPTURE_ROUTE_PREFIX}\n${"[".repeat(20_000)}`)).toEqual(
      { ok: false, code: "grammar.malformed" },
    );
  });

  it("rejects duplicate keys before schema validation", async () => {
    const text = `${WEB_CAPTURE_ROUTE_PREFIX}\n{"audience":"hyperframes-studio","audience":"hyperframes-studio"}`;
    expect(await parseWebCaptureText(text)).toEqual({
      ok: false,
      code: "grammar.duplicate-key",
      key: "audience",
    });
  });

  it("rejects unknown fields instead of silently accepting protocol drift", async () => {
    const text = (await mustBuild(editableInput())).replace(
      '"integrity":',
      '"extra":true,"integrity":',
    );
    expect(await parseWebCaptureText(text)).toMatchObject({
      ok: false,
      code: "schema.unknown-key",
      path: "$",
      key: "extra",
    });
  });

  it("rejects canonical payload tampering", async () => {
    const text = (await mustBuild(editableInput())).replace("café", "caxé");
    expect(await parseWebCaptureText(text)).toEqual({
      ok: false,
      code: "integrity.digest-mismatch",
    });
  });

  it("verifies envelope integrity before decoding or hashing resources", async () => {
    const resource = {
      id: "image-1",
      kind: "image" as const,
      mime: "image/png" as const,
      bytes: 68,
      sha256: PNG_SHA256,
      data: PNG_DATA,
      width: 1,
      height: 1,
    };
    const text = (await mustBuild(editableInput({ resources: [resource] }))).replace(
      PNG_SHA256,
      "0".repeat(64),
    );

    expect(await parseWebCaptureText(text)).toEqual({
      ok: false,
      code: "integrity.digest-mismatch",
    });
  });

  it("verifies envelope integrity before applying quotas", async () => {
    const text = (await mustBuild(editableInput())).replace(
      '"sourceFrame":{"devicePixelRatio":2,"height":180,"width":320}',
      '"sourceFrame":{"devicePixelRatio":2,"height":180,"width":100000}',
    );

    expect(await parseWebCaptureText(text)).toEqual({
      ok: false,
      code: "integrity.digest-mismatch",
    });
  });

  it("rejects a mismatched optional web custom MIME representation", async () => {
    const text = await mustBuild(editableInput());
    expect(WEB_CAPTURE_CUSTOM_MIME).toBe("web application/vnd.hyperframes.web-capture+json");
    expect(await parseWebCaptureText(text, `${text}x`)).toEqual({
      ok: false,
      code: "clipboard.mime-mismatch",
    });
  });

  it("counts normalized UTF-8 bytes instead of UTF-16 code units", () => {
    expect(utf8ByteLength("a")).toBe(1);
    expect(utf8ByteLength("\u00e9")).toBe(2);
    expect(utf8ByteLength("\ud800")).toBe(3);
  });

  it("normalizes lone surrogates in both producer bytes and the returned envelope", async () => {
    const built = await buildWebCaptureText(
      editableInput({
        artifact: {
          kind: "editable-dom",
          html: "<p>\ud800</p>",
          css: "",
          width: 1,
          height: 1,
        },
      }),
    );

    expect(built).toMatchObject({
      ok: true,
      envelope: { artifact: { html: "<p>\ufffd</p>" } },
    });
    if (built.ok) expect(built.text).toContain("<p>�</p>");
  });

  it("owns every numeric budget boundary at N minus one, N, and N plus one", () => {
    for (const [name, limit] of Object.entries(WEB_CAPTURE_BUDGETS)) {
      expect(withinWebCaptureBudget(name as keyof typeof WEB_CAPTURE_BUDGETS, limit - 1)).toBe(
        true,
      );
      expect(withinWebCaptureBudget(name as keyof typeof WEB_CAPTURE_BUDGETS, limit)).toBe(true);
      expect(withinWebCaptureBudget(name as keyof typeof WEB_CAPTURE_BUDGETS, limit + 1)).toBe(
        false,
      );
    }
  });

  it.each([63, 64, 65])("enforces the aggregate resource count at %i", async (count) => {
    const resources = Array.from({ length: count }, (_, index) => ({
      id: `image-${index}`,
      kind: "image" as const,
      mime: "image/png" as const,
      bytes: 68,
      sha256: PNG_SHA256,
      data: PNG_DATA,
      width: 1,
      height: 1,
    }));
    const result = await buildWebCaptureText(editableInput({ resources }));
    expect(result.ok).toBe(count <= WEB_CAPTURE_BUDGETS.resources);
    if (!result.ok) expect(result.code).toBe("budget.resources");
  });

  it("enforces the aggregate HTML and CSS byte budget", async () => {
    const atLimit = await buildWebCaptureText(
      editableInput({
        artifact: {
          kind: "editable-dom",
          html: "a".repeat(WEB_CAPTURE_BUDGETS.htmlCssBytes - 1),
          css: "b",
          width: 1,
          height: 1,
        },
      }),
    );
    const overLimit = await buildWebCaptureText(
      editableInput({
        artifact: {
          kind: "editable-dom",
          html: "a".repeat(WEB_CAPTURE_BUDGETS.htmlCssBytes),
          css: "b",
          width: 1,
          height: 1,
        },
      }),
    );

    expect(atLimit.ok).toBe(true);
    expect(overLimit).toEqual({
      ok: false,
      code: "budget.html-css-bytes",
      actual: WEB_CAPTURE_BUDGETS.htmlCssBytes + 1,
      limit: WEB_CAPTURE_BUDGETS.htmlCssBytes,
    });
  });

  it.each([
    {
      name: "diagnostic count",
      input: editableInput({
        diagnostics: [{ code: "still.cropped", count: WEB_CAPTURE_BUDGETS.diagnostics + 1 }],
      }),
      expected: {
        code: "budget.diagnostics",
        actual: WEB_CAPTURE_BUDGETS.diagnostics + 1,
        limit: WEB_CAPTURE_BUDGETS.diagnostics,
      },
    },
    {
      name: "raster pixels",
      input: editableInput({
        artifact: {
          kind: "editable-dom",
          html: "",
          css: "",
          width: WEB_CAPTURE_BUDGETS.rasterPixels + 1,
          height: 1,
        },
      }),
      expected: {
        code: "budget.raster-pixels",
        actual: WEB_CAPTURE_BUDGETS.rasterPixels + 1,
        limit: WEB_CAPTURE_BUDGETS.rasterPixels,
      },
    },
    {
      name: "device pixel ratio",
      input: editableInput({
        claims: {
          sourceFrame: {
            width: 1,
            height: 1,
            devicePixelRatio: WEB_CAPTURE_BUDGETS.devicePixelRatio + 1,
          },
          time: { kind: "locked-frame", atMs: 0 },
          reflow: "fixed-viewport",
        },
      }),
      expected: {
        code: "budget.device-pixel-ratio",
        actual: WEB_CAPTURE_BUDGETS.devicePixelRatio + 1,
        limit: WEB_CAPTURE_BUDGETS.devicePixelRatio,
      },
    },
    {
      name: "materialized non-font bytes",
      input: editableInput({
        resources: [
          {
            id: "image-1",
            kind: "image",
            mime: "image/png",
            bytes: WEB_CAPTURE_BUDGETS.materializedBytes + 1,
            sha256: HELLO_SHA256,
            data: "aGVsbG8=",
            width: 1,
            height: 1,
          },
        ],
      }),
      expected: {
        code: "budget.materialized-bytes",
        actual: WEB_CAPTURE_BUDGETS.materializedBytes + 1,
        limit: WEB_CAPTURE_BUDGETS.materializedBytes,
      },
    },
    {
      name: "decoded font bytes",
      input: editableInput({
        resources: [
          {
            id: "font-1",
            kind: "font",
            mime: "font/woff2",
            bytes: 48,
            decodedBytes: 0xffffffff,
            sha256: WOFF2_MAX_EXPANSION_SHA256,
            data: WOFF2_MAX_EXPANSION_DATA,
          },
        ],
      }),
      expected: {
        code: "budget.decoded-font-bytes",
        actual: 0xffffffff,
        limit: WEB_CAPTURE_BUDGETS.decodedFontBytes,
      },
    },
  ])("enforces the $name quota before materializing resources", async ({ input, expected }) => {
    expect(await buildWebCaptureText(input)).toEqual({ ok: false, ...expected });
  });

  it("enforces media and aggregate pixel quotas", async () => {
    const media = {
      id: "media-1",
      kind: "media" as const,
      mime: "video/webm" as const,
      bytes: 68,
      sha256: PNG_SHA256,
      data: PNG_DATA,
      width: WEB_CAPTURE_BUDGETS.mediaDimension + 1,
      height: 1,
      durationMs: 1,
    };
    expect(await buildWebCaptureText(editableInput({ resources: [media] }))).toMatchObject({
      ok: false,
      code: "budget.media-dimension",
    });
    expect(
      await buildWebCaptureText(
        editableInput({
          resources: [
            {
              ...media,
              width: 1,
              durationMs: WEB_CAPTURE_BUDGETS.mediaDurationMs + 1,
            },
          ],
        }),
      ),
    ).toMatchObject({ ok: false, code: "budget.media-duration-ms" });

    const pixelResource = (id: string, width: number) => ({
      id,
      kind: "image" as const,
      mime: "image/png" as const,
      bytes: 68,
      sha256: PNG_SHA256,
      data: PNG_DATA,
      width,
      height: 1,
    });
    expect(
      await buildWebCaptureText(
        editableInput({
          resources: [
            pixelResource("image-1", WEB_CAPTURE_BUDGETS.rasterPixels),
            pixelResource("image-2", WEB_CAPTURE_BUDGETS.rasterPixels),
            pixelResource("image-3", 1),
          ],
        }),
      ),
    ).toMatchObject({ ok: false, code: "budget.aggregate-decoded-pixels" });
  });

  it("rejects an oversized routed payload before parsing JSON", async () => {
    const text = `${WEB_CAPTURE_ROUTE_PREFIX}\n${"x".repeat(WEB_CAPTURE_BUDGETS.finalUtf8Bytes)}`;
    expect(await parseWebCaptureText(text)).toMatchObject({
      ok: false,
      code: "budget.final-utf8-bytes",
    });
  });

  it("rejects a base64-expanded producer envelope before resource materialization", async () => {
    const bytes = new Uint8Array(7_499_800);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    bytes.set([0x49, 0x48, 0x44, 0x52], 12);
    const view = new DataView(bytes.buffer);
    view.setUint32(16, 1);
    view.setUint32(20, 1);
    let materializerCalls = 0;

    const result = await buildContractText(
      editableInput({
        resources: [
          {
            id: "image-1",
            kind: "image",
            mime: "image/png",
            bytes: bytes.byteLength,
            sha256: "0".repeat(64),
            data: Buffer.from(bytes).toString("base64"),
            width: 1,
            height: 1,
          },
        ],
      }),
      {
        materializeResource: async () => {
          materializerCalls += 1;
          return null;
        },
      },
    );

    expect(result).toMatchObject({ ok: false, code: "budget.final-utf8-bytes" });
    expect(materializerCalls).toBe(0);
  });

  it("verifies decoded resource bytes and SHA-256", async () => {
    const resource = {
      id: "image-1",
      kind: "image" as const,
      mime: "image/png" as const,
      bytes: 68,
      sha256: PNG_SHA256,
      data: PNG_DATA,
      width: 1,
      height: 1,
    };
    expect(await buildWebCaptureText(editableInput({ resources: [resource] }))).toMatchObject({
      ok: true,
    });
    expect(
      await buildWebCaptureText(
        editableInput({ resources: [{ ...resource, sha256: "0".repeat(64) }] }),
      ),
    ).toEqual({ ok: false, code: "resource.hash-mismatch", resourceId: "image-1" });
    expect(
      await buildWebCaptureText(
        editableInput({
          resources: [{ ...resource, bytes: 5, sha256: HELLO_SHA256, data: "aGVsbG8=" }],
        }),
      ),
    ).toEqual({ ok: false, code: "resource.invalid-data", resourceId: "image-1" });
  });

  it("verifies every resource SHA before materializing the batch", async () => {
    let materializerCalls = 0;
    const image = {
      kind: "image" as const,
      mime: "image/png" as const,
      bytes: 68,
      sha256: PNG_SHA256,
      data: PNG_DATA,
      width: 1,
      height: 1,
    };

    const result = await buildContractText(
      editableInput({
        resources: [
          { ...image, id: "image-1" },
          { ...image, id: "image-2", sha256: "0".repeat(64) },
        ],
      }),
      {
        materializeResource: async () => {
          materializerCalls += 1;
          return { mime: "image/png", width: 1, height: 1 };
        },
      },
    );

    expect(result).toEqual({ ok: false, code: "resource.hash-mismatch", resourceId: "image-2" });
    expect(materializerCalls).toBe(0);
  });

  it("starts the materialization deadline after every resource SHA is verified", async () => {
    vi.useFakeTimers();
    const realDigest = crypto.subtle.digest.bind(crypto.subtle);
    let digestCalls = 0;
    let delayedHashStarted!: () => void;
    const hashStarted = new Promise<void>((resolve) => (delayedHashStarted = resolve));
    const digest = vi.spyOn(crypto.subtle, "digest").mockImplementation(async (...arguments_) => {
      digestCalls += 1;
      if (digestCalls === 2) {
        delayedHashStarted();
        await new Promise((resolve) =>
          setTimeout(resolve, WEB_CAPTURE_BUDGETS.phaseDeadlineMs + 100),
        );
      }
      return realDigest(...arguments_);
    });
    try {
      const result = buildContractText(
        editableInput({
          resources: [
            {
              id: "image-1",
              kind: "image",
              mime: "image/png",
              bytes: 68,
              sha256: PNG_SHA256,
              data: PNG_DATA,
              width: 1,
              height: 1,
            },
          ],
        }),
        {
          materializeResource: async (_bytes, inspected) => inspected,
        },
      );

      await hashStarted;
      await vi.advanceTimersByTimeAsync(WEB_CAPTURE_BUDGETS.phaseDeadlineMs + 100);

      await expect(result).resolves.toMatchObject({ ok: true });
    } finally {
      digest.mockRestore();
      vi.useRealTimers();
    }
  });

  it("rejects resource MIME, dimensions, and duration that disagree with the bytes", async () => {
    const image = {
      id: "image-1",
      kind: "image" as const,
      mime: "image/png" as const,
      bytes: 68,
      sha256: PNG_SHA256,
      data: PNG_DATA,
      width: 1,
      height: 1,
    };
    expect(
      await buildWebCaptureText(editableInput({ resources: [{ ...image, mime: "image/jpeg" }] })),
    ).toEqual({ ok: false, code: "resource.mime-mismatch", resourceId: "image-1" });
    expect(
      await buildWebCaptureText(editableInput({ resources: [{ ...image, width: 2 }] })),
    ).toEqual({ ok: false, code: "resource.dimensions-mismatch", resourceId: "image-1" });
    expect(
      await buildWebCaptureText(
        editableInput({
          resources: [
            {
              id: "media-1",
              kind: "media",
              mime: "video/mp4",
              bytes: 2251,
              sha256: REAL_MP4_SHA256,
              data: REAL_MP4_DATA,
              width: 320,
              height: 180,
              durationMs: 999,
            },
          ],
        }),
      ),
    ).toEqual({ ok: false, code: "resource.duration-mismatch", resourceId: "media-1" });
  });

  it("rejects a WOFF2 decoded size that disagrees with its expansion header", async () => {
    const font = {
      id: "font-1",
      kind: "font" as const,
      mime: "font/woff2" as const,
      bytes: 6396,
      decodedBytes: 16337,
      sha256: REAL_WOFF2_SHA256,
      data: REAL_WOFF2_DATA,
    };

    expect(await buildWebCaptureText(editableInput({ resources: [font] }))).toEqual({
      ok: false,
      code: "resource.decoded-size-mismatch",
      resourceId: "font-1",
    });
  });

  it("accepts a WOFF2 resource whose declared and inspected expansion sizes match", async () => {
    const result = await buildWebCaptureText(
      editableInput({
        resources: [
          {
            id: "font-1",
            kind: "font",
            mime: "font/woff2",
            bytes: 6396,
            decodedBytes: 16336,
            sha256: REAL_WOFF2_SHA256,
            data: REAL_WOFF2_DATA,
          },
        ],
      }),
    );

    expect(result).toMatchObject({ ok: true });
  });

  it("rejects a header-shaped WOFF2 resource that the decoder cannot materialize", async () => {
    expect(
      await buildWebCaptureText(
        editableInput({
          resources: [
            {
              id: "font-1",
              kind: "font",
              mime: "font/woff2",
              bytes: 48,
              decodedBytes: 1024,
              sha256: FAKE_WOFF2_SHA256,
              data: FAKE_WOFF2_DATA,
            },
          ],
        }),
      ),
    ).toEqual({ ok: false, code: "resource.invalid-data", resourceId: "font-1" });
  });

  it("rejects image metadata that cannot be materialized into pixels", async () => {
    expect(
      await buildWebCaptureText(
        editableInput({
          resources: [
            {
              id: "image-1",
              kind: "image",
              mime: "image/png",
              bytes: 24,
              sha256: CORRUPT_PNG_SHA256,
              data: CORRUPT_PNG_DATA,
              width: 1,
              height: 1,
            },
          ],
        }),
      ),
    ).toEqual({ ok: false, code: "resource.invalid-data", resourceId: "image-1" });
  });

  it("rejects media metadata that cannot be materialized by a media decoder", async () => {
    expect(
      await buildWebCaptureText(
        editableInput({
          resources: [
            {
              id: "media-1",
              kind: "media",
              mime: "video/webm",
              bytes: 37,
              sha256: CORRUPT_WEBM_SHA256,
              data: CORRUPT_WEBM_DATA,
              width: 1,
              height: 1,
              durationMs: 1000,
            },
          ],
        }),
      ),
    ).toEqual({ ok: false, code: "resource.invalid-data", resourceId: "media-1" });
  });

  it.each([
    {
      name: "failure",
      error: new Error("decoder unavailable"),
      code: "resource.materialization-failed",
    },
    {
      name: "abort",
      error: new DOMException("capture cancelled", "AbortError"),
      code: "resource.materialization-aborted",
    },
  ] as const)("returns a closed result for decoder $name", async ({ error, code }) => {
    const result = await buildContractText(
      editableInput({
        resources: [
          {
            id: "image-1",
            kind: "image",
            mime: "image/png",
            bytes: 68,
            sha256: PNG_SHA256,
            data: PNG_DATA,
            width: 1,
            height: 1,
          },
        ],
      }),
      {
        materializeResource: async () => {
          throw error;
        },
      },
    );

    expect(result).toEqual({ ok: false, code, resourceId: "image-1" });
  });

  it("aborts the resource phase when a decoder never settles", async () => {
    vi.useFakeTimers();
    let started!: () => void;
    const materializationStarted = new Promise<void>((resolve) => (started = resolve));
    let decoderSignal: AbortSignal | undefined;
    try {
      const result = buildContractText(
        editableInput({
          resources: [
            {
              id: "image-1",
              kind: "image",
              mime: "image/png",
              bytes: 68,
              sha256: PNG_SHA256,
              data: PNG_DATA,
              width: 1,
              height: 1,
            },
          ],
        }),
        {
          materializeResource: async (_bytes, _inspected, signal) => {
            decoderSignal = signal;
            started();
            return new Promise(() => undefined);
          },
        },
      );

      await materializationStarted;
      await vi.advanceTimersByTimeAsync(WEB_CAPTURE_BUDGETS.phaseDeadlineMs);

      await expect(result).resolves.toEqual({
        ok: false,
        code: "resource.materialization-aborted",
        resourceId: "image-1",
      });
      expect(decoderSignal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects non-canonical base64 even when it decodes to the declared bytes", async () => {
    expect(
      await buildWebCaptureText(
        editableInput({
          resources: [
            {
              id: "image-1",
              kind: "image",
              mime: "image/png",
              bytes: 1,
              sha256: "252f10c83610ebca1a059c0bae8255eba2f95be4d1d7bcfa89d7248a82d9f111",
              data: "Zh==",
              width: 1,
              height: 1,
            },
          ],
        }),
      ),
    ).toEqual({ ok: false, code: "resource.invalid-data", resourceId: "image-1" });
  });

  it("rejects duplicate resource ids", async () => {
    const resource = {
      id: "image-1",
      kind: "image" as const,
      mime: "image/png" as const,
      bytes: 5,
      sha256: HELLO_SHA256,
      data: "aGVsbG8=",
      width: 1,
      height: 1,
    };
    expect(await buildWebCaptureText(editableInput({ resources: [resource, resource] }))).toEqual({
      ok: false,
      code: "resource.duplicate-id",
      resourceId: "image-1",
    });
  });

  it.each([
    {
      artifact: {
        kind: "finite-local-media" as const,
        resourceId: "media-1",
        width: 320,
        height: 180,
      },
      resource: {
        id: "media-1",
        kind: "media" as const,
        mime: "video/mp4" as const,
        bytes: 2251,
        sha256: REAL_MP4_SHA256,
        data: REAL_MP4_DATA,
        width: 320,
        height: 180,
        durationMs: 1000,
      },
      time: { kind: "finite-local-media" as const, durationMs: 1000, deterministicSeek: false },
    },
    {
      artifact: {
        kind: "still" as const,
        resourceId: "image-1",
        width: 1,
        height: 1,
        completeness: "complete" as const,
      },
      resource: {
        id: "image-1",
        kind: "image" as const,
        mime: "image/png" as const,
        bytes: 68,
        sha256: PNG_SHA256,
        data: PNG_DATA,
        width: 1,
        height: 1,
      },
      time: { kind: "locked-frame" as const, atMs: 0 },
    },
  ])("round-trips the $artifact.kind representation", async ({ artifact, resource, time }) => {
    const text = await mustBuild(
      editableInput({
        artifact,
        resources: [resource],
        claims: {
          sourceFrame: { width: 320, height: 180, devicePixelRatio: 1 },
          time,
          reflow: "fixed-viewport",
        },
      }),
    );
    expect(await parseWebCaptureText(text)).toMatchObject({
      ok: true,
      envelope: { artifact },
    });
  });

  it("does not allow rejection to masquerade as a persistable artifact", async () => {
    expect(
      await buildWebCaptureText(
        editableInput({ artifact: { kind: "rejected", reason: "budget" } as never }),
      ),
    ).toMatchObject({ ok: false, code: "schema.invalid-artifact" });
  });
});
