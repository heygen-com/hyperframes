const RELEASE = "chore(?:\\(release\\))?: (?:release|cut) v(\\d+\\.\\d+\\.\\d+)";

/** The version a release commit's subject names, or null for any other subject. */
export function releaseVersionOf(subject) {
  return new RegExp(`^${RELEASE}(?: \\(#\\d+\\))?$`).exec(subject)?.[1] ?? null;
}

/** Whether a commit subject stays out of release notes: a release, a version bump, or an explicit skip. */
export function skipsChangelog(subject) {
  const lower = subject.toLowerCase();
  return (
    lower.includes("[skip changelog]") ||
    new RegExp(`^${RELEASE}`).test(lower) ||
    /^chore: bump version/.test(lower)
  );
}
