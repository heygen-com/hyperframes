// Every CLI command must be listed in "Find your command" in docs/packages/cli.mdx, so a new command
// cannot ship undocumented (media-use and usage did). Commands are read from cli.ts's commandLoaders.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const CLI_PATH = "packages/cli/src/cli.ts";
const DOCS_PATH = "docs/packages/cli.mdx";
const LOADERS_DECLARATION = "const commandLoaders = {";
const NO_LOADERS = "cli.ts no longer declares `const commandLoaders = { ... };`";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

/**
 * Reads the CLI commands declared in `cliSource` and the ones missing from the
 * "Find your command" section of `docsText`.
 *
 * @param {string} cliSource contents of packages/cli/src/cli.ts
 * @param {string} docsText contents of docs/packages/cli.mdx
 * @returns {{ commands: string[], missing: string[] }}
 */
export function checkDocsCliCommands(cliSource, docsText) {
  const start = cliSource.indexOf(LOADERS_DECLARATION);
  const end = start === -1 ? -1 : cliSource.indexOf("\n};", start);
  if (start === -1 || end === -1) throw new Error(NO_LOADERS);

  const commands = [...cliSource.slice(start, end).matchAll(/^ {2}"?([a-z][a-z-]*)"?:/gm)].map(
    (match) => match[1],
  );
  if (commands.length === 0) throw new Error(NO_LOADERS);

  const from = docsText.indexOf("## Find your command");
  const sectionEnd = from === -1 ? -1 : docsText.indexOf("\n## ", from + 1);
  const finder =
    from === -1 ? "" : docsText.slice(from, sectionEnd === -1 ? undefined : sectionEnd);
  const missing = commands.filter((command) => !finder.includes(`\`${command}\``));

  return { commands, missing };
}

function main() {
  const { commands, missing } = checkDocsCliCommands(read(CLI_PATH), read(DOCS_PATH));

  if (missing.length > 0) {
    console.error(
      `Add these commands to "Find your command" in ${DOCS_PATH}, with a section: ${missing.join(", ")}`,
    );
    process.exit(1);
  }

  console.log(`All ${commands.length} CLI commands are listed in the docs.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
