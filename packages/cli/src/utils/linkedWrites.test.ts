// @vitest-environment node
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { writeStackOutputs } from "../commands/lambda/state.js";
import { pullTemplate } from "../commands/templates.js";
import { outDir, writeImage } from "../measure/media.js";
import { writeParakeetTranscript } from "../whisper/parakeet.js";
import { checkSnapshotDirectory } from "./checkSnapshotDirectory.js";
import { writeTurn, type Turn } from "./historyOwner.js";
import { recordReceivedFiles } from "./privateProjectFile.js";
import { recordProjectRegistryItems, seedProjectAuthoringSkill } from "./projectConfig.js";
import { withProjectLock } from "./projectLock.js";
import { projectFolder } from "./projectRecords.js";

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A project folder and, beside it, an outside folder holding a file the project must never change. */
function setup() {
  const root = mkdtempSync(join(tmpdir(), "hf-record-links-"));
  roots.push(root);
  const project = join(root, "project");
  const outside = join(root, "outside");
  mkdirSync(project);
  mkdirSync(outside);
  const victim = join(outside, "victim.txt");
  writeFileSync(victim, "keep me");
  return { project, outside, victim };
}

const records = (project: string) => join(project, ".hyperframes");
const isLink = (path: string) => lstatSync(path).isSymbolicLink();

function linkRecordsFolderOut(project: string, outside: string): void {
  symlinkSync(outside, records(project));
}

describe("history turn markers", () => {
  const turn = (id: string): Turn => ({
    via: "preview",
    id,
    who: { kind: "agent", name: "claude" },
    label: "Retitle",
    startedAt: 1,
    lastWriteAt: Date.now(),
    parts: [],
  });

  it("replace a linked marker instead of writing through it", () => {
    const { project, victim } = setup();
    mkdirSync(records(project));
    const marker = join(records(project), "history-turn.json");
    symlinkSync(victim, marker);

    writeTurn(project, turn("a1b2"));

    expect(readFileSync(victim, "utf8")).toBe("keep me");
    expect(isLink(marker)).toBe(false);
  });

  it("refuse a linked .hyperframes folder", () => {
    const { project, outside } = setup();
    linkRecordsFolderOut(project, outside);
    expect(() => writeTurn(project, turn("a1b2"))).toThrow(/Could not write/);
    expect(readdirSync(outside)).toEqual(["victim.txt"]);
  });
});

describe("hyperframes.json patches", () => {
  it("leave a linked config and its target alone", () => {
    const { project, outside } = setup();
    const shared = join(outside, "shared.json");
    writeFileSync(shared, '{ "registry": "x" }\n');
    const config = join(project, "hyperframes.json");
    symlinkSync(shared, config);

    seedProjectAuthoringSkill(project, "general-video");
    recordProjectRegistryItems(project, [{ name: "a", type: "hyperframes:block", target: "b" }]);

    expect(readFileSync(shared, "utf8")).toBe('{ "registry": "x" }\n');
    expect(isLink(config)).toBe(true);
  });

  it("patch a plain config in place", () => {
    const { project } = setup();
    const config = join(project, "hyperframes.json");
    writeFileSync(config, '{\n    "registry": "x"\n}\n');
    seedProjectAuthoringSkill(project, "general-video");
    expect(readFileSync(config, "utf8")).toBe(
      '{\n    "registry": "x",\n    "authoringSkill": "general-video"\n}\n',
    );
  });
});

describe("fixed-name outputs", () => {
  it("replace a linked transcript.json and lambda stack file instead of writing through them", () => {
    const { project, victim } = setup();
    const transcript = join(project, "transcript.json");
    symlinkSync(victim, transcript);
    writeParakeetTranscript(project, [{ text: "hi", start: 0, end: 1 }]);
    expect(readFileSync(victim, "utf8")).toBe("keep me");
    expect(isLink(transcript)).toBe(false);

    mkdirSync(records(project));
    const state = join(records(project), "lambda-stack-demo.json");
    symlinkSync(victim, state);
    writeStackOutputs({ stackName: "demo", region: "us-east-1" } as never, project);
    expect(readFileSync(victim, "utf8")).toBe("keep me");
    expect(isLink(state)).toBe(false);
  });

  it("refuse a default measure folder reached through a link, but not a chosen --out", () => {
    const { project, outside } = setup();
    vi.spyOn(process, "cwd").mockReturnValue(project);
    expect(outDir(undefined, "measure/events")).toBe(join(records(project), "measure", "events"));

    rmSync(records(project), { recursive: true });
    linkRecordsFolderOut(project, outside);
    expect(() => outDir(undefined, "measure/events")).toThrow(/link or not a folder/);
    expect(readdirSync(outside)).toEqual(["victim.txt"]);

    expect(outDir(join(project, "mine"), "measure/events")).toBe(join(project, "mine"));
  });

  it("replace a link at an ffmpeg output name in a real default folder", () => {
    const { project, victim } = setup();
    mkdirSync(join(records(project), "measure", "events"), { recursive: true });
    const clip = join(records(project), "measure", "events", "clip.png");
    symlinkSync("../../../../outside/victim.txt", clip);
    expect(readFileSync(clip, "utf8")).toBe("keep me");
    vi.spyOn(process, "cwd").mockReturnValue(project);

    writeImage(join(outDir(undefined, "measure/events"), "clip.png"), new Uint8Array(48), 4, 4);

    expect(readFileSync(victim, "utf8")).toBe("keep me");
    expect(isLink(clip)).toBe(false);
    expect(readFileSync(clip).subarray(1, 4).toString()).toBe("PNG");
  });
});

describe("every writer under a linked .hyperframes folder", () => {
  const writers: [string, (project: string) => unknown][] = [
    [
      "the project lock",
      (project) =>
        withProjectLock(project, "test", async () => {}, { projectLock: { waitMs: 50 } }),
    ],
    [
      "the lambda stack file",
      (project) => writeStackOutputs({ stackName: "demo", region: "us-east-1" } as never, project),
    ],
    ["the received-files record", (project) => recordReceivedFiles(project, ["a.png"])],
    ["a check's snapshot folder", (project) => checkSnapshotDirectory(project)],
    [
      "a snapshot --output inside .hyperframes",
      (project) => {
        if (!projectFolder(project, join(records(project), "shots"))) throw new Error("refused");
      },
    ],
    [
      "a template pull's staging folder",
      (project) => {
        vi.stubGlobal("fetch", async () => {
          throw new Error("offline");
        });
        return pullTemplate("finance-explainer", project).finally(() => vi.unstubAllGlobals());
      },
    ],
  ];

  for (const [what, write] of writers) {
    it(`refuses ${what}`, async () => {
      const { project, outside } = setup();
      linkRecordsFolderOut(project, outside);
      await expect(Promise.resolve().then(() => write(project))).rejects.toThrow(
        /link|refused|symlinks/,
      );
      expect(readdirSync(outside)).toEqual(["victim.txt"]);
    });
  }

  it("replaces a linked received-files record instead of overwriting the project file it points at", () => {
    const { project } = setup();
    const data = join(project, "data.json");
    writeFileSync(data, '{"files":[]}');
    mkdirSync(records(project));
    const record = join(records(project), "received-files.json");
    symlinkSync("../data.json", record);

    recordReceivedFiles(project, ["a.png"]);

    expect(readFileSync(data, "utf8")).toBe('{"files":[]}');
    expect(isLink(record)).toBe(false);
  });
});
