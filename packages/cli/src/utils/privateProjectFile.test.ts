import { afterEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  renameSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { isCredentialOrToolStatePath } from "@hyperframes/core/safe-path";
import {
  RECEIVED_STATE_ENV,
  isEnvOrGitPath,
  isPrivateCompositionFile,
  receivedFiles,
  receivedLinesAtOrAbove,
  receivedRecordStatus,
  recordReceivedFiles,
} from "./privateProjectFile.js";

const zeroFileIds = vi.hoisted(() => ({ on: false }));
const opens = vi.hoisted(() => ({ path: "", seen: 0, replacing: 0 }));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const lstatSync = ((path: string, options?: { bigint?: boolean }) => {
    const stat = actual.lstatSync(path, options as never);
    return zeroFileIds.on && stat ? Object.assign(stat, { dev: 0n, ino: 0n }) : stat;
  }) as typeof actual.lstatSync;
  const openSync = ((...args: Parameters<typeof actual.openSync>) => {
    const fd = actual.openSync(...args);
    if (args[0] !== opens.path) return fd;
    opens.seen += 1;
    if (opens.replacing > 0) {
      opens.replacing -= 1;
      actual.copyFileSync(opens.path, `${opens.path}.new`);
      actual.renameSync(`${opens.path}.new`, opens.path);
    }
    return fd;
  }) as typeof actual.openSync;
  return { ...actual, default: { ...actual, lstatSync, openSync }, lstatSync, openSync };
});

let dir: string | undefined;

afterEach(() => {
  zeroFileIds.on = false;
  Object.assign(opens, { path: "", seen: 0, replacing: 0 });
  vi.unstubAllEnvs();
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("isEnvOrGitPath", () => {
  it("names env files and Git folders, whatever the letter case", () => {
    expect(isEnvOrGitPath("/home/me/.env")).toBe(true);
    expect(isEnvOrGitPath("a\\.Env.Local")).toBe(true);
    expect(isEnvOrGitPath("repo/.git/config")).toBe(true);
    expect(isEnvOrGitPath(".envrc")).toBe(true);
    expect(isEnvOrGitPath("sub/.env-local")).toBe(true);
    expect(isEnvOrGitPath(".env_prod")).toBe(true);
    expect(isEnvOrGitPath(".environment.json")).toBe(false);
    expect(isEnvOrGitPath("assets/environment.png")).toBe(false);
    expect(isEnvOrGitPath("dotfiles.git/logo.png")).toBe(false);
  });
});

describe("isCredentialOrToolStatePath", () => {
  it("names logins, keys and agent or editor state at any depth and in any case", () => {
    for (const path of [
      ".npmrc",
      "a/b/.YARNRC.yml",
      "_netrc",
      "pip.ini",
      ".git-credentials",
      ".ssh/config",
      "x\\.AWS\\credentials",
      ".config/gcloud/application_default_credentials.json",
      ".config/gh/hosts.yml",
      "keys/id_ecdsa.pub",
      "certs/site.PEM",
      ".claude/settings.json",
      ".idea/workspace.xml",
      "sub/.mcp.json",
    ]) {
      expect(isCredentialOrToolStatePath(path), path).toBe(true);
    }
  });

  it("leaves ordinary composition files alone", () => {
    for (const path of [
      "assets/keyframes.json",
      "monkey.png",
      "id.png",
      "fonts/key.woff2",
      ".config/theme.json",
      "claude/logo.svg",
      "scenes/mcp.json",
      ".media/clip.mp4",
    ]) {
      expect(isCredentialOrToolStatePath(path), path).toBe(false);
    }
  });
});

describe("isPrivateCompositionFile", () => {
  it("covers env files, Git data and tool records, not composition assets", () => {
    dir = mkdtempSync(join(tmpdir(), "hf-private-file-"));
    const at = (path: string) => isPrivateCompositionFile(dir!, join(dir!, path));

    expect(at(".env")).toBe(true);
    expect(at(".env.production")).toBe(true);
    expect(at("sub/.env")).toBe(true);
    expect(at(".git/HEAD")).toBe(true);
    expect(at(".hyperframes/history-turn.json")).toBe(true);
    expect(at(".hyperframes/prepared-assets/gif/a.webm")).toBe(false);
    expect(at(".media/clip.mp4")).toBe(false);
    expect(at("environment.png")).toBe(false);
    expect(at("index.html")).toBe(false);
  });

  it.skipIf(process.platform === "win32")(
    "follows a link inside the project to an env file",
    () => {
      dir = mkdtempSync(join(tmpdir(), "hf-private-file-"));
      writeFileSync(join(dir, ".env"), "KEY=secret");
      mkdirSync(join(dir, "assets"));
      symlinkSync(join(dir, ".env"), join(dir, "assets", "logo.png"));

      expect(isPrivateCompositionFile(dir, join(dir, "assets", "logo.png"))).toBe(true);
    },
  );
});

describe("receivedFiles", () => {
  it("matches no file by identity on a drive that reports no file ids", () => {
    dir = mkdtempSync(join(tmpdir(), "hf-received-"));
    mkdirSync(join(dir, ".hyperframes"));
    writeFileSync(join(dir, "theirs.html"), "");
    writeFileSync(join(dir, "mine.html"), "");
    writeFileSync(
      join(dir, ".hyperframes", "received-files.json"),
      JSON.stringify({ files: ["theirs.html"] }),
    );
    zeroFileIds.on = true;
    const received = receivedFiles(dir);
    expect(received("theirs.html")).toBe(true);
    expect(received("mine.html")).toBe(false);
  });
});

describe("receivedFiles when a listed file is gone", () => {
  function project(listed: string[]): string {
    dir = mkdtempSync(join(tmpdir(), "hf-received-gone-"));
    mkdirSync(join(dir, ".hyperframes"));
    writeFileSync(join(dir, "mine.html"), "");
    writeFileSync(
      join(dir, ".hyperframes", "received-files.json"),
      JSON.stringify({ files: listed }),
    );
    return dir;
  }

  it("counts every page, stylesheet, script and SVG as received, and names the gone file", () => {
    const root = project(["theirs.html"]);
    writeFileSync(join(root, "logo.png"), "png");
    const received = receivedFiles(root);
    for (const code of ["mine.html", "renamed.html", "a.css", "b.js", "c.mjs", "d.svg"])
      expect(received(code)).toBe(true);
    expect(received("logo.png")).toBe(false);
    expect(received.gone).toBe("theirs.html");
  });

  it("counts a file with the content of a received file that left the record as received", () => {
    const root = project([]);
    writeFileSync(join(root, "logo.png"), "theirs");
    writeFileSync(
      join(root, ".hyperframes", "received-content.json"),
      JSON.stringify({ hashes: [createHash("sha256").update("theirs").digest("hex")] }),
    );
    const received = receivedFiles(root);
    expect(received("logo.png")).toBe(true);
    expect(received("mine.html")).toBe(false);
    expect(received.gone).toBeUndefined();
  });

  it("counts every file as received when the received content cannot be read", () => {
    const root = project([]);
    writeFileSync(join(root, ".hyperframes", "received-content.json"), "{not json");
    expect(receivedFiles(root)("mine.html")).toBe(true);
  });

  it("ignores a gone file a record lists outside the project", () => {
    const root = project([]);
    mkdirSync(join(root, "sub", ".hyperframes"), { recursive: true });
    writeFileSync(
      join(root, "sub", ".hyperframes", "received-files.json"),
      JSON.stringify({ files: ["../../not-in-project/gone.html"] }),
    );
    const received = receivedFiles(root);
    expect(received.gone).toBeUndefined();
    expect(received("mine.html")).toBe(false);
  });

  it("counts every page as received for a gone file listed by a received folder's own record", () => {
    const root = project([]);
    mkdirSync(join(root, "sub", ".hyperframes"), { recursive: true });
    writeFileSync(
      join(root, "sub", ".hyperframes", "received-files.json"),
      JSON.stringify({ files: ["gone.html"] }),
    );
    expect(receivedFiles(root)("mine.html")).toBe(true);
  });

  it("still tells the person's own files apart when every listed file is there", () => {
    const root = project(["theirs.html"]);
    writeFileSync(join(root, "theirs.html"), "");
    expect(receivedFiles(root)("theirs.html")).toBe(true);
    expect(receivedFiles(root)("mine.html")).toBe(false);
  });
});

describe("receivedFiles for a received project copied into a folder", () => {
  function withNested(record?: string): string {
    dir = mkdtempSync(join(tmpdir(), "hf-received-nested-"));
    mkdirSync(join(dir, "compositions", "x"), { recursive: true });
    writeFileSync(join(dir, "index.html"), "");
    writeFileSync(join(dir, "compositions", "x", "index.html"), "");
    if (record !== undefined) {
      mkdirSync(join(dir, "compositions", "x", ".hyperframes"));
      writeFileSync(join(dir, "compositions", "x", ".hyperframes", "received-files.json"), record);
    }
    return dir;
  }

  it("names the copy's files from the project folder", () => {
    const received = receivedFiles(withNested(JSON.stringify({ files: ["index.html"] })));
    expect(received("compositions/x/index.html")).toBe(true);
    expect(received("index.html")).toBe(false);
  });

  it("counts every file as received when the copy's record cannot be read", () => {
    expect(receivedFiles(withNested("{not json"))("index.html")).toBe(true);
  });

  it("counts no file as received when the folder has no record", () => {
    const received = receivedFiles(withNested());
    expect(received("compositions/x/index.html")).toBe(false);
    expect(received("index.html")).toBe(false);
  });

  it.each([
    "renders",
    "dist",
    ".next",
    "coverage",
    "renders/x",
    ".hyperframes/requests/x",
    ".hyperframes/prepared-assets/x",
  ])("names the copy's files when it sits in %s", (folder) => {
    dir = mkdtempSync(join(tmpdir(), "hf-received-nested-"));
    mkdirSync(join(dir, folder, ".hyperframes"), { recursive: true });
    writeFileSync(join(dir, folder, "index.html"), "");
    writeFileSync(
      join(dir, folder, ".hyperframes", "received-files.json"),
      JSON.stringify({ files: ["index.html"] }),
    );
    expect(receivedFiles(dir)(`${folder}/index.html`)).toBe(true);
  });
});

describe("a host's received state file", () => {
  function project(record?: string): string {
    const root = mkdtempSync(join(tmpdir(), "hf-received-state-"));
    mkdirSync(join(root, "app", "compositions"), { recursive: true });
    writeFileSync(join(root, "app", "index.html"), "");
    writeFileSync(join(root, "app", "compositions", "intro.html"), "");
    if (record !== undefined) {
      mkdirSync(join(root, "app", ".hyperframes"));
      writeFileSync(join(root, "app", ".hyperframes", "received-files.json"), record);
    }
    dir = root;
    return join(root, "app");
  }

  function hostSays(projects: Record<string, unknown>[] | string): void {
    const file = join(dir as string, "state.json");
    writeFileSync(file, typeof projects === "string" ? projects : JSON.stringify({ projects }));
    vi.stubEnv(RECEIVED_STATE_ENV, file);
  }

  it("counts every file as received when an expected record is missing", () => {
    const app = project();
    hostSays([{ path: app, received: "expected" }]);
    expect(receivedFiles(app)("index.html")).toBe(true);
    expect(receivedFiles(join(app, "compositions"))("intro.html")).toBe(true);
    expect(receivedFiles(dirname(app))("other.html")).toBe(true);
    expect(receivedRecordStatus(app)).toMatchObject({ listed: null });
  });

  it("reads an expected record that is there as written", () => {
    const app = project(JSON.stringify({ files: ["compositions/intro.html"] }));
    hostSays([{ path: app, received: "expected" }]);
    const received = receivedFiles(app);
    expect(received("compositions/intro.html")).toBe(true);
    expect(received("index.html")).toBe(false);
  });

  it("counts every file as received in a project named all, whatever its record lists", () => {
    const app = project(JSON.stringify({ files: [] }));
    hostSays([{ path: app, received: "all" }]);
    expect(receivedFiles(app)("index.html")).toBe(true);
    expect(receivedFiles(join(app, "compositions"))("intro.html")).toBe(true);
    expect(receivedFiles(dirname(app))("other.html")).toBe(true);
  });

  it("finds a named project under a new name by its folder's identity", () => {
    const app = project();
    const { dev, ino } = lstatSync(app, { bigint: true });
    hostSays([{ path: app, dev: String(dev), ino: String(ino), received: "expected" }]);
    const renamed = `${app}-renamed`;
    renameSync(app, renamed);
    expect(receivedFiles(renamed)("index.html")).toBe(true);
  });

  it("counts every file as received when the state file cannot be read", () => {
    const app = project(JSON.stringify({ files: [] }));
    hostSays("{not json");
    expect(receivedFiles(app)("index.html")).toBe(true);
    vi.stubEnv(RECEIVED_STATE_ENV, join(dir as string, "missing.json"));
    expect(receivedFiles(app)("index.html")).toBe(true);
  });

  it("does not start a fresh record in place of an expected one", () => {
    const app = project();
    hostSays([{ path: app, received: "expected" }]);
    expect(recordReceivedFiles(app, ["index.html"])).toEqual([]);
    expect(existsSync(join(app, ".hyperframes", "received-files.json"))).toBe(false);
  });

  it("leaves a project it does not name as having received nothing", () => {
    const app = project();
    hostSays([{ path: join(tmpdir(), "hf-some-other-project"), received: "all" }]);
    expect(receivedFiles(app)("index.html")).toBe(false);
  });

  describe("and the host's kept copy of a record", () => {
    const keptFile = (path: string) =>
      join(
        dir as string,
        "received-records",
        `${createHash("sha256").update(path).digest("hex")}.json`,
      );

    function hostKeeps(path: string, kept: unknown): void {
      mkdirSync(join(dir as string, "received-records"), { recursive: true });
      writeFileSync(keptFile(path), typeof kept === "string" ? kept : JSON.stringify(kept));
    }

    const keeps = (path: string, files: string[] | null) =>
      hostKeeps(path, { project: path, identity: null, files, seenAt: 1 });

    function emptiedProject(): string {
      const app = project(JSON.stringify({ files: [] }));
      mkdirSync(join(app, "assets"));
      writeFileSync(join(app, "assets", "x.js"), "");
      return app;
    }

    it("counts entries an emptied record lost as received while their files are there", () => {
      const app = emptiedProject();
      const named = realpathSync(app);
      hostSays([{ path: named, received: "expected" }]);
      keeps(named, ["index.html", "assets/x.js"]);
      const received = receivedFiles(app);
      expect(received("index.html")).toBe(true);
      expect(received("assets/x.js")).toBe(true);
      expect(received("compositions/intro.html")).toBe(false);
      const status = receivedRecordStatus(app);
      expect(status !== "unchecked" && status?.listed?.map((path) => basename(path))).toEqual([
        "index.html",
        "x.js",
      ]);
    });

    it("leaves off a lost entry whose file is gone", () => {
      const app = emptiedProject();
      hostSays([{ path: app, received: "expected" }]);
      keeps(app, ["index.html", "assets/x.js"]);
      rmSync(join(app, "assets", "x.js"));
      const received = receivedFiles(app);
      expect(received("index.html")).toBe(true);
      expect(received("assets/x.js")).toBe(false);
      expect(received.gone).toBeUndefined();
    });

    it("finds the kept copy of a project named under its old path by its folder's identity", () => {
      const app = emptiedProject();
      const { dev, ino, birthtimeNs } = lstatSync(app, { bigint: true });
      hostSays([{ path: app, dev: String(dev), ino: String(ino), received: "expected" }]);
      const kept = { project: app, files: ["index.html"], seenAt: 1 };
      hostKeeps(app, { ...kept, identity: `${dev}:${ino}:${birthtimeNs}` });
      const renamed = `${app}-renamed`;
      renameSync(app, renamed);
      expect(receivedFiles(renamed)("index.html")).toBe(true);
      expect(receivedFiles(renamed)("assets/x.js")).toBe(false);
    });

    it("counts every file as received when a moved project's kept copy names another folder", () => {
      const app = emptiedProject();
      const { dev, ino } = lstatSync(app, { bigint: true });
      hostSays([{ path: app, dev: String(dev), ino: String(ino), received: "expected" }]);
      hostKeeps(app, {
        project: app,
        files: ["index.html"],
        seenAt: 1,
        identity: `${dev}:${ino}:1`,
      });
      const renamed = `${app}-renamed`;
      renameSync(app, renamed);
      expect(receivedFiles(renamed)("compositions/intro.html")).toBe(true);
      expect(receivedRecordStatus(renamed)).toMatchObject({ path: keptFile(app), listed: null });
    });

    it("reads the kept copy once more when the host replaces it during the first read", () => {
      const app = emptiedProject();
      hostSays([{ path: app, received: "expected" }]);
      keeps(app, ["index.html"]);
      Object.assign(opens, { path: keptFile(app), seen: 0, replacing: 1 });
      const received = receivedFiles(app);
      expect(opens.seen).toBe(2);
      expect(received("index.html")).toBe(true);
      expect(received("compositions/intro.html")).toBe(false);
    });

    it("reads the kept copy once when the state file names the project by path and identity", () => {
      const app = emptiedProject();
      const { dev, ino } = lstatSync(app, { bigint: true });
      hostSays([{ path: app, dev: String(dev), ino: String(ino), received: "expected" }]);
      keeps(app, ["index.html"]);
      Object.assign(opens, { path: keptFile(app), seen: 0, replacing: 0 });
      const received = receivedFiles(app);
      expect(opens.seen).toBe(1);
      expect(received("index.html")).toBe(true);
      expect(received("compositions/intro.html")).toBe(false);
    });

    it("counts every file as received when the kept copy holds no list, and keeps the record's lines", () => {
      const app = emptiedProject();
      writeFileSync(
        join(app, ".hyperframes", "received-files.json"),
        JSON.stringify({ files: ["index.html"] }),
      );
      hostSays([{ path: app, received: "expected" }]);
      keeps(app, null);
      expect(receivedFiles(app)("compositions/intro.html")).toBe(true);
      expect(receivedRecordStatus(app)).toMatchObject({ path: keptFile(app), listed: null });
      expect(receivedLinesAtOrAbove(app).map(({ lines }) => lines)).toEqual([["index.html"]]);
    });

    it("counts every file as received when the kept copy is doubted, unreadable or for another project", () => {
      const app = emptiedProject();
      hostSays([{ path: app, received: "expected" }]);
      for (const kept of [
        { project: app, identity: null, files: [], seenAt: 1, doubted: true },
        { project: `${app}-other`, identity: null, files: [], seenAt: 1 },
        { project: app, identity: null, files: [1], seenAt: 1 },
        "{not json",
      ]) {
        hostKeeps(app, kept);
        expect(receivedFiles(app)("compositions/intro.html")).toBe(true);
      }
    });

    it("trusts the record when no state file is set or the state file does not name the project", () => {
      const app = emptiedProject();
      hostSays([{ path: join(tmpdir(), "hf-some-other-project"), received: "expected" }]);
      keeps(app, ["index.html", "assets/x.js"]);
      expect(receivedFiles(app)("index.html")).toBe(false);
      vi.stubEnv(RECEIVED_STATE_ENV, "");
      expect(receivedFiles(app)("index.html")).toBe(false);
    });

    it.skipIf(process.platform === "win32")(
      "does not follow a link in place of the kept copy",
      () => {
        const app = emptiedProject();
        hostSays([{ path: app, received: "expected" }]);
        const elsewhere = join(dir as string, "elsewhere.json");
        writeFileSync(
          elsewhere,
          JSON.stringify({ project: app, identity: null, files: ["index.html"], seenAt: 1 }),
        );
        mkdirSync(join(dir as string, "received-records"));
        symlinkSync(elsewhere, keptFile(app));
        expect(receivedFiles(app)("compositions/intro.html")).toBe(true);
      },
    );

    it("reads the person's own project as before when the host keeps no copy of its record", () => {
      const app = emptiedProject();
      hostSays([{ path: app, received: "expected" }]);
      keeps(join(tmpdir(), "hf-some-other-project"), ["index.html"]);
      const received = receivedFiles(app);
      expect(received("index.html")).toBe(false);
      expect(received("assets/x.js")).toBe(false);
      expect(receivedRecordStatus(app)).toMatchObject({ listed: [] });
    });
  });
});

describe("recordReceivedFiles", () => {
  const record = (root: string) => join(root, ".hyperframes", "received-files.json");
  const lock = (root: string) => `${record(root)}.lock`;
  const listed = (root: string) => JSON.parse(readFileSync(record(root), "utf-8")).files;
  function project(): string {
    dir = mkdtempSync(join(tmpdir(), "hf-received-lock-"));
    mkdirSync(join(dir, ".hyperframes"));
    writeFileSync(record(dir), JSON.stringify({ files: ["hyperframes.json"] }));
    return dir;
  }

  it("waits for another writer's lock, so both writers keep their entries", async () => {
    const root = project();
    writeFileSync(lock(root), "");
    // Another writer: it read the record, holds the lock, writes its entry, then lets go.
    const other = spawn(process.execPath, [
      "-e",
      `const fs = require("node:fs");
       const files = JSON.parse(fs.readFileSync(process.argv[1], "utf8")).files;
       process.stdout.write("read");
       setTimeout(() => {
         fs.writeFileSync(process.argv[1], JSON.stringify({ files: [...files, "theirs.html"] }));
         fs.rmSync(process.argv[2]);
       }, 300);`,
      record(root),
      lock(root),
    ]);
    await new Promise((resolve) => other.stdout.once("data", resolve));
    recordReceivedFiles(root, ["mine.html"]);
    await new Promise((resolve) => other.once("exit", resolve));
    expect(listed(root)).toEqual(["hyperframes.json", "mine.html", "theirs.html"]);
  });

  it("takes a project folder however its path is spelled", () => {
    const root = join(project(), "Project");
    mkdirSync(root);
    const respelled = join(dirname(root), "project");
    const spelled = existsSync(respelled) ? respelled : root;
    expect(recordReceivedFiles(spelled, ["mine.html"])).toEqual(["mine.html"]);
    expect(listed(root)).toEqual(["mine.html"]);
  });

  it("takes over a lock left behind for more than ten seconds", () => {
    const root = project();
    writeFileSync(lock(root), "");
    const old = new Date(Date.now() - 60_000);
    utimesSync(lock(root), old, old);
    expect(recordReceivedFiles(root, ["mine.html"])).toEqual(["mine.html"]);
    expect(listed(root)).toEqual(["hyperframes.json", "mine.html"]);
  });

  it("takes over a lock dated in the future", () => {
    const root = project();
    writeFileSync(lock(root), "");
    const later = new Date(Date.now() + 60 * 60_000);
    utimesSync(lock(root), later, later);
    expect(recordReceivedFiles(root, ["mine.html"])).toEqual(["mine.html"]);
  });

  it("fails rather than write past a lock that stays held", () => {
    const root = project();
    writeFileSync(lock(root), "");
    expect(() => recordReceivedFiles(root, ["mine.html"])).toThrow(/Another program is changing/);
    expect(listed(root)).toEqual(["hyperframes.json"]);
  });
});
