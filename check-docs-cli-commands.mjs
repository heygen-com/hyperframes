// Every CLI command must be listed in "Find your command" in docs/packages/cli.mdx, so a new command
// cannot ship undocumented (media-use and usage did). Commands are read from cli.ts's commandLoaders.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

export function checkDocsCliCommands(
  cli = read("packages/cli/src/cli.ts"),
  docs = read("docs/packages/cli.mdx"),
) {
  const start = cli.indexOf("const commandLoaders = {");
  const end = start === -1 ? -1 : cli.indexOf("\n};", start);
  const commands =
    start === -1 || end === -1
      ? []
      : [...cli.slice(start, end).matchAll(/^ {2}"?([a-z][a-z-]*)"?:/gm)].map((m) => m[1]);
  if (commands.length === 0)
    throw new Error("cli.ts no longer declares `const commandLoaders = { ... };`");

  const from = docs.indexOf("## Find your command");
  const nextHeading = from === -1 ? -1 : docs.indexOf("\n## ", from + 1);
  const finder =
    from === -1 ? "" : docs.slice(from, nextHeading === -1 ? undefined : nextHeading);
  const missing = commands.filter((command) => !finder.includes(`\`${command}\``));
  return { commands, missing };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { commands, missing } = checkDocsCliCommands();
  if (missing.length > 0) {
    console.error(
      `Add these commands to "Find your command" in docs/packages/cli.mdx, with a section: ${missing.join(", ")}`,
    );
    process.exit(1);
  }
  console.log(`All ${commands.length} CLI commands are listed in the docs.`);
}
