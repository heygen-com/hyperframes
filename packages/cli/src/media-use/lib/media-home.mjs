import { homedir } from "node:os";
import { join } from "node:path";

// The one place that decides where the person's global media library lives: `<home>/.media`.
// HYPERFRAMES_MEDIA_HOME points it elsewhere. This repo's media-use test runs set
// HYPERFRAMES_MEDIA_HOME_REQUIRED, so a test that forgot to point it fails instead of writing
// fixtures into the library Desktop and Studio list as the person's own files.
export function mediaHome() {
  const override = process.env.HYPERFRAMES_MEDIA_HOME;
  if (override) return override;
  if (process.env.HYPERFRAMES_MEDIA_HOME_REQUIRED) {
    throw new Error(
      "media-use: a test reached the real ~/.media; set HYPERFRAMES_MEDIA_HOME to a temp dir",
    );
  }
  return homedir();
}

export function globalMediaDir() {
  return join(mediaHome(), ".media");
}
