import { describe, expect, it } from "vitest";
import { getAudioFxDef } from "./audioFx.js";
import { HF_AUDIO_FX_PRESETS } from "./audioFxPresets.js";
import { audioFxJobNode, getAudioFxJob, HF_AUDIO_FX_JOBS } from "./audioFxJobs.js";

const EMPTY = { version: 1 as const, nodes: [] };

describe("named jobs", () => {
  it("makes an ordinary effect node, named for the work", () => {
    const job = getAudioFxJob("reduce-mud");
    if (!job) throw new Error("no such job");
    const node = audioFxJobNode(job, EMPTY);
    // Ordinary underneath: the author can open it and find the filter they could
    // have added by hand, at the frequency the job picked for them.
    expect(node.type).toBe("peaking");
    expect(node.params?.frequency).toBe(250);
    expect(node.label).toBe("Reduce Mud");
    expect(node.enabled).toBe(true);
    expect(node.id).toBeTruthy();
  });

  it("gives every job a value for every parameter its effect declares", () => {
    // A job names a range and leaves the rest alone, so the omitted parameters
    // have to come from the registry — a node missing `q` renders at whatever
    // the graph builder falls back to rather than what the panel shows.
    for (const job of HF_AUDIO_FX_JOBS) {
      const def = getAudioFxDef(job.type);
      expect(def, `${job.id} names an effect that does not exist`).toBeDefined();
      const node = audioFxJobNode(job, EMPTY);
      for (const param of def?.params ?? []) {
        expect(node.params?.[param.key], `${job.id} has no ${param.key}`).toBeDefined();
      }
    }
  });

  it("mints an id that does not collide with what is already there", () => {
    const job = getAudioFxJob("add-clarity");
    if (!job) throw new Error("no such job");
    const first = audioFxJobNode(job, EMPTY);
    const second = audioFxJobNode(job, { version: 1, nodes: [first] });
    // Two of the same job is a real thing to want, and a shared id would give
    // them each other's automation lanes.
    expect(second.id).not.toBe(first.id);
  });

  it("names jobs the preset catalogue already ships", () => {
    // The point of the list is to name the vocabulary the presets were written
    // in, not to invent a second one beside it. A job nobody's preset uses is a
    // guess about what authors want; one a preset uses has already been chosen.
    const shipped = new Set(
      HF_AUDIO_FX_PRESETS.flatMap((preset) => preset.nodes.map((node) => node.label)),
    );
    for (const job of HF_AUDIO_FX_JOBS) {
      expect(shipped, `${job.label} is not a job any preset does`).toContain(job.label);
    }
  });

  it("has an id for every job and no duplicates", () => {
    const ids = HF_AUDIO_FX_JOBS.map((job) => job.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(getAudioFxJob(id)?.id).toBe(id);
  });
});
