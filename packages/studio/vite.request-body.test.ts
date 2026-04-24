import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { readNodeRequestBody } from "./vite.request-body.js";

describe("readNodeRequestBody", () => {
  it("preserves binary request bytes", async () => {
    const source = Buffer.from([0x00, 0xff, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    const body = await readNodeRequestBody(
      Readable.from([source.subarray(0, 3), source.subarray(3)]),
    );

    expect(Buffer.compare(body, source)).toBe(0);
  });

  it("returns an empty buffer when the request has no body", async () => {
    const body = await readNodeRequestBody(Readable.from([]));

    expect(body.byteLength).toBe(0);
  });
});
