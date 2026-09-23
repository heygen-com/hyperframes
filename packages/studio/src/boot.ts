// The page's only static script: start the opening project's preview, then load Studio.
// Everything Studio renders arrives with ./main, so the preview's request does not wait on it.
import "@hyperframes/player";
import { dropBootPreview, startBootPreview } from "./player/lib/bootPreview";
import { prefetchPreviewForHash } from "./utils/previewPrefetch";
import { parseProjectIdFromHash } from "./utils/projectRouting";

const openingProject = parseProjectIdFromHash(window.location.hash);
prefetchPreviewForHash(window.location.hash, startBootPreview(window.location.hash));
window.addEventListener("hashchange", () => {
  if (parseProjectIdFromHash(window.location.hash) !== openingProject) dropBootPreview();
  prefetchPreviewForHash(window.location.hash);
});

void import("./main");
