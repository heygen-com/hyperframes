import { basename } from "node:path";
import { realpathSync } from "node:fs";
import {
  bindShareHost,
  projectFingerprint,
  ReviewFailed,
  setReviewSite,
  signedInRequest,
} from "@hyperframes/share";
import { reviewUploadOrigins } from "@hyperframes/share/host.mjs";
import { findFFprobe } from "../browser/ffmpeg.js";
import { latestShareRender } from "./render.js";
import { shareSite } from "./auth.js";
import { cliReviewUploadOrigins } from "./uploadOrigins.js";

const projects = new Set<string>();

function isStorageOrigin(origin: string): boolean {
  if (!URL.canParse(origin)) return false;
  const url = new URL(origin);
  const loopback = url.protocol === "http:" && url.hostname === "127.0.0.1";
  return (
    url.origin === origin && !url.hostname.includes("*") && (url.protocol === "https:" || loopback)
  );
}

export function assertReviewUploadStorage(): void {
  const origins = reviewUploadOrigins().filter(Boolean);
  if (origins.length === 0 || !origins.every(isStorageOrigin))
    throw new ReviewFailed(503, "review_upload_origins_required");
}

export function bindCliShareProject(path: string): string {
  const dir = realpathSync(path);
  projects.add(dir);
  bindShareHost({
    reviewUploadOrigins: cliReviewUploadOrigins(),
    normalize: realpathSync,
    assertOpenProject: (path) => {
      const normalized = realpathSync(path);
      if (!projects.has(normalized)) throw new Error("This project is not open for sharing.");
      return normalized;
    },
    resolveOpenProjectByPath: (path) => {
      const normalized = realpathSync(path);
      return projects.has(normalized) ? { id: normalized, dir: normalized } : null;
    },
    listOpenProjects: () => [...projects].map((dir) => ({ dir })),
    homeName: basename,
    latestExportFile: latestShareRender,
    projectFingerprint,
    signedInRequest: (deps) =>
      signedInRequest({
        ...deps,
        headers: { "X-HeyGen-Source": "cli", "X-HeyGen-Client-Source": "hyperframes" },
      }),
    ffBinary: () => {
      const binary = findFFprobe();
      if (!binary) throw new Error("Install FFmpeg to prepare a shared video.");
      return binary;
    },
    channelSite: "https://hyperframes.dev",
    signinSites: ["https://hyperframes.dev", "https://dev.hyperframes.dev"],
  });
  setReviewSite(shareSite());
  return dir;
}
