// `lambda deploy` without a repo checkout: fetch the pinned handler ZIP, verify its sha256 and
// stage it beside the packaged SAM template.

import { createHash } from "node:crypto";
import {
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { downloadFile } from "../../utils/download.js";
import { isMissingPackageError } from "../../utils/missingPackage.js";
import { VERSION } from "../../version.js";

const DOCS_URL = "https://hyperframes.heygen.com/deploy/aws-lambda";
const HANDLER_CACHE_DIR = join(homedir(), ".cache", "hyperframes", "lambda-handler");

type AdapterSdk = typeof import("@hyperframes/aws-lambda/sdk");

export interface StageDeps {
  loadAdapter: () => Promise<Partial<AdapterSdk>>;
  download: (url: string, dest: string, options: { maxBytes: number }) => Promise<void>;
  cacheDir: string;
  log: (line: string) => void;
}

export const defaultDeps: StageDeps = {
  loadAdapter: () => import("@hyperframes/aws-lambda/sdk"),
  download: downloadFile,
  cacheDir: HANDLER_CACHE_DIR,
  log: (line) => console.log(line),
};

/** The one message for "no checkout and no pinned handler": everything the user needs to fix it. */
export function noHandlerMessage(adapterInstalled: boolean): string {
  const adapter = adapterInstalled
    ? "  - The installed @hyperframes/aws-lambda has no prebuilt handler for its version. Install one that does:\n"
    : "  - Install the Lambda adapter; its release pins the prebuilt handler:\n";
  return (
    "[lambda deploy] This is not a HyperFrames checkout, and no prebuilt Lambda handler is available.\n" +
    adapter +
    `      npm install -g @hyperframes/aws-lambda@${VERSION}\n` +
    "  - Or run from a hyperframes checkout, or set HYPERFRAMES_REPO_ROOT to one.\n" +
    `Docs: ${DOCS_URL}`
  );
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export interface PinnedAsset {
  version: string;
  url: string;
  sha256: string;
  bytes: number;
}

export async function fetchPinned(
  pinned: PinnedAsset,
  asset: { fileName: string; label: string; urlOverride?: string },
  deps: Pick<StageDeps, "download" | "cacheDir" | "log">,
): Promise<string> {
  const dir = join(deps.cacheDir, `${pinned.version}-${pinned.sha256}`);
  const file = join(dir, asset.fileName);
  if (existsSync(file) && (await sha256File(file)) === pinned.sha256) {
    deps.log(`→ Using verified ${asset.label} ${pinned.version} from ${dir}`);
    return file;
  }
  // Override for mirrors and pre-release testing; the pinned sha256 still decides.
  const url = asset.urlOverride ?? pinned.url;
  deps.log(`→ Downloading ${asset.label} ${pinned.version} (${pinned.bytes} bytes)`);
  mkdirSync(dir, { recursive: true });
  const partial = `${file}.download`;
  await deps.download(url, partial, { maxBytes: pinned.bytes });
  const actual = await sha256File(partial);
  if (actual !== pinned.sha256) {
    unlinkSync(partial);
    const urlWithoutCredentials = url.split("?")[0];
    throw new Error(
      `[lambda deploy] Refusing the ${asset.label} from ${urlWithoutCredentials}: sha256 ${actual} does not match ` +
        `the ${pinned.sha256} pinned by @hyperframes/aws-lambda@${pinned.version}.`,
    );
  }
  renameSync(partial, file);
  deps.log(`→ Verified sha256 ${pinned.sha256}`);
  return file;
}

/** Returns the directory holding the verified `handler.zip` and its `template.yaml`. */
export async function stagePrebuiltHandler(deps: StageDeps = defaultDeps): Promise<string> {
  let sdk: Partial<AdapterSdk>;
  try {
    sdk = await deps.loadAdapter();
  } catch (err) {
    if (isMissingPackageError(err, "@hyperframes/aws-lambda"))
      throw new Error(noHandlerMessage(false));
    throw err;
  }
  // Adapters released before handler zips were published lack prebuiltHandler.
  const pinned = sdk.prebuiltHandler?.();
  if (!pinned) throw new Error(noHandlerMessage(true));

  const zip = await fetchPinned(
    pinned,
    {
      fileName: "handler.zip",
      label: "handler ZIP",
      urlOverride: process.env.HYPERFRAMES_LAMBDA_HANDLER_URL,
    },
    deps,
  );
  const dir = dirname(zip);
  const templateDir = dirname(pinned.templatePath);
  for (const file of readdirSync(templateDir).filter((name) => name.endsWith(".yaml"))) {
    copyFileSync(join(templateDir, file), join(dir, file));
  }
  return dir;
}
