import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  adapterPackageRoot,
  prebuiltHandler,
  prebuiltVideoImage,
  VIDEO_IMAGE_ASSET,
  VIDEO_IMAGE_MANIFEST_FILE,
} from "../src/sdk/prebuiltHandler.js";
import { pinHandlerZip, pinReleaseAsset } from "./pin-handler-zip.js";

const examples = join(import.meta.dir, "..", "..", "..", "examples", "aws-lambda");
const realTemplate = readFileSync(join(examples, "template.yaml"), "utf-8");
const videoTemplate = readFileSync(join(examples, "video-function.yaml"), "utf-8");
const dirs: string[] = [];

function fixtureRepo(): { root: string; pkgDir: string } {
  const root = mkdtempSync(join(tmpdir(), "hf-pin-zip-"));
  dirs.push(root);
  const pkgDir = join(root, "packages", "aws-lambda");
  mkdirSync(join(pkgDir, "dist"), { recursive: true });
  writeFileSync(
    join(pkgDir, "package.json"),
    JSON.stringify({
      name: "@hyperframes/aws-lambda",
      version: "9.8.7",
      repository: { url: "https://github.com/heygen-com/hyperframes" },
    }),
  );
  mkdirSync(join(root, "examples", "aws-lambda"), { recursive: true });
  writeFileSync(join(root, "examples", "aws-lambda", "template.yaml"), realTemplate);
  writeFileSync(join(root, "examples", "aws-lambda", "video-function.yaml"), videoTemplate);
  return { root, pkgDir };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("pinHandlerZip", () => {
  it("moves the built zip out of the package and pins its URL and sha256 for this version", () => {
    const { root, pkgDir } = fixtureRepo();
    const zip = Buffer.from("zip bytes");
    writeFileSync(join(pkgDir, "dist", "handler.zip"), zip);
    writeFileSync(join(pkgDir, "dist", "handler.zip.manifest.json"), "{}");
    const sha256 = createHash("sha256").update(zip).digest("hex");

    const manifest = pinHandlerZip(root);

    expect(manifest).toEqual({
      version: "9.8.7",
      url: "https://github.com/heygen-com/hyperframes/releases/download/v9.8.7/hyperframes-lambda-handler.zip",
      sha256,
      bytes: zip.length,
    });
    // Nothing large is left for npm to pack.
    expect(existsSync(join(pkgDir, "dist", "handler.zip"))).toBe(false);
    expect(existsSync(join(pkgDir, "dist", "handler.zip.manifest.json"))).toBe(false);
    expect(readFileSync(join(root, "dist", "hyperframes-lambda-handler.zip"))).toEqual(zip);
    expect(readFileSync(join(root, "dist", "hyperframes-lambda-handler.sha256"), "utf-8")).toBe(
      `${sha256}  hyperframes-lambda-handler.zip\n`,
    );

    const pinned = prebuiltHandler(pkgDir);
    expect(pinned).toEqual({
      ...manifest,
      templatePath: join(pkgDir, "prebuilt", "template.yaml"),
    });
    const template = readFileSync(pinned!.templatePath, "utf-8");
    expect(template).toContain("      CodeUri: handler.zip\n");
    expect(template).not.toContain("packages/aws-lambda/dist/handler.zip\n");
    expect(template).toContain("      TemplateURL: video-function.yaml\n");
    expect(readFileSync(join(pkgDir, "prebuilt", "video-function.yaml"), "utf-8")).toBe(
      videoTemplate,
    );
  });

  it("pins a zip a previous run already attached to the release", () => {
    const { root, pkgDir } = fixtureRepo();
    mkdirSync(join(root, "dist"));
    writeFileSync(join(root, "dist", "hyperframes-lambda-handler.zip"), "attached");

    expect(pinHandlerZip(root).sha256).toBe(createHash("sha256").update("attached").digest("hex"));
    expect(prebuiltHandler(pkgDir)?.sha256).toBe(pinHandlerZip(root).sha256);
  });

  it("refuses a template whose CodeUri it cannot rewrite", () => {
    const { root, pkgDir } = fixtureRepo();
    writeFileSync(join(pkgDir, "dist", "handler.zip"), "zip");
    writeFileSync(
      join(root, "examples", "aws-lambda", "template.yaml"),
      "CodeUri: elsewhere.zip\n",
    );

    expect(() => pinHandlerZip(root)).toThrow(/expected exactly one/);
  });
});

describe("pinReleaseAsset", () => {
  it("pins the arm64 video image beside the handler zip without touching the zip's pin", () => {
    const { root, pkgDir } = fixtureRepo();
    writeFileSync(join(pkgDir, "dist", "handler.zip"), "zip");
    const zipPin = pinHandlerZip(root);
    const image = Buffer.from("oci layout tar");
    writeFileSync(join(root, "dist", VIDEO_IMAGE_ASSET), image);
    const sha256 = createHash("sha256").update(image).digest("hex");

    const manifest = pinReleaseAsset(root, VIDEO_IMAGE_ASSET, VIDEO_IMAGE_MANIFEST_FILE);

    expect(manifest).toEqual({
      version: "9.8.7",
      url: "https://github.com/heygen-com/hyperframes/releases/download/v9.8.7/hyperframes-lambda-video-arm64.oci.tar",
      sha256,
      bytes: image.length,
    });
    expect(readFileSync(join(root, "dist", "hyperframes-lambda-video-arm64.sha256"), "utf-8")).toBe(
      `${sha256}  hyperframes-lambda-video-arm64.oci.tar\n`,
    );
    expect(prebuiltVideoImage(pkgDir)).toEqual(manifest);
    expect(prebuiltHandler(pkgDir)?.sha256).toBe(zipPin.sha256);
  });
});

describe("prebuiltHandler", () => {
  it("reads from its own package root", () => {
    expect(adapterPackageRoot()).toBe(join(import.meta.dir, ".."));
  });

  it("is undefined when the package carries no pinned zip", () => {
    const { pkgDir } = fixtureRepo();
    expect(prebuiltHandler(pkgDir)).toBeUndefined();
  });

  it("has no video image when the package pins only the zip", () => {
    const { root, pkgDir } = fixtureRepo();
    writeFileSync(join(pkgDir, "dist", "handler.zip"), "zip");
    pinHandlerZip(root);
    expect(prebuiltVideoImage(pkgDir)).toBeUndefined();
  });
});
