import { runWarmCheck } from "./warmCheckClient.js";

if (!(await runWarmCheck())) process.stdout.write("NOT SERVED\n");
