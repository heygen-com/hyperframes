import { extname } from "node:path";
import { MIME_TYPES } from "@hyperframes/studio-server/mime";
import { realFilePath } from "@hyperframes/studio-server/safe-path";

const COPIED_TYPE = /^(?:image|video|audio|font)\/|^text\/(?:css|javascript);/;

/** What an upload copies from outside the project: the preview server's image, video, audio, font, CSS and JS types. */
export const OUTSIDE_FILE_EXTENSIONS: ReadonlySet<string> = new Set(
  Object.entries(MIME_TYPES)
    .filter(([, type]) => COPIED_TYPE.test(type))
    .map(([extension]) => extension),
);

const hasCopiedType = (path: string) => OUTSIDE_FILE_EXTENSIONS.has(extname(path).toLowerCase());

export const isCopiedOutsideFileType = (absPath: string): boolean =>
  hasCopiedType(absPath) && hasCopiedType(realFilePath(absPath));
