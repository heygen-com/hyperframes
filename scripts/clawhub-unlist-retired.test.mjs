import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unlistRetired } from "./clawhub-unlist-retired.mjs";
import { RETIRED_SKILLS } from "../packages/cli/src/utils/skillsManifest.ts";

const NOT_FOUND = "Error: Skill not found or unavailable to this account.";

function fakeClawhub({ listed = [], moderationOnly = [], inspectError = null, refuse = null }) {
  const calls = [];
  const visible = new Set(listed);
  const inspect = (args) => {
    const slug = args[1].split("/")[1];
    if (inspectError) return { ok: false, output: "", message: inspectError };
    if (moderationOnly.includes(slug))
      return { ok: true, output: JSON.stringify({ skill: null, moderation: {} }), message: "" };
    if (!visible.has(slug)) return { ok: false, output: "", message: NOT_FOUND };
    const output = JSON.stringify({ skill: { slug, tags: { latest: "1.0.3" } } });
    return { ok: true, output, message: output };
  };
  const hide = (args) => {
    if (refuse) return { ok: false, output: "", message: refuse };
    visible.delete(args[1].split("/")[1]);
    return { ok: true, output: "", message: "" };
  };
  const commands = { inspect, hide };
  const run = (args) => {
    calls.push(args);
    return commands[args[0]](args);
  };
  return { run, calls };
}

const reasonFor = (slug) => `${slug} was retired`;
const unlist = (clawhub, names, dryRun = false) =>
  unlistRetired({ run: clawhub.run, names, reasonFor, dryRun });
const hideCalls = (clawhub) => clawhub.calls.filter((args) => args[0] === "hide");

describe("ClawHub retired-skill unlisting", () => {
  it("hides each retired skill still listed under the owner, with its retirement note", () => {
    const clawhub = fakeClawhub({ listed: ["general-video"] });

    assert.deepEqual(unlist(clawhub, ["general-video", "pr-to-video"]), {
      hidden: ["general-video"],
      pending: [],
      errors: [],
    });
    assert.deepEqual(clawhub.calls, [
      ["inspect", "heygen-com/general-video", "--json"],
      ["hide", "heygen-com/general-video", "--yes", "--reason", "general-video was retired"],
      ["inspect", "heygen-com/pr-to-video", "--json"],
    ]);
  });

  it("hides nothing on a second run", () => {
    const clawhub = fakeClawhub({ listed: ["general-video", "pr-to-video"] });
    unlist(clawhub, ["general-video", "pr-to-video"]);
    clawhub.calls.length = 0;

    assert.deepEqual(unlist(clawhub, ["general-video", "pr-to-video"]), {
      hidden: [],
      pending: [],
      errors: [],
    });
    assert.equal(hideCalls(clawhub).length, 0);
  });

  it("counts a skill the registry shows only by its moderation record as unlisted", () => {
    const clawhub = fakeClawhub({ moderationOnly: ["hyperframes-core"] });

    assert.deepEqual(unlist(clawhub, ["hyperframes-core"]).hidden, []);
    assert.equal(hideCalls(clawhub).length, 0);
  });

  it("only names the listed skills in a dry run", () => {
    const clawhub = fakeClawhub({ listed: ["general-video", "hyperframes-audio"] });

    assert.deepEqual(unlist(clawhub, ["general-video", "pr-to-video", "hyperframes-audio"], true), {
      hidden: [],
      pending: ["general-video", "hyperframes-audio"],
      errors: [],
    });
    assert.equal(hideCalls(clawhub).length, 0);
  });

  it("reports an inspect failure other than not-found, without hiding", () => {
    const clawhub = fakeClawhub({ listed: ["general-video"], inspectError: "fetch failed" });

    assert.deepEqual(unlist(clawhub, ["general-video"]).errors, ["general-video: fetch failed"]);
    assert.equal(hideCalls(clawhub).length, 0);
  });

  it("reports a hide the registry refuses", () => {
    const clawhub = fakeClawhub({ listed: ["general-video"], refuse: "Forbidden" });

    assert.deepEqual(unlist(clawhub, ["general-video"]), {
      hidden: [],
      pending: [],
      errors: ["general-video: Forbidden"],
    });
  });

  it("reads the retired names from the CLI manifest and fails the workflow on a refusal", () => {
    const bin = mkdtempSync(join(tmpdir(), "clawhub-fake-"));
    try {
      writeFileSync(
        join(bin, "clawhub"),
        [
          "#!/bin/sh",
          'if [ "$1" = inspect ]; then echo \'{"skill":{"slug":"x"}}\'; exit 0; fi',
          "echo 'Forbidden' >&2",
          "exit 1",
          "",
        ].join("\n"),
      );
      chmodSync(join(bin, "clawhub"), 0o755);
      const script = new URL("./clawhub-unlist-retired.mjs", import.meta.url).pathname;
      const run = (env) =>
        spawnSync(process.execPath, [script], { encoding: "utf8", env: { PATH: bin, ...env } });

      const preview = run({ DRY_RUN: "true" });
      assert.equal(preview.status, 0, preview.stderr);
      for (const name of RETIRED_SKILLS) assert.match(preview.stdout, new RegExp(`^${name}$`, "m"));

      const refused = run({});
      assert.equal(refused.status, 1);
      assert.match(refused.stderr, /::error::general-video: Forbidden/);
    } finally {
      rmSync(bin, { recursive: true, force: true });
    }
  });
});
