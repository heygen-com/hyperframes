import { afterEach, describe, expect, it } from "vitest";
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFsAdapter } from "./fs.js";

describe("fs adapter writes", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  function root(): string {
    const dir = mkdtempSync(join(tmpdir(), "hf-fs-adapter-"));
    dirs.push(dir);
    return dir;
  }

  it("replaces the file whole, so a reader holding the old one never sees a partial write", async () => {
    const dir = root();
    writeFileSync(join(dir, "comp.html"), "old");
    linkSync(join(dir, "comp.html"), join(dir, "reader.html"));

    await createFsAdapter({ root: dir }).write("comp.html", "new");

    expect(readFileSync(join(dir, "reader.html"), "utf-8")).toBe("old");
    expect(readFileSync(join(dir, "comp.html"), "utf-8")).toBe("new");
    expect(readdirSync(dir).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  // Windows keeps only a read-only bit, no group or other permissions.
  it.skipIf(process.platform === "win32")("keeps the file's mode", async () => {
    const dir = root();
    writeFileSync(join(dir, "comp.html"), "old");
    chmodSync(join(dir, "comp.html"), 0o640);

    await createFsAdapter({ root: dir }).write("comp.html", "new");

    expect(statSync(join(dir, "comp.html")).mode & 0o777).toBe(0o640);
  });

  // Windows needs a privilege to create symlinks.
  it.skipIf(process.platform === "win32")("writes through a link to its target", async () => {
    const dir = root();
    writeFileSync(join(dir, "target.html"), "old");
    symlinkSync(join(dir, "target.html"), join(dir, "comp.html"));

    await createFsAdapter({ root: dir }).write("comp.html", "new");

    expect(lstatSync(join(dir, "comp.html")).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(dir, "target.html"), "utf-8")).toBe("new");
  });

  it.skipIf(process.platform === "win32")(
    "creates the target of a link that points at no file yet",
    async () => {
      const dir = root();
      symlinkSync(join(dir, "target.html"), join(dir, "comp.html"));

      await createFsAdapter({ root: dir }).write("comp.html", "new");

      expect(lstatSync(join(dir, "comp.html")).isSymbolicLink()).toBe(true);
      expect(readFileSync(join(dir, "target.html"), "utf-8")).toBe("new");
    },
  );

  it.skipIf(process.platform === "win32")("follows a chain of relative links", async () => {
    const dir = root();
    writeFileSync(join(dir, "target.html"), "old");
    symlinkSync("target.html", join(dir, "middle.html"));
    symlinkSync("middle.html", join(dir, "comp.html"));

    await createFsAdapter({ root: dir }).write("comp.html", "new");

    expect(lstatSync(join(dir, "comp.html")).isSymbolicLink()).toBe(true);
    expect(lstatSync(join(dir, "middle.html")).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(dir, "target.html"), "utf-8")).toBe("new");
  });

  it.skipIf(process.platform === "win32")(
    "follows a relative link inside a linked project folder to the real target",
    async () => {
      const base = root();
      mkdirSync(join(base, "real/deep/sub"), { recursive: true });
      mkdirSync(join(base, "root"));
      symlinkSync(join(base, "real/deep/sub"), join(base, "root/sub"));
      writeFileSync(join(base, "real/deep/target.html"), "old");
      symlinkSync("../target.html", join(base, "real/deep/sub/comp.html"));

      await createFsAdapter({ root: join(base, "root") }).write("sub/comp.html", "new");

      expect(readFileSync(join(base, "real/deep/target.html"), "utf-8")).toBe("new");
      expect(existsSync(join(base, "root/target.html"))).toBe(false);
    },
  );

  it("creates a new file in a new folder", async () => {
    const dir = root();

    await createFsAdapter({ root: dir }).write("scenes/intro.html", "intro");

    expect(readFileSync(join(dir, "scenes/intro.html"), "utf-8")).toBe("intro");
  });
});
