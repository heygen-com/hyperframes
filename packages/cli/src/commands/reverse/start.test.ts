import { runCommand } from "citty";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CliRuntimeError, consumeCommandResult } from "../../utils/commandResult.js";
import type { ReverseStart } from "../../heygen/reverse.js";

const server = vi.hoisted(() => ({
  answer: { recorded: false, reason: "not_signed_in" } as ReverseStart,
  resumed: [] as (string | undefined)[],
}));
const probe = vi.hoisted(() => ({ fail: false }));

vi.mock("../../heygen/plan.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../heygen/plan.js")>()),
  pageUrl: (_kind: string, fields: { feature?: string; rs?: string } = {}) =>
    `https://plans.test/?feature=${fields.feature}${fields.rs ? `&rs=${fields.rs}` : ""}`,
}));
vi.mock("../../heygen/reverse.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../heygen/reverse.js")>()),
  startReverseSession: async (opts: { resumeSessionId?: string } = {}) => {
    server.resumed.push(opts.resumeSessionId);
    return server.answer;
  },
}));
vi.mock("../measure/probe.js", () => ({
  probeReport: (video: string) => {
    if (probe.fail) throw new Error(`no video at ${video}`);
    return { video, width: 1080, height: 1920, fps: 30 };
  },
}));

const { default: start } = await import("./start.js");

const SESSION = "rvs_0f8fad5b-d9cb-469f-a165-70867728950e";
const recorded = (
  plan: "free" | "pro" | "unknown" = "pro",
  upgradeUrl?: string | null,
  gate: "record" | "block" = "record",
): ReverseStart => ({
  recorded: true,
  session: { sessionId: SESSION, plan, gate, ...(upgradeUrl !== undefined ? { upgradeUrl } : {}) },
});

let root: string;
let printed: string[];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "hf-reverse-start-"));
  vi.spyOn(process, "cwd").mockReturnValue(root);
  printed = [];
  vi.spyOn(console, "log").mockImplementation((line: unknown) => void printed.push(String(line)));
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  server.answer = { recorded: false, reason: "not_signed_in" };
  server.resumed = [];
  probe.fail = false;
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
  consumeCommandResult();
});

const output = () => JSON.parse(printed.at(-1) ?? "{}") as Record<string, unknown>;
const config = (dir: string) =>
  JSON.parse(readFileSync(join(dir, "hyperframes.json"), "utf-8")) as Record<string, unknown>;
const run = (...rawArgs: string[]) => runCommand(start, { rawArgs: ["ref.mp4", ...rawArgs] });

describe("reverse start", () => {
  it("saves the session in a new project folder and prints the probe", async () => {
    server.answer = recorded();
    const dir = join(root, "rebuild");
    await run("--dir", dir);

    expect(output()).toMatchObject({
      ok: true,
      video: "ref.mp4",
      width: 1080,
      reverse: {
        signed_in: true,
        plan: "pro",
        recorded: true,
        session_id: SESSION,
        saved_to: join(dir, "hyperframes.json"),
      },
    });
    expect(config(dir)).toMatchObject({
      reverseSessionId: SESSION,
      authoringSkill: "reverse-any-video",
    });
  });

  it("patches an existing project config in place and resumes its session", async () => {
    const text = '{\n    "registry": "https://r.test",\n    "custom": 1\n}\n';
    writeFileSync(join(root, "hyperframes.json"), text);
    server.answer = recorded();
    await run();
    expect(config(root)).toEqual({
      registry: "https://r.test",
      custom: 1,
      reverseSessionId: SESSION,
      authoringSkill: "reverse-any-video",
    });

    await run();
    expect(server.resumed).toEqual([undefined, SESSION]);
  });

  it("saves a session whose plan is unknown and prints the plan as null", async () => {
    server.answer = recorded("unknown");
    const dir = join(root, "rebuild");
    await run("--dir", dir);
    expect(output()).toMatchObject({ ok: true, reverse: { recorded: true, plan: null } });
    expect(output().reverse).not.toHaveProperty("upgrade_url");
    expect(config(dir)).toMatchObject({ reverseSessionId: SESSION });
  });

  it.each<[string, ReverseStart, string | null]>([
    [
      "the server's link",
      recorded("free", "https://u.test/p?feature=reverse&rs=1"),
      "https://u.test/p?feature=reverse&rs=1",
    ],
    [
      "the plans page carrying the session",
      recorded("free"),
      `https://plans.test/?feature=reverse&rs=${SESSION}`,
    ],
    [
      "the plans page when nothing was recorded",
      { recorded: false, reason: "unavailable", plan: "free" },
      "https://plans.test/?feature=reverse",
    ],
    ["no link when the server withholds it", recorded("free", null), null],
  ])("prints the upgrade link for Free: %s", async (_label, answer, link) => {
    server.answer = answer;
    await run();
    expect(output()).toMatchObject({ ok: true, reverse: { plan: "free", upgrade_url: link } });
  });

  it("starts fresh when the saved session is not one the server takes", async () => {
    writeFileSync(
      join(root, "hyperframes.json"),
      JSON.stringify({ reverseSessionId: "rvs_legacy" }),
    );
    server.answer = recorded();
    await run();
    expect(server.resumed).toEqual([undefined]);
    expect(config(root)).toMatchObject({ reverseSessionId: SESSION });
  });

  it("writes nothing into a folder that is not a project unless --dir names it", async () => {
    server.answer = recorded();
    await run();
    expect(output()).toMatchObject({ ok: true, reverse: { recorded: true, saved_to: null } });
    expect(() => readFileSync(join(root, "hyperframes.json"))).toThrow();
  });

  it.each<[string, ReverseStart, object]>([
    [
      "not signed in",
      { recorded: false, reason: "not_signed_in" },
      { signed_in: false, plan: null, recorded: false },
    ],
    [
      "the server cannot answer",
      { recorded: false, reason: "unavailable", plan: "free" },
      { signed_in: true, plan: "free", recorded: false },
    ],
  ])(
    "never stops the run when %s, and still makes the --dir project",
    async (_label, answer, reverse) => {
      server.answer = answer;
      const dir = join(root, "rebuild");
      await run("--dir", dir);
      expect(output()).toMatchObject({
        ok: true,
        width: 1080,
        reverse: { ...reverse, saved_to: join(dir, "hyperframes.json") },
      });
      expect(config(dir)).toMatchObject({ authoringSkill: "reverse-any-video" });
      expect(config(dir)).not.toHaveProperty("reverseSessionId");
    },
  );

  it("names no saved_to when the --dir project's config is broken, and leaves it as it was", async () => {
    const dir = join(root, "rebuild");
    mkdirSync(dir);
    writeFileSync(join(dir, "hyperframes.json"), "{ not json");
    await run("--dir", dir);
    expect(output()).toMatchObject({ ok: true, reverse: { recorded: false, saved_to: null } });
    expect(readFileSync(join(dir, "hyperframes.json"), "utf-8")).toBe("{ not json");
  });

  it("stops a Free account the server blocks, with the subscribe command as the fix, after saving the session", async () => {
    server.answer = recorded(
      "free",
      "https://hyperframes.studio/pricing?feature=reverse&rs=1",
      "block",
    );
    const dir = join(root, "rebuild");
    await expect(run("--dir", dir)).rejects.toThrow(CliRuntimeError);
    const command = `npx hyperframes billing subscribe --feature reverse --skill reverse-any-video --session ${SESSION}`;
    expect(output()).toMatchObject({
      ok: false,
      error: expect.stringContaining(command),
      fix: command,
    });
    expect(config(dir)).toMatchObject({ reverseSessionId: SESSION });
  });

  it("names the subscribe command on a Free account the server lets through", async () => {
    server.answer = recorded("free");
    await run();
    expect(output().reverse).toMatchObject({
      subscribe_command: `npx hyperframes billing subscribe --feature reverse --skill reverse-any-video --session ${SESSION}`,
    });
  });

  it("names no subscribe command when the server withholds the link", async () => {
    server.answer = recorded("free", null);
    await run();
    expect(output().reverse).toMatchObject({ upgrade_url: null, subscribe_command: null });
  });

  it("names no link when the server blocks Free and withholds the link: no plan can be bought now", async () => {
    server.answer = recorded("free", null, "block");
    const dir = join(root, "rebuild");
    await expect(run("--dir", dir)).rejects.toThrow(CliRuntimeError);
    expect(output()).toMatchObject({
      ok: false,
      error: expect.stringContaining("can't be purchased right now"),
    });
    expect(printed.at(-1)).not.toContain("http");
    expect(printed.at(-1)).not.toContain("billing subscribe");
    expect(config(dir)).toMatchObject({ reverseSessionId: SESSION });
  });

  it.each<[string, ReverseStart]>([
    ["a Pro account under block", recorded("pro", undefined, "block")],
    ["an unknown plan under block", recorded("unknown", undefined, "block")],
    ["a Free account under record", recorded("free")],
  ])("goes on for %s", async (_label, answer) => {
    server.answer = answer;
    await run();
    expect(output()).toMatchObject({ ok: true, width: 1080, reverse: { recorded: true } });
  });

  it("fails like measure probe when the video cannot be probed, before asking the server", async () => {
    probe.fail = true;
    await expect(run()).rejects.toThrow(CliRuntimeError);
    expect(output()).toMatchObject({ ok: false, error: expect.stringContaining("ref.mp4") });
    expect(server.resumed).toEqual([]);
  });
});
