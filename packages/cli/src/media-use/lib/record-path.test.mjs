import { strict as assert } from "node:assert";
import { win32 } from "node:path";
import { test } from "node:test";
import { insideProject, recordAvailable, recordPathInProject } from "./record-path.mjs";

const PROJECT = "C:\\work\\proj";

// A file system that answers from a set of present paths and records every path it is asked about.
function spyFs(present = []) {
  const asked = [];
  const has = new Set(present.map((p) => p.toLowerCase()));
  return {
    asked,
    existsSync: (p) => (asked.push(p), has.has(String(p).toLowerCase())),
    realpathSync: (p) => (asked.push(p), p),
  };
}

const OUTSIDE = [
  "\\\\other-host\\share\\boom.mp3",
  "//other-host/share/boom.mp3",
  "\\\\?\\UNC\\other-host\\share\\boom.mp3",
  "//?/UNC/other-host/share/boom.mp3",
  "\\\\.\\C:\\work\\proj\\boom.mp3",
  "//./C:/work/proj/boom.mp3",
  "\\\\?\\C:\\work\\proj\\boom.mp3",
  "D:\\boom.mp3",
  "D:boom.mp3",
  "C:\\work\\proj\\boom.mp3",
  "\\work\\proj\\boom.mp3",
  "..\\outside\\boom.mp3",
  "../outside/boom.mp3",
  "assets\\..\\..\\outside\\boom.mp3",
  "..",
];

for (const path of OUTSIDE) {
  test(`a Windows manifest path ${JSON.stringify(path)} is refused from its text, with no file-system call`, () => {
    const fs = spyFs([PROJECT, path]);
    assert.equal(recordPathInProject(PROJECT, path, win32), null);
    assert.equal(
      recordAvailable(PROJECT, { id: "sfx_001", type: "sfx", path }, { fs, pathApi: win32 }),
      false,
    );
    assert.deepEqual(fs.asked, []);
  });
}

for (const path of [
  "assets\\sfx\\boom.mp3",
  "assets/sfx/boom.mp3",
  ".media/audio/sfx/sfx_001.mp3",
]) {
  test(`a Windows manifest path ${JSON.stringify(path)} inside the project is checked on disk`, () => {
    const file = win32.resolve(PROJECT, path);
    const fs = spyFs([PROJECT, file]);
    assert.equal(recordPathInProject(PROJECT, path, win32), file);
    assert.equal(
      recordAvailable(PROJECT, { id: "sfx_001", type: "sfx", path }, { fs, pathApi: win32 }),
      true,
    );
    assert.ok(fs.asked.length > 0);
    assert.ok(
      fs.asked.every((asked) =>
        win32.resolve(asked).toLowerCase().startsWith(PROJECT.toLowerCase()),
      ),
    );
  });
}

test("an inline grade with no path is available without touching the file system", () => {
  const fs = spyFs();
  assert.ok(
    recordAvailable(
      PROJECT,
      { type: "grade", grading: { preset: "warm" } },
      { fs, pathApi: win32 },
    ),
  );
  assert.deepEqual(fs.asked, []);
});

// A file system with links: lstat and readlink read a link's text; exists and realpath would follow it.
function linkFs(links) {
  const asked = [];
  const key = (p) => String(p).toLowerCase();
  const byPath = new Map(Object.entries(links).map(([from, to]) => [key(from), to]));
  return {
    asked,
    existsSync: (p) => (asked.push(`exists ${p}`), key(p) === key(PROJECT)),
    realpathSync: (p) => (asked.push(`realpath ${p}`), p),
    lstatSync: (p) => {
      asked.push(`lstat ${p}`);
      if (byPath.has(key(p)) || key(p).startsWith(key(PROJECT)))
        return { isSymbolicLink: () => byPath.has(key(p)) };
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    },
    readlinkSync: (p) => (asked.push(`readlink ${p}`), byPath.get(key(p))),
  };
}

// fails without the fix: the inside check asked whether the link existed, which follows it to the share.
test("a link in the project to a share is refused with only its own text read", () => {
  const link = win32.join(PROJECT, "looks", "grade.cube");
  const fs = linkFs({ [link]: "\\\\other-host\\share\\grade.cube" });
  assert.equal(insideProject(PROJECT, link, { fs, pathApi: win32 }), null);
  assert.deepEqual(
    fs.asked.filter((asked) => !asked.endsWith(PROJECT)),
    [`lstat ${win32.join(PROJECT, "looks")}`, `lstat ${link}`, `readlink ${link}`],
  );
});

test("a link in the project to another file in it is followed", () => {
  const link = win32.join(PROJECT, "grade.cube");
  const fs = linkFs({ [link]: "looks\\real.cube" });
  assert.equal(insideProject(PROJECT, link, { fs, pathApi: win32 }), "looks\\real.cube");
});

test("a loop of links is refused", () => {
  const a = win32.join(PROJECT, "a.cube");
  const b = win32.join(PROJECT, "b.cube");
  const fs = linkFs({ [a]: "b.cube", [b]: "a.cube" });
  assert.equal(insideProject(PROJECT, a, { fs, pathApi: win32 }), null);
});
