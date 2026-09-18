import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { consumeCommandResult } from "../utils/commandResult.js";
import {
  lastJsonOutput,
  makeFixtureProject,
  makeRunner,
  spyOnConsole,
} from "./_offlineAssetsTestKit.js";

// withMeta just annotates the object; identity keeps the assertions simple.
vi.mock("../utils/updateCheck.js", () => ({ withMeta: (o: unknown) => o }));
// resolveProject reports invalid-dir failures to telemetry; keep tests silent.
vi.mock("../telemetry/events.js", () => ({ trackCommandFailure: () => {} }));

import ledgerCommand from "./ledger.js";

const run = makeRunner(ledgerCommand);

describe("ledger command", () => {
  let dir: string;

  beforeEach(() => {
    consumeCommandResult();
    spyOnConsole();
    dir = makeFixtureProject("hf-ledger-cmd-", `  <img src="assets/img/missing.png">`);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    consumeCommandResult();
    rmSync(dir, { recursive: true, force: true });
  });

  it("--json reports the classified asset graph and exits 0", async () => {
    await run({ dir, json: true, "strict-offline": false });
    expect(consumeCommandResult().exitCode).toBe(0);

    const output = lastJsonOutput();
    expect(output.ok).toBe(true);
    expect(output.files).toEqual(["index.html"]);
    expect(output.counts).toMatchObject({ total: 3, remote: 1, local: 1, missing: 1, data: 0 });
    expect(output.remoteUrls).toEqual([
      "https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js",
    ]);
  });

  it("--strict-offline exits 1 while a remote reference remains", async () => {
    await run({ dir, json: true, "strict-offline": true });
    expect(consumeCommandResult().exitCode).toBe(1);
    expect(lastJsonOutput().ok).toBe(false);
  });

  it("--strict-offline exits 0 once the project is fully local", async () => {
    writeFileSync(join(dir, "index.html"), `<img src="assets/img/logo.png">`);
    await run({ dir, json: true, "strict-offline": true });
    expect(consumeCommandResult().exitCode).toBe(0);
    expect(lastJsonOutput().ok).toBe(true);
  });

  it("human-readable output prints counts and the vendor hint", async () => {
    await run({ dir, json: false, "strict-offline": false });
    expect(consumeCommandResult().exitCode).toBe(0);
    const printed = vi
      .mocked(console.log)
      .mock.calls.map((call) => call.join(" "))
      .join("\n");
    expect(printed).toContain("Asset ledger");
    expect(printed).toContain("hyperframes vendor");
  });

  it("errors surface as JSON with exit 1", async () => {
    await run({ dir: join(dir, "does-not-exist"), json: true, "strict-offline": false });
    expect(consumeCommandResult().exitCode).toBe(1);
    expect(lastJsonOutput().ok).toBe(false);
  });
});
