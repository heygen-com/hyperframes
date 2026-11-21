import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  RECEIVED_STATE_ENV,
  receivedFiles,
  receivedRecordStatus,
} from "../utils/privateProjectFile.js";
import { receivedFileState } from "./lib/received-env.mjs";

const opens = vi.hoisted(() => ({ path: "", seen: 0, replacing: 0 }));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
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
  return { ...actual, default: { ...actual, openSync }, openSync };
});

const ENV_TEXT = "ELEVENLABS_API_KEY=from-env\n";
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

type Arrange = (root: string, project: string) => void;

const record = (folder: string, files: unknown) => {
  mkdirSync(join(folder, ".hyperframes"), { recursive: true });
  writeFileSync(join(folder, ".hyperframes", "received-files.json"), JSON.stringify({ files }));
};

const hostSays = (root: string, projects: unknown) => {
  const file = join(root, "state.json");
  writeFileSync(file, typeof projects === "string" ? projects : JSON.stringify({ projects }));
  vi.stubEnv(RECEIVED_STATE_ENV, file);
};

const keptFile = (root: string, path: string) =>
  join(root, "received-records", `${sha256(path)}.json`);

const hostKeeps = (root: string, path: string, kept: Record<string, unknown>) => {
  mkdirSync(join(root, "received-records"), { recursive: true });
  writeFileSync(keptFile(root, path), JSON.stringify({ project: path, seenAt: 1, ...kept }));
};

const expectedWithEmptyRecord = (root: string, project: string, extra: object = {}) => {
  record(project, []);
  hostSays(root, [{ path: project, received: "expected", ...extra }]);
};

function movedProject(root: string, project: string, identity: (birth: bigint) => string) {
  const { dev, ino, birthtimeNs } = lstatSync(project, { bigint: true });
  const old = join(root, "old-name");
  record(project, []);
  hostSays(root, [{ path: old, dev: String(dev), ino: String(ino), received: "expected" }]);
  hostKeeps(root, old, {
    files: ["index.html"],
    identity: `${dev}:${ino}:${identity(birthtimeNs)}`,
  });
}

const unreadableRecord = (folder: string) => {
  mkdirSync(join(folder, ".hyperframes"), { recursive: true });
  writeFileSync(join(folder, ".hyperframes", "received-files.json"), "{oops");
};

const FIXTURES: [string, Arrange, "received" | "unchecked" | null][] = [
  ["a folder with no record", () => {}, null],
  ["a record listing the .env", (_root, project) => record(project, [".env"]), "received"],
  ["a record listing other files", (_root, project) => record(project, ["index.html"]), null],
  ["a record above listing the .env", (root) => record(root, ["app/.env"]), "received"],
  [
    "an unreadable record",
    (_root, project) => {
      mkdirSync(join(project, ".hyperframes"));
      writeFileSync(join(project, ".hyperframes", "received-files.json"), "{oops");
    },
    "received",
  ],
  [
    "an unreadable nested record",
    (_root, project) => {
      mkdirSync(join(project, "scenes", ".hyperframes"), { recursive: true });
      writeFileSync(join(project, "scenes", ".hyperframes", "received-files.json"), "{oops");
    },
    "received",
  ],
  [
    "a nested record that lists the .env",
    (_root, project) => record(join(project, "scenes"), ["../.env"]),
    "received",
  ],
  [
    "an unreadable record in a Studio folder whose hidden name looks like an asset, which the walk skips",
    (_root, project) => unreadableRecord(join(project, ".hyperframes", "requests", ".clip.png")),
    null,
  ],
  [
    "a record in a Studio folder whose hidden name looks like an asset, listing the .env, which the walk skips",
    (_root, project) =>
      record(join(project, ".hyperframes", "requests", ".clip.png"), ["../../../.env"]),
    null,
  ],
  [
    "an unreadable record in a Studio folder named like a key file, which the walk skips",
    (_root, project) => unreadableRecord(join(project, ".hyperframes", "requests", "id_rsa")),
    null,
  ],
  [
    "more folders than the scan allows",
    (_root, project) => {
      for (let i = 0; i <= 20_000; i++) mkdirSync(join(project, `d${i}`));
    },
    "unchecked",
  ],
  [
    "a .env with the bytes of received content",
    (_root, project) => {
      record(project, []);
      writeFileSync(
        join(project, ".hyperframes", "received-content.json"),
        JSON.stringify({ hashes: [sha256(ENV_TEXT)] }),
      );
    },
    "received",
  ],
  [
    "received content with other bytes",
    (_root, project) => {
      record(project, []);
      writeFileSync(
        join(project, ".hyperframes", "received-content.json"),
        JSON.stringify({ hashes: [sha256("other")] }),
      );
    },
    null,
  ],
  [
    "an unreadable received-content store",
    (_root, project) => {
      record(project, []);
      writeFileSync(join(project, ".hyperframes", "received-content.json"), "{oops");
    },
    "received",
  ],
  [
    "host state all at the folder",
    (root, project) => hostSays(root, [{ path: project, received: "all" }]),
    "received",
  ],
  [
    "host state all above the folder",
    (root) => hostSays(root, [{ path: root, received: "all" }]),
    "received",
  ],
  [
    "host state all below the folder",
    (root, project) => {
      mkdirSync(join(project, "refs"));
      hostSays(root, [{ path: join(project, "refs"), received: "all" }]);
    },
    "received",
  ],
  [
    "host state expected with its record missing",
    (root, project) => hostSays(root, [{ path: project, received: "expected" }]),
    "received",
  ],
  [
    "host state expected with a record that leaves the .env out",
    (root, project) => {
      record(project, ["index.html"]);
      hostSays(root, [{ path: project, received: "expected" }]);
    },
    null,
  ],
  [
    "host state expected for the folder by its identity",
    (root, project) => {
      const { dev, ino } = lstatSync(project, { bigint: true });
      const elsewhere = join(root, "renamed-away");
      hostSays(root, [
        { path: elsewhere, dev: String(dev), ino: String(ino), received: "expected" },
      ]);
    },
    "received",
  ],
  [
    "an emptied record whose kept copy lists the .env",
    (root, project) => {
      expectedWithEmptyRecord(root, project);
      hostKeeps(root, project, { files: [".env", "index.html"] });
    },
    "received",
  ],
  [
    "an emptied record whose kept copy lists the .env, which is gone",
    (root, project) => {
      expectedWithEmptyRecord(root, project);
      hostKeeps(root, project, { files: [".env"] });
      rmSync(join(project, ".env"));
    },
    null,
  ],
  [
    "a kept copy with no list",
    (root, project) => {
      expectedWithEmptyRecord(root, project);
      hostKeeps(root, project, { files: null });
    },
    "received",
  ],
  [
    "a doubted kept copy",
    (root, project) => {
      expectedWithEmptyRecord(root, project);
      hostKeeps(root, project, { files: ["index.html"], doubted: true });
    },
    "received",
  ],
  [
    "a kept copy for another project",
    (root, project) => {
      expectedWithEmptyRecord(root, project);
      hostKeeps(root, project, { project: join(root, "other"), files: [] });
    },
    "received",
  ],
  [
    "an unparsable kept copy",
    (root, project) => {
      expectedWithEmptyRecord(root, project);
      hostKeeps(root, project, {});
      writeFileSync(keptFile(root, project), "{not json");
    },
    "received",
  ],
  [
    "no kept copy",
    (root, project) => {
      expectedWithEmptyRecord(root, project);
      hostKeeps(root, join(root, "other"), { files: [".env"] });
    },
    null,
  ],
  [
    "a moved project's kept copy with its folder's identity",
    (root, project) => movedProject(root, project, (birth) => String(birth)),
    null,
  ],
  [
    "a moved project's kept copy with another folder's identity",
    (root, project) => movedProject(root, project, () => "1"),
    "received",
  ],
  [
    "a nested project's kept copy with no list",
    (root, project) => {
      record(project, []);
      expectedWithEmptyRecord(root, join(project, "scenes"));
      hostKeeps(root, join(project, "scenes"), { files: null });
    },
    "received",
  ],
  ["an unreadable host state file", (root) => hostSays(root, "{not json"), "received"],
  [
    "a host state file that is missing",
    (root) => vi.stubEnv(RECEIVED_STATE_ENV, join(root, "missing.json")),
    "received",
  ],
  [
    "an unknown host state",
    (root, project) => hostSays(root, [{ path: project, received: "maybe" }]),
    "received",
  ],
  [
    "host state naming another folder",
    (root) => hostSays(root, [{ path: join(root, "other"), received: "all" }]),
    null,
  ],
];

const dirs: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  Object.assign(opens, { path: "", seen: 0, replacing: 0 });
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function cliState(project: string): "received" | "unchecked" | null {
  if (receivedRecordStatus(project) === "unchecked") return "unchecked";
  return receivedFiles(project)(".env") ? "received" : null;
}

it.each(FIXTURES)(
  "the media-use copy of the received rule reads %s as the CLI does",
  (_, arrange, expected) => {
    vi.stubEnv(RECEIVED_STATE_ENV, undefined);
    const root = mkdtempSync(join(tmpdir(), "hf-received-env-"));
    dirs.push(root);
    const project = join(root, "app");
    mkdirSync(project);
    writeFileSync(join(project, ".env"), ENV_TEXT);
    arrange(root, project);
    expect(cliState(project)).toBe(expected);
    expect(receivedFileState(project, ".env")).toBe(expected);
  },
  30_000,
);

it.skipIf(process.platform === "win32")(
  "the media-use copy reads a .env linked outside the project as the CLI does once a listed file is gone",
  () => {
    const root = mkdtempSync(join(tmpdir(), "hf-received-env-"));
    dirs.push(root);
    const project = join(root, "app");
    mkdirSync(project);
    writeFileSync(join(root, "outside.env"), ENV_TEXT);
    symlinkSync(join(root, "outside.env"), join(project, ".env"));
    record(project, ["gone.html"]);
    expect(cliState(project)).toBe("received");
    expect(receivedFileState(project, ".env")).toBe("received");
  },
);

function projectWithEmptyRecord(): { root: string; project: string } {
  const root = mkdtempSync(join(tmpdir(), "hf-received-env-"));
  dirs.push(root);
  const project = join(root, "app");
  mkdirSync(project);
  writeFileSync(join(project, ".env"), ENV_TEXT);
  return { root, project };
}

it.skipIf(process.platform === "win32")(
  "the media-use copy reads a link in place of the kept copy as the CLI does",
  () => {
    const { root, project } = projectWithEmptyRecord();
    expectedWithEmptyRecord(root, project);
    hostKeeps(root, join(root, "elsewhere"), { project, files: ["index.html"] });
    symlinkSync(keptFile(root, join(root, "elsewhere")), keptFile(root, project));
    expect(cliState(project)).toBe("received");
    expect(receivedFileState(project, ".env")).toBe("received");
  },
);

it.skipIf(process.platform === "win32")(
  "the media-use copy leaves off a gone kept entry as the CLI does",
  () => {
    const { root, project } = projectWithEmptyRecord();
    rmSync(join(project, ".env"));
    writeFileSync(join(root, "outside.env"), ENV_TEXT);
    symlinkSync(join(root, "outside.env"), join(project, ".env"));
    expectedWithEmptyRecord(root, project);
    hostKeeps(root, project, { files: ["gone.html"] });
    expect(cliState(project)).toBe(null);
    expect(receivedFileState(project, ".env")).toBe(null);
  },
);

it("the media-use copy reads the kept copy once more when the host replaces it, as the CLI does", () => {
  const { root, project } = projectWithEmptyRecord();
  expectedWithEmptyRecord(root, project);
  hostKeeps(root, project, { files: ["index.html"] });
  for (const state of [
    (dir: string) => receivedFiles(dir)(".env"),
    (dir: string) => receivedFileState(dir, ".env"),
  ]) {
    Object.assign(opens, { path: keptFile(root, project), seen: 0, replacing: 1 });
    expect(state(project)).toBeFalsy();
    expect(opens.seen).toBe(2);
  }
});

it("the media-use copy reads a kept copy named by path and identity once, as the CLI does", () => {
  const { root, project } = projectWithEmptyRecord();
  const { dev, ino } = lstatSync(project, { bigint: true });
  expectedWithEmptyRecord(root, project, { dev: String(dev), ino: String(ino) });
  hostKeeps(root, project, { files: ["index.html"], identity: null });
  for (const state of [
    (dir: string) => receivedFiles(dir)(".env"),
    (dir: string) => receivedFileState(dir, ".env"),
  ]) {
    Object.assign(opens, { path: keptFile(root, project), seen: 0, replacing: 0 });
    expect(state(project)).toBeFalsy();
    expect(opens.seen).toBe(1);
  }
});

it.each([
  [[".env"], "received"],
  [null, "received"],
  [["index.html"], null],
])(
  "the media-use copy reads a kept copy listing %j when it looks only at and above the folder",
  (files, expected) => {
    const { root, project } = projectWithEmptyRecord();
    expectedWithEmptyRecord(root, project);
    hostKeeps(root, project, { files });
    expect(receivedFileState(project, ".env", { atOrAboveOnly: true })).toBe(expected);
  },
);
