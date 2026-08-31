import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { assertEvidence, caseIds } from "./expectations.mjs";

const evidenceDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../evidence");

for (const caseId of caseIds) {
  const evidence = JSON.parse(await readFile(resolve(evidenceDirectory, `${caseId}.json`), "utf8"));
  assertEvidence(caseId, evidence);
  console.log(`${caseId}: verified`);
}
