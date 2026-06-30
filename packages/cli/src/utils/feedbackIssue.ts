// Reading package.json at runtime from the single-file bundled CLI is awkward,
// so we keep the canonical repo as a constant. It must match the `repository.url`
// in packages/cli/package.json.
export const HYPERFRAMES_REPO_URL = "https://github.com/heygen-com/hyperframes";

const TITLE_MAX = 80;
// Pre-filled issue URLs have a practical length limit (~8 KB), so cap the
// comment that goes into the body.
const COMMENT_MAX = 4000;

export interface IssueInput {
  repoUrl: string;
  rating: number;
  comment?: string;
  /** Public URL of the published minimal repro, if publishing succeeded. */
  repoPublicUrl?: string;
  /** Doctor summary string (os/node/ffmpeg...). */
  environment: string;
  cliVersion: string;
}

function normalizeRepoUrl(repoUrl: string): string {
  const trimmed = repoUrl
    .trim()
    .replace(/\/$/, "")
    .replace(/\.git$/, "");
  return trimmed || HYPERFRAMES_REPO_URL;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function buildIssueTitle(rating: number, comment?: string): string {
  const firstLine = comment?.split("\n")[0]?.trim();
  if (!firstLine) return `Render feedback (rating ${rating}/5)`;
  return `[feedback] ${truncate(firstLine, TITLE_MAX)}`;
}

function buildIssueBody(input: IssueInput): string {
  const comment = input.comment?.trim();
  const repro = input.repoPublicUrl
    ? `Published minimal repro: ${input.repoPublicUrl}`
    : "_Publishing the repro failed, no public link available._";

  return [
    `**Rating:** ${input.rating}/5`,
    "",
    "## Comment",
    comment ? truncate(comment, COMMENT_MAX) : "_No comment provided._",
    "",
    "## Minimal repro",
    repro,
    "",
    "## Environment",
    "```",
    input.environment || "(unavailable)",
    `cli=${input.cliVersion}`,
    "```",
    "",
    "---",
    "_Filed via `hyperframes feedback --file-issue`._",
  ].join("\n");
}

export function buildIssueUrl(input: IssueInput): string {
  const repo = normalizeRepoUrl(input.repoUrl);
  const title = encodeURIComponent(buildIssueTitle(input.rating, input.comment));
  const body = encodeURIComponent(buildIssueBody(input));
  return `${repo}/issues/new?title=${title}&body=${body}&labels=bug`;
}
