#!/usr/bin/env node
/**
 * Remembered defaults CLI — the lightweight tier of HyperFrames user memory.
 *
 *   node prefs.mjs get --hyperframes . [--json]
 *     Print the merged view (project `.media/preferences.json` over user
 *     `~/.media/preferences.json`), each key with its source and the receipt
 *     material (confirmed_in, updated_at).
 *
 *   node prefs.mjs record --hyperframes . --key destination --value x-feed [--workflow <w>]
 *     Record one confirmed brief answer into the project tier; the same value
 *     confirmed in two different projects promotes the key to the user tier.
 *
 * Consumption rules live in hyperframes-core/references/brief-contract.md § 2
 * (Remembered defaults): a remembered value becomes the recommended option
 * with a receipt — it never skips a question.
 */
import { parseArgs } from "node:util";
import { mergedPreferences, recordPreference } from "./lib/prefs-store.mjs";

const { values: args, positionals } = parseArgs({
  options: {
    hyperframes: { type: "string", default: "." },
    key: { type: "string" },
    value: { type: "string" },
    workflow: { type: "string" },
    json: { type: "boolean", default: false },
  },
  allowPositionals: true,
});

const verb = positionals[0];

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (verb === "get") {
  const merged = mergedPreferences(args.hyperframes);
  if (args.json) {
    console.log(JSON.stringify(merged, null, 2));
  } else if (Object.keys(merged).length === 0) {
    console.log("no remembered preferences yet");
  } else {
    for (const [key, entry] of Object.entries(merged)) {
      console.log(
        `${key} = ${entry.value}  (${entry.source}; confirmed in ${entry.confirmed_in.join(", ")})`,
      );
    }
  }
} else if (verb === "record") {
  if (!args.key || !args.value) fail("record needs --key and --value");
  try {
    const result = recordPreference({
      projectDir: args.hyperframes,
      key: args.key,
      value: args.value,
      workflow: args.workflow,
    });
    const promotion = result.promoted ? "; promoted to user tier" : "";
    console.log(`recorded ${result.key} = ${result.value} (project${promotion})`);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
} else {
  fail(
    "usage: prefs.mjs <get|record> --hyperframes . [--key <k> --value <v> --workflow <w>] [--json]",
  );
}
