import { describe, expect, it } from "vitest";
import { findEffects } from "./effects.js";
import { READ_RATE } from "./signal.js";

let seed = 11;
const noise = () =>
  ((seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648) / 2_147_483_648) * 2 - 1;

function track(seconds: number, ...sounds: ((t: number) => number)[]): Float32Array {
  seed = 11;
  const out = new Float32Array(Math.round(seconds * READ_RATE));
  for (let i = 0; i < out.length; i++) {
    const t = i / READ_RATE;
    out[i] = 0.0005 * noise() + sounds.reduce((sum, sound) => sum + sound(t), 0);
  }
  return out;
}

const boom = (at: number) => (t: number) =>
  t < at ? 0 : 0.8 * Math.exp(-(t - at) / 0.35) * Math.sin(2 * Math.PI * 55 * (t - at));
const click = (at: number) => (t: number) =>
  t < at || t > at + 0.03 ? 0 : 0.6 * Math.exp(-(t - at) / 0.006) * noise();
const riser = (at: number, length: number) => (t: number) =>
  t < at || t > at + length + 0.05
    ? 0
    : 0.5 *
      Math.min(1, (t - at) / length) ** 2 *
      noise() *
      (t > at + length ? 1 - (t - at - length) / 0.05 : 1);

describe("findEffects", () => {
  it("names a low boom, a short bright tick and a long riser, each once", () => {
    const source = track(8, boom(1), click(3.2), riser(5, 1.2));
    const { events } = findEffects({
      source,
      sampleRate: READ_RATE,
      music: null,
      heard: null,
      beats: [],
      speech: [],
    });
    expect(events.map((e) => [Math.round(e.t * 10) / 10, e.kind])).toEqual([
      [1, "boom"],
      [3.2, "tick"],
      [5.1, "riser"],
    ]);
    expect(events[0]).toMatchObject({ band: "low", count: 1, overMusicDb: null });
    expect(events[0]!.tail).toBeGreaterThan(0.6);
    expect(events[2]!.attackMs).toBeGreaterThan(600);
  });

  it("groups the same sound and reports a quick run of it as one train", () => {
    const source = track(6, click(1), click(1.12), click(1.24), click(4));
    const { events, groups } = findEffects({
      source,
      sampleRate: READ_RATE,
      music: null,
      heard: null,
      beats: [],
      speech: [],
    });
    expect(groups).toEqual([{ id: "S1", kind: "tick", count: 4 }]);
    expect(events.map((e) => [e.t, e.count])).toEqual([
      [1, 3],
      [4, 1],
    ]);
  });

  it("leaves out a sound that keeps landing on the music's beat, and skips onsets inside speech", () => {
    const beats = Array.from({ length: 12 }, (_, i) => 0.5 + i * 0.5);
    const source = track(7, ...beats.map((b) => click(b)), boom(6.2));
    const result = findEffects({
      source,
      sampleRate: READ_RATE,
      music: null,
      heard: null,
      beats,
      speech: [],
    });
    expect(result.drumHits).toBe(12);
    expect(result.events.map((e) => e.kind)).toEqual(["boom"]);
    const muted = findEffects({
      source: track(4, boom(1)),
      sampleRate: READ_RATE,
      music: null,
      heard: null,
      beats: [],
      speech: [{ start: 0.8, end: 1.5 }],
    });
    expect(muted.events).toEqual([]);
  });

  it("measures an effect against the music playing under it", () => {
    const source = track(4, boom(2));
    const music = track(4, (t) => 0.05 * Math.sin(2 * Math.PI * 440 * t));
    const [event] = findEffects({
      source,
      sampleRate: READ_RATE,
      music,
      heard: null,
      beats: [],
      speech: [],
    }).events;
    expect(event!.overMusicDb).toBeGreaterThan(10);
  });

  it("leaves out stem residue far under the recording, and gives no level over music that is out", () => {
    const quiet = track(4, (t) => 0.01 * boom(1)(t), boom(3));
    const loud = track(4, (t) => (t < 2 ? 0.5 * Math.sin(2 * Math.PI * 220 * t) : 0));
    const { events } = findEffects({
      source: quiet,
      sampleRate: READ_RATE,
      music: track(4, () => 0),
      heard: quiet.map((v, i) => v + loud[i]!),
      beats: [],
      speech: [],
    });
    expect(events.map((e) => [Math.round(e.t), e.overMusicDb])).toEqual([[3, null]]);
  });
});
