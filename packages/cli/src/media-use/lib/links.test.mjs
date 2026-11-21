import { strict as assert } from "node:assert";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { appendRecord, withReservedFileSync } from "./manifest.mjs";
import { freezeLocalFile } from "./freeze.mjs";
import { freezeLibraryLut, matchColorLook } from "./lut-preset-provider.mjs";
import { projectPrefsPath, recordPreference } from "./prefs-store.mjs";

// Planting a link needs no privileges on macOS and Linux; Windows needs developer mode for file links.
const posixOnly = { skip: process.platform === "win32" };

/** A project folder and a folder outside it holding one file that must survive every test. */
function withSandbox(fn) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "mu-links-")));
  const project = join(root, "project");
  const outside = join(root, "outside");
  mkdirSync(project);
  mkdirSync(outside);
  writeFileSync(join(outside, "keep.txt"), "keep me\n");
  const outsideUnchanged = () => {
    assert.deepEqual(readdirSync(outside), ["keep.txt"]);
    assert.equal(readFileSync(join(outside, "keep.txt"), "utf8"), "keep me\n");
  };
  return Promise.resolve(fn({ root, project, outside, outsideUnchanged })).finally(() =>
    rmSync(root, { recursive: true, force: true }),
  );
}

function plantLink(target, at) {
  mkdirSync(dirname(at), { recursive: true });
  symlinkSync(target, at);
}

function reserveAndWrite(project, type, ext) {
  return withReservedFileSync(project, type, ext, ({ fullPath, localPath }) => {
    writeFileSync(fullPath, "asset", { flag: "wx" });
    return localPath;
  });
}

test("a reservation refuses a linked .media before taking the lock", posixOnly, () =>
  withSandbox(({ project, outside, outsideUnchanged }) => {
    symlinkSync(outside, join(project, ".media"));
    assert.throws(
      () => reserveAndWrite(project, "image", ".png"),
      /leads outside the project|is a link/,
    );
    outsideUnchanged();
  }),
);

for (const [linked, type] of [
  ["images", "image"],
  ["audio", "sfx"],
  ["audio/sfx", "sfx"],
  ["video", "video"],
  ["luts", "lut"],
]) {
  test(
    `a reservation refuses a linked .media/${linked} before making anything in it`,
    posixOnly,
    () =>
      withSandbox(({ project, outside, outsideUnchanged }) => {
        plantLink(outside, join(project, ".media", linked));
        assert.throws(
          () => reserveAndWrite(project, type, ".bin"),
          /leads outside the project|is a link/,
        );
        outsideUnchanged();
      }),
  );
}

test("appending a record refuses a linked type folder", posixOnly, () =>
  withSandbox(({ project, outside, outsideUnchanged }) => {
    plantLink(outside, join(project, ".media", "images"));
    assert.throws(
      () => appendRecord(project, { id: "image_001", type: "image", path: ".media/images/x.png" }),
      /leads outside the project|is a link/,
    );
    outsideUnchanged();
  }),
);

test("an id past exact integers never lands on a name the project already holds", posixOnly, () =>
  withSandbox(({ project, outside, outsideUnchanged }) => {
    const huge = "9007199254740992";
    mkdirSync(join(project, ".media", "images"), { recursive: true });
    writeFileSync(
      join(project, ".media", "manifest.jsonl"),
      `${JSON.stringify({ id: `image_${huge}`, type: "image", path: "x" })}\n`,
    );
    plantLink(join(outside, "planted.png"), join(project, ".media", "images", `image_${huge}.png`));
    const source = join(project, "source.png");
    writeFileSync(source, "png");

    const localPath = withReservedFileSync(project, "image", ".png", ({ fullPath, localPath }) => {
      freezeLocalFile(source, fullPath);
      return localPath;
    });

    assert.equal(localPath, ".media/images/image_001.png");
    assert.ok(lstatSync(join(project, localPath)).isFile());
    outsideUnchanged();
  }),
);

test("the asset writers refuse a link at their own name instead of following it", posixOnly, () =>
  withSandbox(({ project, outside, outsideUnchanged }) => {
    const source = join(project, "source");
    writeFileSync(source, "<svg xmlns='http://www.w3.org/2000/svg'/>");
    for (const ext of [".png", ".svg"]) {
      const dest = join(project, `dest${ext}`);
      symlinkSync(join(outside, `target${ext}`), dest);
      assert.throws(() => freezeLocalFile(source, dest), /EEXIST/);
    }
    outsideUnchanged();
  }),
);

test("a frozen LUT never writes through a link at its .tmp name", posixOnly, () =>
  withSandbox(async ({ project, outside, outsideUnchanged }) => {
    const huge = "9007199254740992";
    mkdirSync(join(project, ".media", "luts"), { recursive: true });
    writeFileSync(
      join(project, ".media", "manifest.jsonl"),
      `${JSON.stringify({ id: `lut_${huge}`, type: "lut", path: "x" })}\n`,
    );
    plantLink(
      join(outside, "planted.cube"),
      join(project, ".media", "luts", `lut_${huge}.cube.tmp`),
    );
    const match = matchColorLook("teal orange blockbuster");

    const frozen = await freezeLibraryLut(match, {
      projectDir: project,
      type: "lut",
      localOnly: true,
    });

    assert.equal(frozen.localPath, ".media/luts/lut_001.cube");
    outsideUnchanged();
  }),
);

test("a project preference refuses a linked .media and writes nothing", posixOnly, () =>
  withSandbox(({ project, outside, outsideUnchanged }) => {
    symlinkSync(outside, join(project, ".media"));
    assert.throws(
      () => recordPreference({ projectDir: project, key: "aspect", value: "16:9" }),
      /leads outside the project|is a link/,
    );
    outsideUnchanged();
  }),
);

test("a project preference never writes through links at predictable temp names", posixOnly, () =>
  withSandbox(({ project, outside, outsideUnchanged }) => {
    const prefs = projectPrefsPath(project);
    mkdirSync(dirname(prefs), { recursive: true });
    for (let pid = process.pid - 5; pid <= process.pid + 5; pid += 1) {
      symlinkSync(join(outside, `planted-${pid}`), `${prefs}.${pid}.tmp`);
    }

    recordPreference({ projectDir: project, key: "aspect", value: "16:9" });

    // Opened without following a link, so a link left at the name would fail the open itself.
    const fd = openSync(prefs, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      assert.ok(fstatSync(fd).isFile());
      assert.equal(JSON.parse(readFileSync(fd, "utf8")).preferences.aspect.value, "16:9");
    } finally {
      closeSync(fd);
    }
    assert.equal(existsSync(join(outside, `planted-${process.pid}`)), false);
    outsideUnchanged();
  }),
);
