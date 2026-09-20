let holds = 0;

/** While held, clip manifests from the preview are ignored; release() lets the next one in. */
export function holdTimelineManifests(): () => void {
  holds += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds -= 1;
  };
}

export function timelineManifestsHeld(): boolean {
  return holds > 0;
}
