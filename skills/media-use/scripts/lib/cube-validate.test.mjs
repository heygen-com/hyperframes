import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { validateCube } from "./cube-validate.mjs";

const IDENTITY_2 = `
# comment
TITLE "Identity 2"
DOMAIN_MIN 0 0 0
DOMAIN_MAX 1 1 1
LUT_3D_SIZE 2
0 0 0
1 0 0
0 1 0
1 1 0
0 0 1
1 0 1
0 1 1
1 1 1
`;

test("accepts a valid minimal 3D cube LUT", () => {
  const result = validateCube(IDENTITY_2);
  assert.deepEqual(result, { ok: true, size: 2 });
});

test("rejects oversize LUTs with the core parser message", () => {
  const result = validateCube("LUT_3D_SIZE 65", { maxSize: 64 });
  assert.equal(result.ok, false);
  assert.match(result.error, /LUT_3D_SIZE 65 exceeds max 64/);
});

test("rejects data rows before LUT_3D_SIZE", () => {
  const result = validateCube("0 0 0\nLUT_3D_SIZE 2");
  assert.equal(result.ok, false);
  assert.match(result.error, /LUT data appears before LUT_3D_SIZE/);
});

test("rejects missing LUT_3D_SIZE", () => {
  const result = validateCube('TITLE "No Size"');
  assert.equal(result.ok, false);
  assert.match(result.error, /Missing LUT_3D_SIZE/);
});

test("rejects row count mismatches with the core parser message", () => {
  const result = validateCube("LUT_3D_SIZE 2\n0 0 0");
  assert.equal(result.ok, false);
  assert.match(result.error, /Expected 8 LUT rows/);
});

test("rejects inverted domains", () => {
  const result = validateCube(`
    DOMAIN_MIN 0 0 0
    DOMAIN_MAX 1 0 1
    LUT_3D_SIZE 2
    0 0 0
    1 0 0
    0 1 0
    1 1 0
    0 0 1
    1 0 1
    0 1 1
    1 1 1
  `);
  assert.equal(result.ok, false);
  assert.match(result.error, /DOMAIN_MAX values must be greater than DOMAIN_MIN values/);
});

test("rejects unsupported 1D and mixed cube LUTs", () => {
  const oneD = validateCube("LUT_1D_SIZE 2\n0 0 0\n1 1 1");
  assert.equal(oneD.ok, false);
  assert.match(oneD.error, /1D cube LUTs are not supported yet/);

  const mixed = validateCube(`
    LUT_1D_SIZE 2
    LUT_3D_SIZE 2
    0 0 0
    1 0 0
    0 1 0
    1 1 0
    0 0 1
    1 0 1
    0 1 1
    1 1 1
  `);
  assert.equal(mixed.ok, false);
  assert.match(mixed.error, /Mixed 1D and 3D cube LUTs are not supported yet/);
});

test("CLI exits zero for valid files and non-zero for invalid files", () => {
  const dir = mkdtempSync(join(tmpdir(), "mu-cube-validate-"));
  try {
    const valid = join(dir, "valid.cube");
    const invalid = join(dir, "invalid.cube");
    writeFileSync(valid, IDENTITY_2);
    writeFileSync(invalid, "LUT_3D_SIZE 65");

    const out = execFileSync(
      process.execPath,
      [new URL("./cube-validate.mjs", import.meta.url).pathname, valid],
      {
        encoding: "utf8",
      },
    );
    assert.match(out, /ok: LUT_3D_SIZE 2/);

    assert.throws(
      () =>
        execFileSync(
          process.execPath,
          [new URL("./cube-validate.mjs", import.meta.url).pathname, invalid],
          {
            encoding: "utf8",
            stdio: "pipe",
          },
        ),
      (err) => err.status === 1 && String(err.stderr).includes("exceeds max 64"),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
