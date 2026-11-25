import { strict as assert } from "node:assert";
import { win32 } from "node:path";
import { test } from "node:test";
import { recordAvailable, recordPathInProject } from "./record-path.mjs";

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
  "\\\\evil-host\\share\\boom.mp3",
  "//evil-host/share/boom.mp3",
  "\\\\?\\UNC\\evil-host\\share\\boom.mp3",
  "//?/UNC/evil-host/share/boom.mp3",
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
