import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { prepareHyperframeLintBody } from "./hyperframeLint.js";

const hooks = vi.hoisted(() => {
  const state: {
    swap?: () => void;
    target: string;
    descriptors: Set<number>;
    failStat: boolean;
    failRead: boolean;
  } = {
    target: "",
    descriptors: new Set(),
    failStat: false,
    failRead: false,
  };
  return state;
});
vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  const swap = () => {
    const run = hooks.swap;
    hooks.swap = undefined;
    run?.();
  };
  return {
    ...fs,
    openSync: (...args: Parameters<typeof fs.openSync>) => {
      const fd = fs.openSync(...args);
      hooks.descriptors.add(fd);
      return fd;
    },
    statSync: (...args: Parameters<typeof fs.statSync>) => {
      const stat = fs.statSync(...args);
      if (args[0] === hooks.target) swap();
      return stat;
    },
    fstatSync: (...args: Parameters<typeof fs.fstatSync>) => {
      if (hooks.failStat) throw new Error("stat failure");
      const stat = fs.fstatSync(...args);
      swap();
      return stat;
    },
    readFileSync: (...args: Parameters<typeof fs.readFileSync>) => {
      if (hooks.failRead) throw new Error("read failure");
      return fs.readFileSync(...args);
    },
    closeSync: (fd: number) => {
      fs.closeSync(fd);
      hooks.descriptors.delete(fd);
    },
  };
});
vi.mock("@hyperframes/lint", () => ({ lintHyperframeHtml: vi.fn() }));
const fs = await vi.importActual<typeof import("node:fs")>("node:fs");
let root: string;
let projectDir: string;
beforeEach(() => {
  root = fs.mkdtempSync(join(tmpdir(), "hf-lint-entry-"));
  projectDir = join(root, "project");
  fs.mkdirSync(projectDir);
  Object.assign(hooks, { target: "", swap: undefined, failStat: false, failRead: false });
});
afterEach(() => {
  const leaked = [...hooks.descriptors];
  for (const fd of leaked) fs.closeSync(fd);
  hooks.descriptors.clear();
  fs.rmSync(root, { recursive: true, force: true });
  expect(leaked).toEqual([]);
});
function writeEntry(name: string, html = "<html>checked</html>") {
  const path = join(projectDir, name);
  fs.mkdirSync(resolve(path, ".."), { recursive: true });
  fs.writeFileSync(path, html);
  return path;
}
function prepare(entryFile?: string) {
  return prepareHyperframeLintBody({ projectDir, entryFile });
}
function expected(entryFile: string, html = "<html>checked</html>") {
  return { prepared: { entryFile, html, source: "projectDir" } };
}

describe("project entry reads", () => {
  it.each(["preferred.html", "index.html", "src/index.html"])(
    "reads the checked file when %s is replaced",
    (entry) => {
      hooks.target = writeEntry(entry);
      hooks.swap = () => {
        fs.renameSync(hooks.target, join(root, "original.html"));
        fs.writeFileSync(hooks.target, "<html>unchecked</html>");
      };
      expect(prepare(entry === "preferred.html" ? entry : undefined)).toEqual(expected(entry));
      expect(hooks.swap).toBeUndefined();
    },
  );
  it("prefers requested entries and accepts empty HTML", () => {
    writeEntry("preferred.html", "");
    writeEntry("index.html");
    expect(prepare("preferred.html")).toEqual(expected("preferred.html", ""));
  });
  it.each(["missing", "directory", "dangling", "non-directory-parent"])(
    "falls back from a %s entry",
    (kind) => {
      writeEntry("index.html");
      let preferred = "preferred.html";
      if (kind === "directory") fs.mkdirSync(join(projectDir, preferred));
      if (kind === "dangling")
        fs.symlinkSync(join(root, "absent"), join(projectDir, preferred), "file");
      if (kind === "non-directory-parent") {
        writeEntry("parent");
        preferred = "parent/file.html";
      }
      expect(prepare(preferred)).toEqual(expected("index.html"));
    },
  );
  it.skipIf(process.platform === "win32")("skips a FIFO without waiting for a writer", () => {
    execFileSync("mkfifo", [join(projectDir, "pipe")]);
    writeEntry("index.html");
    expect(prepare("pipe")).toEqual(expected("index.html"));
  });
  it("keeps project and entry symlinks working", () => {
    const target = join(root, "linked.html");
    fs.writeFileSync(target, "linked");
    fs.symlinkSync(target, join(projectDir, "index.html"), "file");
    const linkedProject = join(root, "linked-project");
    fs.symlinkSync(projectDir, linkedProject, process.platform === "win32" ? "junction" : "dir");
    expect(prepareHyperframeLintBody({ projectDir: linkedProject })).toEqual(
      expected("index.html", "linked"),
    );
  });
  it("rejects a sibling directory sharing the project name prefix", () => {
    const sibling = join(root, "project-other");
    fs.mkdirSync(sibling);
    fs.writeFileSync(join(sibling, "index.html"), "outside");
    expect(prepare("../project-other/index.html")).toEqual({
      error: "Entry file must stay inside project directory: ../project-other/index.html",
    });
  });
  it("preserves absent-project and absent-entry errors", () => {
    expect(prepare()).toEqual({
      error: `No HTML entry file found in project directory: ${join(projectDir, "index.html")}`,
    });
    fs.rmdirSync(projectDir);
    expect(prepare()).toEqual({ error: `Project directory not found: ${projectDir}` });
  });
  it.each(["stat", "read"])("propagates %s failures and closes the descriptor", (failure) => {
    writeEntry("index.html");
    hooks.failStat = failure === "stat";
    hooks.failRead = failure === "read";
    expect(() => prepare()).toThrow(`${failure} failure`);
    expect(hooks.descriptors.size).toBe(0);
  });
  it("keeps inline HTML and files-payload entry selection unchanged", () => {
    expect(prepareHyperframeLintBody({ html: "", entryFile: " custom.html " })).toEqual({
      prepared: { html: "", entryFile: "custom.html", source: "html" },
    });
    expect(
      prepareHyperframeLintBody({ files: { "src/index.html": "source", "index.html": "" } }),
    ).toEqual({ prepared: { html: "source", entryFile: "src/index.html", source: "files" } });
  });
});
