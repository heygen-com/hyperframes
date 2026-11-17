import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const dockerRuns = vi.hoisted(() => [] as string[][]);

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execFileSync: vi.fn(() => Buffer.from("")),
    spawn: vi.fn((command: string, args: string[]) => {
      if (command === "docker") dockerRuns.push(args);
      const child = Object.assign(new EventEmitter(), { stderr: new EventEmitter() });
      queueMicrotask(() => child.emit("close", 0));
      return child;
    }),
  };
});

const { renderDocker } = await import("./render.js");

describe("renderDocker", () => {
  const roots: string[] = [];
  afterEach(() => {
    vi.restoreAllMocks();
    dockerRuns.length = 0;
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  async function dockerRunFor(receivedFiles: string[] | undefined): Promise<string[]> {
    const root = mkdtempSync(join(tmpdir(), "hf-render-docker-"));
    roots.push(root);
    const projectDir = join(root, "scene");
    mkdirSync(projectDir);
    mkdirSync(join(root, "output"));
    writeFileSync(join(root, "output", "photo.png"), "secret");
    writeFileSync(join(projectDir, "index.html"), '<img src="../output/photo.png">');
    if (receivedFiles) {
      mkdirSync(join(root, ".hyperframes"));
      writeFileSync(
        join(root, ".hyperframes", "received-files.json"),
        JSON.stringify({ files: receivedFiles }),
      );
    }
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await renderDocker(projectDir, join(root, "output", "film.mp4"), {
      fps: { num: 30, den: 1 },
      quality: "standard",
      format: "mp4",
      gpu: false,
      hdrMode: "auto",
      quiet: true,
      embedded: true,
    });
    const run = dockerRuns.find((args) => args[0] === "run");
    if (!run) throw new Error("renderDocker started no docker run");
    return run;
  }

  it("passes the refusal into the container for a project under a record listing received code", async () => {
    expect(await dockerRunFor(["scene/index.html"])).toContain("--refuse-outside-files");
  });

  it("starts the container without the refusal for a project with no record", async () => {
    expect(await dockerRunFor(undefined)).not.toContain("--refuse-outside-files");
  });
});
