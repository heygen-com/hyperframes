export type NpxCommand = {
  command: string;
  args: string[];
};

export function buildNpxCommand(
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
): NpxCommand {
  if (platform === "win32") {
    // npm installs npx as a .cmd shim on Windows; invoke it through cmd.exe
    // instead of relying on child_process to resolve or execute the shim.
    return { command: "cmd.exe", args: ["/d", "/s", "/c", "npx.cmd", ...args] };
  }

  return { command: "npx", args: [...args] };
}
