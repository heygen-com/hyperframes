import { strict as assert } from "node:assert";
import { test } from "node:test";

import { checkDocsCliCommands } from "./check-docs-cli-commands.mjs";

const CLI = `import { render } from "./commands/render.js";

const commandLoaders = {
  render: () => import("./commands/render.js"),
  "media-use": () => import("./commands/media-use.js"),
};

export const cli = { commandLoaders };
`;

const DOCS = `# CLI

## Find your command

### \`render\`

Renders a composition.

### \`media-use\`

Lists the media helpers.
`;

test("passes when every command is documented", () => {
  const { commands, missing } = checkDocsCliCommands(CLI, DOCS);

  assert.deepEqual(commands, ["render", "media-use"]);
  assert.deepEqual(missing, []);
});

test("reports a command that is missing from the docs", () => {
  const docs = DOCS.replace("### `media-use`", "### Media helpers");

  assert.deepEqual(checkDocsCliCommands(CLI, docs).missing, ["media-use"]);
});

test("reports every command when the docs have no command finder section", () => {
  const docs = DOCS.replace("## Find your command", "## Commands");

  assert.deepEqual(checkDocsCliCommands(CLI, docs).missing, ["render", "media-use"]);
});

test("throws when the CLI source no longer declares commandLoaders", () => {
  assert.throws(
    () => checkDocsCliCommands(`export const cli = {};\n`, DOCS),
    /no longer declares `const commandLoaders = \{ \.\.\. \};`/,
  );
});

test("throws when the commandLoaders block has no closing brace", () => {
  assert.throws(
    () => checkDocsCliCommands(`const commandLoaders = {\n  render: () => {}\n`, DOCS),
    /no longer declares `const commandLoaders = \{ \.\.\. \};`/,
  );
});
