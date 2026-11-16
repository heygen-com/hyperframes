import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { reusableLambdaAssets, WORKFLOW_BOT } from "./release-lambda-assets.mjs";

const RUN_CREATED_AT = "2026-11-16T03:00:00Z";
const ALL_ASSETS = [
  "hyperframes-lambda-handler.zip",
  "hyperframes-lambda-handler.sha256",
  "hyperframes-lambda-video-arm64.oci.tar",
  "hyperframes-lambda-video-arm64.sha256",
];

const release = ({
  author = WORKFLOW_BOT,
  createdAt = "2026-11-16T03:10:00Z",
  assets = ALL_ASSETS,
  uploader = WORKFLOW_BOT,
} = {}) => ({
  tag_name: "v9.8.7",
  author: { login: author },
  created_at: createdAt,
  assets: assets.map((name) => ({ name, uploader: { login: uploader } })),
});

describe("Lambda assets a release run may reuse", () => {
  it("builds everything when the release does not exist yet", () => {
    assert.deepEqual(
      reusableLambdaAssets({ release: null, runCreatedAt: RUN_CREATED_AT, runAttempt: 1 }),
      {
        zip: false,
        image: false,
      },
    );
  });

  it("reuses what an earlier attempt of this run attached", () => {
    assert.deepEqual(
      reusableLambdaAssets({ release: release(), runCreatedAt: RUN_CREATED_AT, runAttempt: 2 }),
      {
        zip: true,
        image: true,
      },
    );
    const zipOnly = release({ assets: ALL_ASSETS.slice(0, 2) });
    assert.deepEqual(
      reusableLambdaAssets({ release: zipOnly, runCreatedAt: RUN_CREATED_AT, runAttempt: 2 }),
      {
        zip: true,
        image: false,
      },
    );
  });

  it("refuses a release that existed before this run's first attempt", () => {
    for (const [args, reason] of [
      [{ release: release(), runAttempt: 1 }, "first attempt"],
      [{ release: release({ author: "someone" }), runAttempt: 2 }, "a person made it"],
      [
        { release: release({ createdAt: "2026-11-16T02:59:59Z" }), runAttempt: 2 },
        "made before the run",
      ],
      [{ release: release({ assets: [] }), runAttempt: 1 }, "empty, first attempt"],
    ]) {
      assert.throws(
        () => reusableLambdaAssets({ runCreatedAt: RUN_CREATED_AT, ...args }),
        /did not create it/,
        reason,
      );
    }
  });

  it("refuses an asset someone else uploaded to this run's release", () => {
    assert.throws(
      () =>
        reusableLambdaAssets({
          release: release({ uploader: "someone" }),
          runCreatedAt: RUN_CREATED_AT,
          runAttempt: 2,
        }),
      /uploaded by someone other than this workflow/,
    );
  });

  it("refuses half of an asset pair", () => {
    const half = release({ assets: ["hyperframes-lambda-handler.zip"] });
    assert.throws(
      () => reusableLambdaAssets({ release: half, runCreatedAt: RUN_CREATED_AT, runAttempt: 2 }),
      /without its pair/,
    );
  });
});
