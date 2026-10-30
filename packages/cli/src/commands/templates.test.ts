import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const signedIn = vi.hoisted(() => ({ value: true }));
vi.mock("../cloud/auth.js", () => ({
  resolveCloudAuthHeaders: async () => {
    if (!signedIn.value) throw new Error("no credential");
    return { authorization: "Bearer test" };
  },
  resolveCloudBaseUrl: () => "https://api.heygen.test",
}));

import { pullTemplate, PullRefused, TEMPLATES } from "./templates.js";

const LINK = "https://signed.test/bundle.tar.gz?sig=1";
let dir: string;
let archive: Buffer;

function tarOf(files: Record<string, string>): Buffer {
  const src = mkdtempSync(join(dir, "src-"));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(src, name), text);
  const out = join(src, "..", `${Date.now()}-${Math.random()}.tar.gz`);
  execFileSync("tar", ["-czf", out, "-C", src, "."]);
  return readFileSync(out);
}

function serve(link: Partial<{ status: number }>, body = archive): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (url: string) =>
    url === LINK
      ? new Response(new Uint8Array(body))
      : new Response(JSON.stringify({ data: { url: LINK, expires_in: 300 } }), {
          status: link.status ?? 200,
        }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function pin(body: Buffer): void {
  const sha256 = createHash("sha256").update(body).digest("hex");
  TEMPLATES["sample"] = { id: "M9001", sha256, bytes: body.length };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hf-templates-"));
  signedIn.value = true;
  archive = tarOf({ "SKILL.md": "# sample\n" });
  pin(archive);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete TEMPLATES["sample"];
  rmSync(dir, { recursive: true, force: true });
});

describe("pullTemplate", () => {
  it("asks the plan-gated route for the pinned bundle and unpacks it whole", async () => {
    const fetchMock = serve({});
    const path = await pullTemplate("sample", dir);
    expect(path).toBe(join(dir, "templates", "sample"));
    expect(readFileSync(join(path, "SKILL.md"), "utf8")).toBe("# sample\n");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      `/v1/hyperframes/moments/M9001/bundle?sha256=${TEMPLATES["sample"]?.sha256}`,
    );
  });

  it("leaves a template that is already there alone and spends no call", async () => {
    const fetchMock = serve({});
    mkdirSync(join(dir, "templates", "sample"), { recursive: true });
    await pullTemplate("sample", dir);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("turns a 402 into the upgrade step and writes nothing", async () => {
    serve({ status: 402 });
    await expect(pullTemplate("sample", dir)).rejects.toThrow("billing subscribe");
    expect(existsSync(join(dir, "templates", "sample"))).toBe(false);
  });

  it("asks for a sign-in when there is no credential or the server says 401", async () => {
    serve({ status: 401 });
    await expect(pullTemplate("sample", dir)).rejects.toThrow("auth login");
    signedIn.value = false;
    await expect(pullTemplate("sample", dir)).rejects.toThrow("auth login");
  });

  it("retries a 503 once, then stops without a public fallback", async () => {
    const fetchMock = serve({ status: 503 });
    await expect(pullTemplate("sample", dir)).rejects.toBeInstanceOf(PullRefused);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refuses a download that does not match its hash", async () => {
    serve({}, tarOf({ "SKILL.md": "changed\n" }));
    await expect(pullTemplate("sample", dir)).rejects.toThrow("hash");
    expect(existsSync(join(dir, "templates", "sample"))).toBe(false);
  });

  it("refuses an archive that climbs out of its folder and leaves no partial folder", async () => {
    const src = mkdtempSync(join(dir, "evil-"));
    mkdirSync(join(src, "a"));
    writeFileSync(join(src, "x.md"), "x");
    const out = join(dir, "evil.tar.gz");
    execFileSync("tar", ["-czf", out, "-C", join(src, "a"), "../x.md"]);
    const evil = readFileSync(out);
    pin(evil);
    serve({}, evil);
    await expect(pullTemplate("sample", dir)).rejects.toThrow("unsafe path");
    expect(existsSync(join(dir, "templates", "sample"))).toBe(false);
  });

  it("names the templates when the slug is unknown", async () => {
    await expect(pullTemplate("nope", dir)).rejects.toThrow("sample");
  });
});
