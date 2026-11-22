// An older preview read never replaces a newer one on the timeline, whichever frame or hook it came through.
let issued = 0;
let landed = 0;

export function nextTimelineRevision(): number {
  return ++issued;
}

export function landTimelineRevision(revision: number): boolean {
  if (revision < landed) return false;
  landed = revision;
  return true;
}

export function supersedeTimelineReads(): void {
  landed = ++issued;
}
