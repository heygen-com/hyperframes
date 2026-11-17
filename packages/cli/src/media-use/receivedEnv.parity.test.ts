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
    "an unreadable record in a Studio folder whose hidden name looks like an asset",
    (_root, project) => unreadableRecord(join(project, ".hyperframes", "requests", ".clip.png")),
    "received",
  ],
  [
    "a record in a Studio folder whose hidden name looks like an asset, listing the .env",
    (_root, project) =>
      record(join(project, ".hyperframes", "requests", ".clip.png"), ["../../../.env"]),
    "received",
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
