import { strict as assert } from "node:assert";
import { test } from "node:test";

import { checkDocsCliCommands } from "./check-docs-cli-commands.mjs";

const SAMPLE_CLI = `const commandLoaders = {
  init: () => import("./commands/init.js"),
  render: () => import("./commands/render.js"),
  "media-use": () => import("./commands/media-use.js"),
};
`;

const SAMPLE_DOCS = `# CLI Reference

## Find your command

| Command | Summary |
| --- | --- |
| \`init\` | Initialize a project |
| \`render\` | Render a composition |
| \`media-use\` | Inspect media assets |

## Other section
`;

test("passes when every command in commandLoaders is listed under Find your command", () => {
  const result = checkDocsCliCommands(SAMPLE_CLI, SAMPLE_DOCS);
  assert.deepEqual(result.commands, ["init", "render", "media-use"]);
  assert.deepEqual(result.missing, []);
});

test("reports commands missing from the Find your command section", () => {
  const docsMissingMediaUse = `# CLI Reference

## Find your command

- \`init\`
- \`render\`

## Later section
Mentioning \`media-use\` outside "Find your command" does not count.
`;
  const result = checkDocsCliCommands(SAMPLE_CLI, docsMissingMediaUse);
  assert.deepEqual(result.missing, ["media-use"]);
});

test("fails loudly when commandLoaders cannot be found in the CLI source", () => {
  assert.throws(
    () => checkDocsCliCommands("export const cli = {};", SAMPLE_DOCS),
    /cli\.ts no longer declares `const commandLoaders = \{ \.\.\. \};`/,
  );
  assert.throws(
    () => checkDocsCliCommands("const commandLoaders = {\n};\n", SAMPLE_DOCS),
    /cli\.ts no longer declares `const commandLoaders = \{ \.\.\. \};`/,
  );
});

test("current packages/cli/src/cli.ts and docs/packages/cli.mdx stay in sync", () => {
  const result = checkDocsCliCommands();
  assert.ok(result.commands.length > 0);
  assert.deepEqual(result.missing, []);
});
