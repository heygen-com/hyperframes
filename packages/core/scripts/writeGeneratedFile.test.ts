import assert from "node:assert/strict";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { writeGeneratedFile } from "./writeGeneratedFile.js";

const workDir = mkdtempSync(join(tmpdir(), "write-generated-"));
after(() => rmSync(workDir, { recursive: true, force: true }));

const target = (name: string) => join(workDir, `${name}.ts`);

describe("writeGeneratedFile", () => {
  it("publishes the whole file and leaves no temp behind", () => {
    const out = target("published");
    const contents = `export const BIG = ${JSON.stringify("x".repeat(50_000))};\n`;

    assert.equal(writeGeneratedFile(out, contents), true);

    assert.equal(readFileSync(out, "utf8"), contents);
    assert.deepEqual(
      readdirSync(workDir).filter((f) => f.endsWith(".tmp")),
      [],
    );
  });

  it("leaves the target untouched when the content is byte-identical", () => {
    const out = target("unchanged");
    const contents = "export const A = 1;\n";
    writeGeneratedFile(out, contents);
    // Backdated so a republish cannot coincidentally land on the same mtime. Read the
    // stamp back rather than trusting the one just set: filesystems round it.
    const backdated = new Date(Date.now() - 60_000);
    utimesSync(out, backdated, backdated);
    const before = statSync(out).mtimeMs;

    assert.equal(writeGeneratedFile(out, contents), false);

    assert.equal(statSync(out).mtimeMs, before);
  });

  it("replaces the target rather than rewriting it in place", () => {
    const out = target("replaced");
    writeFileSync(out, "export const A = 1;\n", "utf8");
    const before = statSync(out).ino;

    assert.equal(writeGeneratedFile(out, "export const A = 2;\n"), true);

    assert.equal(readFileSync(out, "utf8"), "export const A = 2;\n");
    // A new inode is the observable proof the target was swapped in whole. Rewriting
    // in place keeps the inode and exposes a truncated file to a concurrent reader.
    assert.notEqual(statSync(out).ino, before);
  });

  it("creates the directory when it does not exist yet", () => {
    const out = join(workDir, "nested", "deeper", "created.ts");

    assert.equal(writeGeneratedFile(out, "export const A = 1;\n"), true);

    assert.equal(readFileSync(out, "utf8"), "export const A = 1;\n");
  });
});
