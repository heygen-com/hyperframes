import { strict as assert } from "node:assert";
import { posix, win32 } from "node:path";
import { test } from "node:test";
import {
  insideProject,
  readFileInsideProject,
  recordAvailable,
  recordPathInProject,
  resolveInsideProject,
} from "./record-path.mjs";

const PROJECT = "C:\\work\\proj";

// A file system that answers from a set of present paths and records every path it is asked about.
function spyFs(present = []) {
  const asked = [];
  const has = new Set(present.map((p) => p.toLowerCase()));
  const dirs = new Set();
  for (const p of present) {
    let cur = win32.dirname(p);
    while (cur && !dirs.has(cur.toLowerCase())) {
      dirs.add(cur.toLowerCase());
      const parent = win32.dirname(cur);
      if (parent === cur) break;
      cur = parent;
    }
  }
  return {
    asked,
    existsSync: (p) => (asked.push(p), has.has(String(p).toLowerCase())),
    realpathSync: (p) => (asked.push(p), p),
    lstatSync: (p) => {
      asked.push(p);
      const k = String(p).toLowerCase();
      if (dirs.has(k))
        return { isSymbolicLink: () => false, isDirectory: () => true, isFile: () => false };
      if (has.has(k))
        return { isSymbolicLink: () => false, isDirectory: () => false, isFile: () => true };
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    },
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
      const k = key(p);
      if (byPath.has(k))
        return { isSymbolicLink: () => true, isDirectory: () => false, isFile: () => false };
      if (k.startsWith(key(PROJECT))) {
        const isFile = /\.[^\\/]+$/.test(p);
        return { isSymbolicLink: () => false, isDirectory: () => !isFile, isFile: () => isFile };
      }
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
  assert.equal(
    resolveInsideProject(PROJECT, link, { fs, pathApi: win32 }),
    win32.join(PROJECT, "looks", "real.cube"),
  );
});

test("a loop of links is refused", () => {
  const a = win32.join(PROJECT, "a.cube");
  const b = win32.join(PROJECT, "b.cube");
  const fs = linkFs({ [a]: "b.cube", [b]: "a.cube" });
  assert.equal(insideProject(PROJECT, a, { fs, pathApi: win32 }), null);
});

// fails without the fix: the walk caught lstat errors and returned the unchecked path.
test("an unresolved component fails closed", () => {
  const missing = win32.join(PROJECT, "missing.cube");
  const fs = linkFs({});
  fs.lstatSync = (p) => {
    fs.asked.push(`lstat ${p}`);
    throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
  };
  assert.equal(insideProject(PROJECT, missing, { fs, pathApi: win32 }), null);
  assert.equal(resolveInsideProject(PROJECT, missing, { fs, pathApi: win32 }), null);
});

// fails without the fix: target text with .. was collapsed with path.resolve before walking sub.
test("a link target with .. after an outside link is refused without lexical collapsing", () => {
  const link = win32.join(PROJECT, "grade.cube");
  const sub = win32.join(PROJECT, "sub");
  const fs = linkFs({
    [link]: "sub\\..\\real.cube",
    [sub]: "\\\\other-host\\share\\dir",
  });
  assert.equal(insideProject(PROJECT, link, { fs, pathApi: win32 }), null);
});

test("a link target with .. after a non-directory file is refused", () => {
  const link = win32.join(PROJECT, "grade.cube");
  const fs = linkFs({ [link]: "plain.cube\\..\\real.cube" });
  assert.equal(insideProject(PROJECT, link, { fs, pathApi: win32 }), null);
});

// fails without the fix: recordAvailable discarded the checked destination and called existsSync on the original link.
test("recordAvailable does not query the original link after the check if the link is swapped", () => {
  const link = win32.join(PROJECT, "grade.cube");
  const target = win32.join(PROJECT, "looks", "real.cube");
  const links = { [link]: "looks\\real.cube" };
  const fs = linkFs(links);
  const realLstat = fs.lstatSync;
  fs.lstatSync = (p) => {
    const stat = realLstat(p);
    if (p.toLowerCase() === target.toLowerCase()) {
      links[link] = "\\\\other-host\\share\\boom.cube";
    }
    return stat;
  };
  fs.existsSync = (p) => {
    fs.asked.push(`exists ${p}`);
    return p.toLowerCase() === PROJECT.toLowerCase() || p.toLowerCase() === target.toLowerCase();
  };
  assert.equal(
    recordAvailable(
      PROJECT,
      { id: "lut_1", type: "lut", path: "grade.cube" },
      { fs, pathApi: win32 },
    ),
    true,
  );
  assert.ok(!fs.asked.includes(`exists ${link}`), `should not query original link: ${fs.asked}`);
});

// fails without the fix: openDirChecked leaked the opened directory fd when fstatSync threw.
test("readFileInsideProject closes the directory descriptor if fstatSync throws", () => {
  const root = "/work/proj";
  const file = "/work/proj/looks/real.cube";
  const openFds = new Set();
  let nextFd = 100;
  const dirStat = (ino) => ({
    dev: 1,
    ino,
    isSymbolicLink: () => false,
    isDirectory: () => true,
    isFile: () => false,
  });
  const fileStat = {
    dev: 1,
    ino: 3,
    isSymbolicLink: () => false,
    isDirectory: () => false,
    isFile: () => true,
  };
  const stats = new Map([
    [root, dirStat(1)],
    ["/work/proj/looks", dirStat(2)],
    [file, fileStat],
  ]);
  const fs = {
    constants: { O_RDONLY: 0, O_DIRECTORY: 1, O_NOFOLLOW: 2, O_NONBLOCK: 4 },
    realpathSync: (p) => p,
    lstatSync: (p) => {
      const s = stats.get(p);
      if (!s) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return s;
    },
    openSync: () => {
      const fd = nextFd++;
      openFds.add(fd);
      return fd;
    },
    fstatSync: (fd) => {
      if (fd === 101) throw Object.assign(new Error("EIO"), { code: "EIO" });
      return dirStat(1);
    },
    closeSync: (fd) => {
      openFds.delete(fd);
    },
  };
  assert.equal(readFileInsideProject(root, file, { fs, pathApi: posix }), null);
  assert.deepEqual(
    [...openFds],
    [],
    "every opened directory descriptor must be closed on fstat error",
  );
});
