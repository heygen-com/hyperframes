import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { assetPathsFromCandidates, stageAssets } from "./assets.mjs";

test("rejects asset candidates that escape the project assets directory", () => {
  assert.deepEqual(
    assetPathsFromCandidates(
      "assets/../secret.png — traversal; /tmp/secret.png — absolute; C:/secret.png — drive",
    ),
    [],
  );
});

test("recognizes an asset candidate already present in a nested assets directory", () => {
  const hyperframesDir = mkdtempSync(join(tmpdir(), "hyperframes-stage-assets-"));
  try {
    const keyframesDir = join(hyperframesDir, "assets/keyframes");
    mkdirSync(keyframesDir, { recursive: true });
    writeFileSync(join(keyframesDir, "scene-01-meeting.png"), "fixture");

    const result = stageAssets({
      hyperframesDir,
      frames: [
        {
          extra: {
            asset_candidates: "assets/keyframes/scene-01-meeting.png — approved meeting keyframe",
          },
        },
      ],
    });

    assert.equal(result.staged, 1);
    assert.deepEqual([...result.wanted], ["keyframes/scene-01-meeting.png"]);
    assert.deepEqual(result.anomalies, []);
  } finally {
    rmSync(hyperframesDir, { recursive: true, force: true });
  }
});
