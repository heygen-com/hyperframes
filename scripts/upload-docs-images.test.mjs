import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

const SCRIPT = join(import.meta.dirname, "upload-docs-images.sh");

/**
 * Runs a copy of the upload script in a throwaway checkout, with `aws` on PATH replaced by a stub that records
 * its arguments, so nothing can reach S3. `arrange` lays out the checkout before the run.
 */
function upload(arrange) {
  const root = mkdtempSync(join(tmpdir(), "hf-upload-docs-"));
  try {
    const checkout = join(root, "checkout");
    mkdirSync(join(checkout, "scripts"), { recursive: true });
    copyFileSync(SCRIPT, join(checkout, "scripts", "upload-docs-images.sh"));
    const bin = join(root, "bin");
    const log = join(root, "aws.log");
    mkdirSync(bin);
    writeFileSync(join(bin, "aws"), `#!/bin/sh\necho "$*" >> "${log}"\n`);
    chmodSync(join(bin, "aws"), 0o755);
    const secret = join(root, "outside");
    mkdirSync(secret);
    writeFileSync(join(secret, ".env"), "SECRET=1");
    arrange({ checkout, images: join(checkout, "docs", "images"), secret });
    const run = spawnSync("bash", [join(checkout, "scripts", "upload-docs-images.sh")], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      encoding: "utf8",
    });
    return { ...run, aws: existsSync(log) ? readFileSync(log, "utf8") : "" };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const withImages = (images) => {
  mkdirSync(join(images, "catalog"), { recursive: true });
  writeFileSync(join(images, "catalog", "a.png"), "png");
  writeFileSync(join(images, "b.mp4"), "mp4");
};

describe("upload-docs-images.sh", () => {
  it("uploads ordinary files without following links", () => {
    const run = upload(({ images }) => withImages(images));
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.aws, /s3 sync .*--no-follow-symlinks/);
    assert.match(run.aws, /cloudfront create-invalidation/);
  });

  it("refuses before any upload when a file under docs/images is a link", () => {
    const run = upload(({ images, secret }) => {
      withImages(images);
      symlinkSync(join(secret, ".env"), join(images, "catalog", "env.png"));
    });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /catalog\/env\.png/);
    assert.equal(run.aws, "");
  });

  it("refuses before any upload when a folder under docs/images is a link", () => {
    const run = upload(({ images, secret }) => {
      withImages(images);
      symlinkSync(secret, join(images, "up"));
    });
    assert.notEqual(run.status, 0);
    assert.equal(run.aws, "");
  });

  it("refuses before any upload when docs/images itself is a link", () => {
    const run = upload(({ checkout, secret }) => {
      mkdirSync(join(checkout, "docs"));
      symlinkSync(secret, join(checkout, "docs", "images"));
    });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /not a folder inside this checkout/);
    assert.equal(run.aws, "");
  });
});
