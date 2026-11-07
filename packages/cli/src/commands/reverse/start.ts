import { existsSync, mkdirSync } from "node:fs";
import { defineCommand } from "../../utils/defineCommand.js";
import type { Example } from "../_examples.js";
import { jsonArg, runMeasure, videoArg } from "../../measure/command.js";
import { Fix } from "../../measure/media.js";
import {
  reverseUpgradeUrl,
  startReverseSession,
  type ReverseSession,
  type ReverseStart,
} from "../../heygen/reverse.js";
import {
  projectConfigPath,
  readProjectConfig,
  recordProjectReverseSession,
  seedProjectAuthoringSkill,
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

export function subscribeCommand(sessionId?: string): string {
  return `npx hyperframes billing subscribe --feature reverse --skill ${SKILL}${sessionId ? ` --session ${sessionId}` : ""}`;
}

async function freeFields(session: ReverseSession) {
  const link = await reverseUpgradeUrl(session);
  return {
    upgrade_url: link,
    subscribe_command: link === null ? null : subscribeCommand(session.sessionId),
  };
}

async function summary(started: ReverseStart, savedTo: string | undefined) {
  if (!started.recorded) {
    return {
      signed_in: started.reason !== "not_signed_in",
      plan: started.plan ?? null,
      recorded: false,
      saved_to: savedTo ?? null,
      ...(started.plan === "free"
        ? { upgrade_url: await reverseUpgradeUrl(), subscribe_command: subscribeCommand() }
        : {}),
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
    ...(session.plan === "free" ? await freeFields(session) : {}),
  };
}

function makeProjectStampedWithSkill(dir: string): string | undefined {
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    return undefined;
  }
  seedProjectAuthoringSkill(dir, SKILL);
  return readProjectConfig(dir)?.authoringSkill === SKILL ? projectConfigPath(dir) : undefined;
}

function saveRun(started: ReverseStart, dir: string | undefined): string | undefined {
  if (started.recorded && (dir !== undefined || existsSync(projectConfigPath("."))))
    return recordProjectReverseSession(dir ?? ".", started.session.sessionId, SKILL);
  return dir === undefined ? undefined : makeProjectStampedWithSkill(dir);
}

async function refusalWhenServerBlocksFree(session: ReverseSession): Promise<Fix | undefined> {
  if (session.gate !== "block" || session.plan !== "free") return undefined;
  if ((await reverseUpgradeUrl(session)) === null) {
    return new Fix(
      "Reverse is part of HyperFrames Pro, and a plan can't be purchased right now.",
      "Run reverse start again once this account is on Pro.",
    );
  }
  const command = subscribeCommand(session.sessionId);
  return new Fix(
    `Reverse is part of HyperFrames Pro. Run \`${command}\`, then run reverse start again.`,
    command,
  );
}

export default defineCommand({
  meta: {
    name: "start",
    description:
      "Note a reverse run with HeyGen (signed in: saves its session in the project), then print the video's probe; stops only when HeyGen blocks a Free account",
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
      const savedTo = saveRun(started, dir);
      const refused = started.recorded
        ? await refusalWhenServerBlocksFree(started.session)
        : undefined;
      if (refused) throw refused;
      return { reverse: await summary(started, savedTo), ...probe };
    });
  },
});
