export type NpxCommand = {
  command: string;
  args: string[];
};

/** npm installs `name` as a `.cmd` shim on Windows; invoke it through cmd.exe
 * instead of relying on child_process to resolve or execute the shim, or on
 * `shell: true` with hand-rolled argument quoting. */
function buildCmdShimCommand(
  name: string,
  args: readonly string[],
  platform: NodeJS.Platform,
): NpxCommand {
  if (platform === "win32") {
    return { command: "cmd.exe", args: ["/d", "/s", "/c", `${name}.cmd`, ...args] };
  }
  return { command: name, args: [...args] };
}

export function buildNpxCommand(
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
): NpxCommand {
  return buildCmdShimCommand("npx", args, platform);
}

export function buildNpmCommand(
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
): NpxCommand {
  return buildCmdShimCommand("npm", args, platform);
}
