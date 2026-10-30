import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { noHandlerMessage, type StageDeps, stagePrebuiltHandler } from "./prebuiltHandler.js";

const ZIP = Buffer.from("prebuilt handler zip");
const SHA = createHash("sha256").update(ZIP).digest("hex");
const URL = "https://github.com/heygen-com/hyperframes/releases/download/v9.8.7/x.zip";
const dirs: string[] = [];

function setup(body: Buffer = ZIP) {
  const root = mkdtempSync(join(tmpdir(), "hf-prebuilt-"));
  dirs.push(root);
  const templatePath = join(root, "template.yaml");
  writeFileSync(templatePath, "CodeUri: handler.zip\n");
  writeFileSync(join(root, "video-function.yaml"), "PackageType: Image\n");
  const downloads: string[] = [];
  const logs: string[] = [];
  const deps: StageDeps = {
    loadAdapter: async () => ({
      prebuiltHandler: () => ({
        version: "9.8.7",
        url: URL,
        sha256: SHA,
        bytes: ZIP.length,
        templatePath,
      }),
    }),
    download: async (url, dest) => {
      downloads.push(url);
      writeFileSync(dest, body);
    },
    cacheDir: join(root, "cache"),
    log: (line) => logs.push(line),
  };
  return { deps, downloads, logs };
}

function missingModule(): Error {
  return Object.assign(new Error("Cannot find package '@hyperframes/aws-lambda' imported from x"), {
    code: "ERR_MODULE_NOT_FOUND",
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("stagePrebuiltHandler", () => {
  it("downloads the pinned zip once, then reuses the verified copy beside the template", async () => {
    const { deps, downloads, logs } = setup();

    const dir = await stagePrebuiltHandler(deps);
    expect(logs).toContain(`→ Verified sha256 ${SHA}`);
    expect(dir).toBe(join(deps.cacheDir, `9.8.7-${SHA}`));
    expect(readFileSync(join(dir, "handler.zip"))).toEqual(ZIP);
    expect(readFileSync(join(dir, "template.yaml"), "utf-8")).toBe("CodeUri: handler.zip\n");
    expect(readFileSync(join(dir, "video-function.yaml"), "utf-8")).toBe("PackageType: Image\n");

    expect(await stagePrebuiltHandler(deps)).toBe(dir);
    expect(downloads).toEqual([URL]);
  });

  it("re-downloads a cached copy that no longer matches the pin", async () => {
    const { deps, downloads } = setup();
    const dir = await stagePrebuiltHandler(deps);
    writeFileSync(join(dir, "handler.zip"), "tampered");

    await stagePrebuiltHandler(deps);
    expect(readFileSync(join(dir, "handler.zip"))).toEqual(ZIP);
    expect(downloads).toHaveLength(2);
  });

  it("refuses a download whose sha256 does not match and keeps nothing to deploy", async () => {
    vi.stubEnv("HYPERFRAMES_LAMBDA_HANDLER_URL", "https://b.example/h.zip?X-Amz-Signature=secret");
    const { deps } = setup(Buffer.from("something else"));

    const refusal = stagePrebuiltHandler(deps);
    await expect(refusal).rejects.toThrow(
      /Refusing the handler ZIP from https:\/\/b\.example\/h\.zip: sha256/,
    );
    await expect(refusal).rejects.not.toThrow(/secret/);
    const dir = join(deps.cacheDir, `9.8.7-${SHA}`);
    expect(existsSync(join(dir, "handler.zip"))).toBe(false);
    expect(existsSync(join(dir, "handler.zip.download"))).toBe(false);
    expect(existsSync(join(dir, "template.yaml"))).toBe(false);
  });

  it("fetches from HYPERFRAMES_LAMBDA_HANDLER_URL when set, still against the pinned sha256", async () => {
    vi.stubEnv("HYPERFRAMES_LAMBDA_HANDLER_URL", "https://mirror.example/handler.zip");
    const { deps, downloads } = setup();

    await stagePrebuiltHandler(deps);
    expect(downloads).toEqual(["https://mirror.example/handler.zip"]);
  });
});

describe("stagePrebuiltHandler with nothing to deploy", () => {
  it("names the adapter install, the checkout alternative and the docs when the adapter is missing", async () => {
    const { deps, downloads } = setup();
    deps.loadAdapter = async () => {
      throw missingModule();
    };

    await expect(stagePrebuiltHandler(deps)).rejects.toThrow(noHandlerMessage(false));
    const message = noHandlerMessage(false);
    expect(message).toMatch(/npm install -g @hyperframes\/aws-lambda@/);
    expect(message).toMatch(/HYPERFRAMES_REPO_ROOT/);
    expect(message).toMatch(/^Docs: https:\/\/hyperframes\.heygen\.com\/deploy\/aws-lambda$/m);
    expect(downloads).toEqual([]);
  });

  it("says the installed adapter has no prebuilt handler when it pins none", async () => {
    const { deps, downloads } = setup();
    deps.loadAdapter = async () => ({});

    await expect(stagePrebuiltHandler(deps)).rejects.toThrow(noHandlerMessage(true));
    expect(noHandlerMessage(true)).toMatch(/has no prebuilt handler for its version/);
    expect(downloads).toEqual([]);
  });
});
