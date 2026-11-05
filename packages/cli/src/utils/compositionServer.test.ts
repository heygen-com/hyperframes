import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRangeResponse } from "./compositionServer.js";

const TAGGED_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAABGNJQ1ABAQABlXPCVgAAAAxJREFUeJxj0NfXBwABHgCOTp25kgAAAABJRU5ErkJggg==",
  "base64",
);

let dir: string | undefined;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("buildRangeResponse colour-tagged PNGs", () => {
  it("serves a BT.709-tagged PNG without the tag, so play and present show the file's values", async () => {
    dir = mkdtempSync(join(tmpdir(), "hf-composition-server-"));
    const file = join(dir, "tagged.png");
    writeFileSync(file, TAGGED_PNG);

    const res = buildRangeResponse(file, "image/png", undefined);
    const body = Buffer.from(await res.arrayBuffer());

    expect(body.includes("cICP")).toBe(false);
    expect(body.includes("IDAT")).toBe(true);
    expect(res.headers.get("content-length")).toBe(String(body.length));
  });
});
