import { homedir } from "node:os";
import { join } from "node:path";

// The one owner of where the person's media library lives. This repo's test runs set
// HYPERFRAMES_MEDIA_HOME_REQUIRED, so a test that forgot HYPERFRAMES_MEDIA_HOME fails instead
// of writing fixtures into the media library apps list as the person's own files.
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
