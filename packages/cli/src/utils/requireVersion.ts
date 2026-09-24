import { UNRESOLVED_VERSION } from "@hyperframes/engine";

/**
 * `--require-version` turns a version PIN into a version GATE.
 *
 * Pinning (`npx hyperframes@X.Y.Z`) stops the renderer drifting between runs,
 * but it cannot prove which version actually ran: a project states the version
 * it believes it used and nothing checks the claim. The mp4 provenance tag does
 * not close this either — it stamped a constant `0.0.0-dev` on every render for
 * twenty published versions, so 710 of 710 tagged files on one fleet carry a
 * value that identifies nothing (#4365, fixed in #4409). Until that fix reaches
 * a published build, an artifact cannot tell you what produced it.
 *
 * So the gate reads the version from the RUNNING engine and refuses before any
 * work when it does not match. Three properties matter:
 *
 *  1. It FAILS CLOSED on an unresolved version. If the engine cannot say what
 *     it is, the gate cannot verify anything, and passing would reproduce the
 *     unfalsifiable claim this flag exists to remove.
 *  2. It compares EXACTLY, with no range semantics. A range is what the caller
 *     already gets from npm; this answers "did the version I named run", and a
 *     caret here would let the gate pass on a version the caller did not name.
 *  3. It runs BEFORE the render, so a mismatch costs a startup rather than a
 *     full encode.
 */
export function checkRequiredVersion(required: string, actual: string): string | null {
  const want = required.trim();
  if (!want) {
    return "--require-version needs a version, e.g. --require-version 0.8.72.";
  }
  if (actual === UNRESOLVED_VERSION) {
    return (
      `--require-version ${want} cannot be checked: this build cannot resolve its own ` +
      `version, so nothing here can confirm which renderer is running. Refusing rather ` +
      `than passing — an unverifiable gate is the unfalsifiable pin it replaces.`
    );
  }
  if (actual !== want) {
    return (
      `--require-version ${want} does not match the running renderer ${actual}. ` +
      `Pin the version you meant (npx hyperframes@${want}) or update the flag; ` +
      `rendering rounds of one campaign on two versions makes their difference unattributable.`
    );
  }
  return null;
}
