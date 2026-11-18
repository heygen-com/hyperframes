import { runCommand, type ArgsDef, type CommandDef } from "citty";
import { afterEach, describe, expect, it, vi } from "vitest";
import { consumeCommandResult } from "../../utils/commandResult.js";

const client = vi.hoisted(() => ({
  getRender: vi.fn(),
  listRenders: vi.fn(),
  deleteRender: vi.fn(),
}));
vi.mock("../../cloud/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../cloud/index.js")>()),
  createCloudClient: async () => client,
}));

const { default: get } = await import("./get.js");
const { default: list } = await import("./list.js");
const { default: remove } = await import("./delete.js");

// Built rather than written: a literal control character in the source is a lint error.
const esc = String.fromCharCode(27);
const osc = `${esc}]52;c;cHduZWQ=${String.fromCharCode(7)}`;
const shown = "\\x1b]52;c;cHduZWQ=\\x07";
const colors = new RegExp(`${esc}\\[[0-9;]*m`, "g");

const render = {
  render_id: `r1${osc}`,
  status: `failed${esc}[2J`,
  format: `mp4${osc}`,
  composition: `index${osc}.html`,
  title: `Launch${osc}`,
  callback_id: `cb${osc}`,
  created_at: 1_700_000_000,
  video_url: `https://example.test/v${osc}`,
  thumbnail_url: `https://example.test/t${osc}`,
  failure_message: `Audio file not found: a${osc}.mp3`,
};

async function output<T extends ArgsDef>(command: CommandDef<T>, rawArgs: string[]) {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  await runCommand(command, { rawArgs });
  const printed = log.mock.calls.map((call) => call.join(" ")).join("\n");
  log.mockRestore();
  consumeCommandResult();
  return printed;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("cloud subcommands on a terminal", () => {
  it("get prints server fields with control characters as visible escapes", async () => {
    client.getRender.mockResolvedValue(render);

    const human = await output(get, ["r1"]);
    const json = JSON.parse(await output(get, ["r1", "--json"]));

    expect(human.replace(colors, "")).not.toContain(esc);
    expect(human).toContain(`Audio file not found: a${shown}.mp3`);
    for (const value of [
      "r1",
      "mp4",
      "index",
      "Launch",
      "cb",
      "example.test/v",
      "example.test/t",
    ]) {
      expect(human).toContain(`${value}${shown}`);
    }
    expect(human).toContain("failed\\x1b[2J");
    expect(json.render).toEqual(render);
  });

  it("list prints server fields with control characters as visible escapes", async () => {
    client.listRenders.mockResolvedValue({
      data: [render],
      has_more: true,
      next_token: `next${osc}`,
    });

    const human = await output(list, []);
    const json = JSON.parse(await output(list, ["--json"]));

    expect(human.replace(colors, "")).not.toContain(esc);
    expect(human).toContain(`r1${shown}`);
    expect(human).toContain("failed\\x1b[2J");
    expect(human).toContain(`Launch${shown}`);
    expect(human).toContain(`next${shown}`);
    expect(json.renders).toEqual([render]);
    expect(json.next_token).toBe(`next${osc}`);
  });

  it("delete prints the returned id with control characters as visible escapes", async () => {
    client.deleteRender.mockResolvedValue({ render_id: `r1${osc}` });

    const human = await output(remove, ["r1", "--no-confirm"]);

    expect(human.replace(colors, "")).not.toContain(esc);
    expect(human).toContain(`r1${shown}`);
  });
});
