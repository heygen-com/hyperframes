import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TRANSACTION_BACKUP, createOwnedRenderDir, createRenderWorkDir } from "./renderDirOwner.js";

const JOB = "0f8c2b1e-5d3a-4c7b-9e21-6a4f0d8b3c19";

describe("createRenderWorkDir", () => {
  let parent: string;
  let self: { pid: number; host: string; boot?: string; pidns?: string };
  let dead: typeof self;
  const plant = (name: string, owner?: object): string => {
    mkdirSync(join(parent, name));
    writeFileSync(join(parent, name, "frame_000001.jpg"), "x");
    if (owner) writeFileSync(join(parent, name, "owner.json"), JSON.stringify(owner));
    return name;
  };

  beforeEach(() => {
    parent = mkdtempSync(join(tmpdir(), "hf-render-dir-owner-"));
    // This process's own stamp, so planted owners differ from it only where a case says so.
    const own = createOwnedRenderDir(join(parent, "self-"));
    self = JSON.parse(readFileSync(join(own, "owner.json"), "utf-8"));
    rmSync(own, { recursive: true });
    dead = { ...self, pid: spawnSync(process.execPath, ["-e", ""]).pid! };
  });
  afterEach(() => rmSync(parent, { recursive: true, force: true }));

  it("reclaims only render temp dirs whose owner on this host has exited", () => {
    plant(`work-${JOB}-aB3dE9`, dead);
    plant(".out.hf-transaction-Zx81Qa", dead);
    plant("hf-render-Qw12Er", dead);
    const kept = [
      basename(createOwnedRenderDir(join(parent, `work-${JOB}-`))),
      plant(`work-${JOB}-Cc0000`, { ...dead, host: `${self.host}-container` }),
      plant(`work-${JOB}-Nn0000`, { ...dead, pidns: "pid:[1]" }),
      plant(`work-${JOB}-Bb0000`, { ...dead, boot: "another-boot-or-machine" }),
      plant(`work-${JOB}-Dd0000`, { ...self, pid: 1 }),
      plant(`work-${JOB}-Ee0000`),
      plant(`work-${JOB}-Ff0000`, { ...dead, pid: String(dead.pid) }),
      plant("work-in-progress", dead),
      plant("keep", dead),
    ];

    const created = basename(createRenderWorkDir(join(parent, `work-${JOB}-`), parent));

    expect(readdirSync(parent).sort()).toEqual([...kept, created].sort());
  });

  it("keeps a dead render's staging dir that still holds the previous output", () => {
    const staging = plant(".out.hf-transaction-Gg0000", dead);
    writeFileSync(join(parent, staging, TRANSACTION_BACKUP), "previous render");

    createRenderWorkDir(join(parent, `work-${JOB}-`), parent);

    expect(readdirSync(parent)).toContain(staging);
  });
});
