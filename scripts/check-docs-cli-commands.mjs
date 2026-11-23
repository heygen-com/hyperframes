// Every CLI command must be listed in "Find your command" in docs/packages/cli.mdx, so a new command
// cannot ship undocumented (media-use and usage did). Commands are read from cli.ts's commandLoaders.
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const cli = read("packages/cli/src/cli.ts");
const start = cli.indexOf("const commandLoaders = {");
const commands = [
  ...cli.slice(start, cli.indexOf("\n};", start)).matchAll(/^ {2}"?([a-z][a-z-]*)"?:/gm),
].map((m) => m[1]);
if (commands.length === 0)
  throw new Error("cli.ts no longer declares `const commandLoaders = { ... };`");

const docs = read("docs/packages/cli.mdx");
const from = docs.indexOf("## Find your command");
const finder = docs.slice(from, docs.indexOf("\n## ", from + 1));
const missing = commands.filter((command) => !finder.includes(`\`${command}\``));

if (missing.length > 0) {
  console.error(
    `Add these commands to "Find your command" in docs/packages/cli.mdx, with a section: ${missing.join(", ")}`,
  );
  process.exit(1);
}
console.log(`All ${commands.length} CLI commands are listed in the docs.`);
