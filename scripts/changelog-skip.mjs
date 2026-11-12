/** Whether a commit subject stays out of release notes: a release, a version bump, or an explicit skip. */
export function skipsChangelog(subject) {
  const lower = subject.toLowerCase();
  return (
    lower.includes("[skip changelog]") ||
    /^chore: release v\d+\.\d+\.\d+/.test(lower) ||
    /^chore: bump version/.test(lower)
  );
}
