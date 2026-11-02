import { existsSync } from "node:fs";
import { defineCommand } from "../../utils/defineCommand.js";
import type { Example } from "../_examples.js";
import { jsonArg, runMeasure, videoArg } from "../../measure/command.js";
import { reverseUpgradeUrl, startReverseSession, type ReverseStart } from "../../heygen/reverse.js";
import {
  projectConfigPath,
  readProjectConfig,
  recordProjectReverseSession,
} from "../../utils/projectConfig.js";
import { probeReport } from "../measure/probe.js";

export const examples: Example[] = [
  [
    "Note the run with HeyGen, save its session in the project, and probe the video",
    "hyperframes reverse start ref.mp4 --dir my-rebuild",
  ],
  ["Resume inside an existing project", "hyperframes reverse start original.mp4"],
];

const SKILL = "reverse-any-video";

function summary(started: ReverseStart, savedTo: string | undefined) {
  if (!started.recorded) {
    return {
      signed_in: started.reason !== "not_signed_in",
      plan: started.plan ?? null,
      recorded: false,
      ...(started.plan === "free" ? { upgrade_url: reverseUpgradeUrl() } : {}),
    };
  }
  const { session } = started;
  return {
    signed_in: true,
    plan: session.plan === "unknown" ? null : session.plan,
    recorded: true,
    session_id: session.sessionId,
    gate: session.gate,
    saved_to: savedTo ?? null,
    ...(session.plan === "free" ? { upgrade_url: reverseUpgradeUrl(session) } : {}),
  };
}

export default defineCommand({
  meta: {
    name: "start",
    description:
      "Note a reverse run with HeyGen (signed in: saves its session in the project), then print the video's probe; never stops the run",
  },
  args: {
    video: videoArg,
    dir: {
      type: "string",
      description:
        "Project folder that keeps the session in hyperframes.json (created when absent; init keeps it). Default: the current folder, when it is a project",
    },
    json: jsonArg,
  },
  async run({ args }) {
    await runMeasure(async () => {
      const probe = probeReport(String(args.video));
      const dir = args.dir === undefined ? undefined : String(args.dir);
      const projectDir = dir ?? ".";
      const started = await startReverseSession({
        resumeSessionId: readProjectConfig(projectDir)?.reverseSessionId,
      });
      const save = started.recorded && (dir !== undefined || existsSync(projectConfigPath(".")));
      const savedTo = save
        ? recordProjectReverseSession(projectDir, started.session.sessionId, SKILL)
        : undefined;
      return { reverse: summary(started, savedTo), ...probe };
    });
  },
});
