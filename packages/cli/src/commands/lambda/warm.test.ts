import { beforeEach, describe, expect, it, vi } from "vitest";

const spawnSync = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawnSync }));

const { warmFunction } = await import("./warm.js");

const target = { functionName: "hf-video", region: "eu-west-1" };
const reply = (stdout: string, status = 0, stderr = "") => ({ status, stdout, stderr });

beforeEach(() => spawnSync.mockReset());

describe("warmFunction", () => {
  it("invokes the warm action on the function, behind the profile when there is one", () => {
    spawnSync.mockReturnValue(reply('{"StatusCode":200}'));
    warmFunction({ ...target, awsProfile: "work" });

    const [command, args] = spawnSync.mock.calls[0] as [string, string[]];
    expect(command).toBe("aws");
    expect(args.slice(0, 6)).toEqual([
      "--profile",
      "work",
      "lambda",
      "invoke",
      "--function-name",
      "hf-video",
    ]);
    expect(args[args.indexOf("--payload") + 1]).toBe('{"Action":"warm"}');
    expect(args).toContain("eu-west-1");
    expect(args[args.indexOf("--output") + 1]).toBe("json");
  });

  it("throws with the aws error text when the invoke exits non-zero", () => {
    spawnSync.mockReturnValue(reply("", 254, "AccessDeniedException"));
    expect(() => warmFunction(target)).toThrow(/code 254: AccessDeniedException/);
  });

  it("throws when the function answers with an error", () => {
    spawnSync.mockReturnValue(reply('{"StatusCode":200,"FunctionError":"Unhandled"}'));
    expect(() => warmFunction(target)).toThrow(/answered Unhandled/);
  });

  it("throws when the aws CLI cannot be started", () => {
    spawnSync.mockReturnValue({ error: new Error("spawn aws ENOENT") });
    expect(() => warmFunction(target)).toThrow(/ENOENT/);
  });
});
