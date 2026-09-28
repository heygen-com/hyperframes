import { checkForUpdate } from "./utils/updateCheck.js";
import { refreshSkillsCache } from "./utils/skillsUpdateCheck.js";

// Detached child of launchBackgroundChecks: refreshes the caches the next run's notices read.
const due = process.argv.slice(2);
await Promise.allSettled([
  due.includes("update") && checkForUpdate(),
  due.includes("skills") && refreshSkillsCache(),
]);
