import { defineCommand } from "../utils/defineCommand.js";
import { resolveProjectOrThrow } from "../utils/project.js";
import { CliUsageError, setCommandExitCode } from "../utils/commandResult.js";
import { isUnattended } from "../utils/attendedTerminal.js";
import * as prompts from "../ui/prompts.js";
import {
  createShareService,
  type ShareAction,
  type ShareState,
  type ShareService,
} from "../share/service.js";
import { shareError } from "../share/errors.js";
import { jsonFailure } from "../utils/jsonError.js";
import type { Example } from "./_examples.js";

export const examples: Example[] = [
  ["Create a review anyone with its link can open", "hyperframes share --public"],
  ["Add the current video as a new version", "hyperframes share --update"],
  ["Read the existing share without uploading edits", "hyperframes share --status --json"],
  ["Open sharing settings on the web", "hyperframes share --manage"],
];

export default defineCommand({
  meta: {
    name: "share",
    description: "Share a rendered video for review, using the same sharing as Desktop",
  },
  args: {
    dir: { type: "positional", description: "Project directory", required: false },
    public: {
      type: "boolean",
      description: "Explicitly allow anyone with the link on first share",
    },
    team: { type: "boolean", description: "First share with this workspace" },
    "invite-only": { type: "boolean", description: "First share with invited people only" },
    private: { type: "boolean", description: "First share with private access" },
    update: {
      type: "boolean",
      description: "Render and add a new video version to the existing share",
    },
    status: { type: "boolean", description: "Read status without rendering or uploading" },
    manage: { type: "boolean", description: "Open this share's web management page" },
    space: { type: "string", description: "Owning workspace for a new share" },
    "wait-seconds": {
      type: "string",
      description: "Wait for processing (1–1800 seconds)",
      default: "300",
    },
    json: { type: "boolean", description: "Emit a machine-readable result" },
    yes: {
      type: "boolean",
      alias: "y",
      description: "Do not prompt; an explicit first-share audience is still required",
    },
  },
  async run({ args }) {
    try {
      const input = parseInput(args);
      const project = resolveProjectOrThrow(args.dir);
      const service: ShareService = createShareService(project.dir, (value) => {
        if (value && !args.json)
          process.stderr.write(
            `Sharing: ${value.step}${value.slow ? " (still processing)" : ""}\r`,
          );
      });
      await chooseAudience(input, args, service);
      const result = await service.run(input);
      await presentResult(result, input, Boolean(args.json));
    } catch (error) {
      const failure = shareError(error);
      if (args.json) console.log(JSON.stringify(jsonFailure(failure.code, failure.message)));
      else console.error(failure.message);
      setCommandExitCode(error instanceof CliUsageError ? 2 : 1);
    }
  },
});

interface ShareArgs {
  public?: boolean;
  team?: boolean;
  "invite-only"?: boolean;
  private?: boolean;
  update?: boolean;
  status?: boolean;
  manage?: boolean;
  yes?: boolean;
  json?: boolean;
  "wait-seconds"?: string;
  space?: string;
}
function parseInput(args: ShareArgs): ShareAction {
  const waitSeconds = Number(args["wait-seconds"]);
  if (!Number.isInteger(waitSeconds) || waitSeconds < 1 || waitSeconds > 1800)
    throw new CliUsageError("--wait-seconds must be an integer from 1 to 1800.");
  if ([args.update, args.status, args.manage].filter(Boolean).length > 1)
    throw new CliUsageError("Choose only one of --update, --status or --manage.");
  const audience = requestedAudience(args);
  const action = args.status ? "status" : args.manage ? "manage" : args.update ? "update" : "share";

  return { action, audience, space: args.space, waitSeconds };
}

function requestedAudience(args: ShareArgs) {
  const audiences: NonNullable<ShareAction["audience"]>[] = [];
  if (args.public) audiences.push("public");
  if (args.team) audiences.push("team");
  if (args["invite-only"]) audiences.push("invite");
  if (args.private) audiences.push("private");
  if (audiences.length > 1) throw new CliUsageError("Choose one first-share audience.");
  return audiences[0];
}

function shouldPrompt(input: ShareAction, args: ShareArgs) {
  return input.action === "share" && !input.audience && !args.yes && !args.json && !isUnattended();
}

async function chooseAudience(input: ShareAction, args: ShareArgs, service: ShareService) {
  if (!shouldPrompt(input, args)) return;
  if ((await service.status()).share) return;
  const selected = await prompts.select({
    message: "Who should be able to open this review?",
    options: [
      { value: "public", label: "Anyone with the link (available on Free)" },
      { value: "team", label: "Workspace members" },
      { value: "invite", label: "Invited people" },
      { value: "private", label: "Only me" },
    ],
  });
  if (prompts.isCancel(selected)) throw new CliUsageError("Sharing cancelled.");
  if (
    selected === "public" ||
    selected === "team" ||
    selected === "invite" ||
    selected === "private"
  )
    input.audience = selected;
}

async function presentResult(result: ShareState, input: ShareAction, json: boolean) {
  if (json) console.log(JSON.stringify({ ok: true, ...result }));
  else if (input.action === "manage") {
    console.log(result.manageUrl);
    if (!isUnattended()) await (await import("open")).default(result.manageUrl);
  } else if (result.ready) console.log(`Shared video ready: ${result.url}`);
  else if (result.state === "not_shared") console.log("This project has not been shared yet.");
  else if (result.state === "link_off")
    console.log("This share's link is off. Run hyperframes share --manage to turn it on.");
  else console.log("Your video is still processing. Run hyperframes share --status to check it.");
}
