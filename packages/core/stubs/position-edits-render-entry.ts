import {
  EDIT_BASE_X_ATTR,
  EDIT_BASE_Y_ATTR,
  applyPositionEdits,
  installPositionEditsSeekReapply,
} from "../src/runtime/positionEdits";

function start(): void {
  if (!document.querySelector(`[${EDIT_BASE_X_ATTR}], [${EDIT_BASE_Y_ATTR}]`)) {
    return;
  }
  applyPositionEdits(document);
  installPositionEditsSeekReapply(window);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start, { once: true });
} else {
  start();
}
