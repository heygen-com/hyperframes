import type { SignedInDeps, signedInRequest } from "./signedInRequest.mjs";

/** What sharing a project and its review link take from the host's main process (host.mjs bindShareHost). The
 * network and the person's session stay the host's: every review call goes through its signed-in request and every
 * archive through its uploader. */
export interface ShareHost {
  execFile: typeof import("node:child_process").execFile;
  /** The key every open-project lookup uses: the real path. */
  normalize(path: string): string;
  /** The open project's normalized path; refuses a project that is not open. */
  assertOpenProject(path: string): string;
  /** The open project at `path`, or null when it is not open. */
  resolveOpenProjectByPath(path: string): { id: string; dir: string } | null;
  /** All open projects, for invalidating removed review identities. */
  listOpenProjects(): Array<{ dir: string }>;
  /** The name the host shows for a project. */
  homeName(path: string, folder?: string): string;
  /** PUTs an archive through the host's network, hearing each chunk sent; answers the HTTP status. */
  uploadWithProgress(
    url: URL,
    headers: Record<string, string>,
    archive: Uint8Array,
    onSent: (sent: number) => void,
  ): Promise<number>;
  /** Requests to HeyGen's sign-in host as the signed-in person, traced as the host traces its API calls. */
  signedInRequest(deps: Omit<SignedInDeps, "trace">): ReturnType<typeof signedInRequest>;
  /** The newest finished export recorded in the project's renders folder whose file is still there. */
  latestExportFile(dir: string): { path: string; fingerprint?: string; id: string } | null;
  /** Trusted video upload origins configured by the host independently of the review API response. */
  reviewUploadOrigins?: readonly string[];
  /** The project as change detection sees it, as one hash. */
  projectFingerprint(dir: string): Promise<string>;
  /** The path of the host's FFmpeg tool `name`. */
  ffBinary(name: "ffprobe"): string;
  /** The sign-in site of the host's own channel, whose review record keeps the original name. */
  channelSite: string;
  /** Every sign-in site the host can sign in on. */
  signinSites: string[];
}
