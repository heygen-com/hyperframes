import { expect, it } from "vitest";
import { timedShard } from "../vitest.shards";

const SPAWN = { path: "src/cli.agentMode.test.ts", alone: true };
const HEAVY = [
  "src/timeline/timeline.e2e.test.ts",
  "src/heygen/generate.test.ts",
  "src/commands/snapshot.test.ts",
  "src/commands/usage.test.ts",
].map((path) => ({ path, alone: false }));
const LIGHT = Array.from({ length: 300 }, (_, i) => ({
  path: `src/light${i}.test.ts`,
  alone: false,
}));
const FILES = [...LIGHT, ...HEAVY, SPAWN];

it("puts every test file in exactly one lane", () => {
  const lanes = [timedShard(FILES, 1, 2), timedShard(FILES, 2, 2)];
  expect(
    lanes
      .flat()
      .map((file) => file.path)
      .sort(),
  ).toEqual(FILES.map((file) => file.path).sort());
});

it("gives the lane running the 8-minute spawn file none of the other heavy files", () => {
  const spawnLane = [1, 2]
    .map((index) => timedShard(FILES, index, 2))
    .find((lane) => lane.includes(SPAWN))!;
  expect(spawnLane.filter((file) => HEAVY.includes(file))).toEqual([]);
  expect(spawnLane.length).toBeLessThan(FILES.length / 2);
});

it("splits the same files the same way on every lane, whatever order they come in", () => {
  expect(timedShard([...FILES].reverse(), 1, 2)).toEqual(timedShard(FILES, 1, 2));
});
