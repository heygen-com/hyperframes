import { basename } from "node:path";
import { realpathSync } from "node:fs";
import {
  bindShareHost,
  projectFingerprint,
  setReviewSite,
  signedInRequest,
} from "@hyperframes/share";
import { findFFprobe } from "../browser/ffmpeg.js";
import { latestShareRender } from "./render.js";
import { shareSite } from "./auth.js";

const projects = new Set<string>();
export function bindCliShareProject(path: string): string {
  const dir = realpathSync(path);
  projects.add(dir);
  bindShareHost({
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
