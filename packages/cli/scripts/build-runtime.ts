import { loadHyperframeRuntimeSource } from "@hyperframes/core";
import { writeFileSync } from "node:fs";

writeFileSync("dist/hyperframe-runtime.js", loadHyperframeRuntimeSource());
