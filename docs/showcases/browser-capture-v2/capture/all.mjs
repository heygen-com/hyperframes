import { captureCase } from "./capture-case.mjs";
import { caseIds } from "./expectations.mjs";

for (const caseId of caseIds) await captureCase(caseId);
