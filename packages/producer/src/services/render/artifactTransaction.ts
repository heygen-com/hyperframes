import {
  closeSync,
  existsSync,
  fstatSync,
  mkdtempSync,
  openSync,
  readSync,
  readdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { HLS_MASTER_PLAYLIST, HLS_VIDEO_PLAYLIST } from "@hyperframes/engine";
import { extractMediaMetadata } from "../../utils/ffprobe.js";
import type { RenderOutputFormat } from "./renderFormat.js";

export type ArtifactKind = "file" | "directory";

export interface ArtifactTransactionFileSystem {
  existsSync(path: string): boolean;
  renameSync(source: string, destination: string): void;
  rmSync(path: string, options: { recursive: true; force: true }): void;
}

const defaultFileSystem: ArtifactTransactionFileSystem = {
  existsSync,
  renameSync,
  rmSync,
};

/**
 * Result returned by a duration probe over a single staged artifact.
 *
 * `durationSeconds` MUST be the probed value as a finite non-negative number.
 * `frames` is optional: when present it is compared against
 * `expectedFrames` to catch container-vs-stream duration drift (the multi-
 * worker encode case in #3395 reports a matching container duration but a
 * shorter frame count, so duration alone is not enough). Probe errors
 * throw — a probe that returns nothing the caller can compare is a probe
 * the validation gate cannot stand on.
 */
export interface ArtifactDurationProbeResult {
  durationSeconds: number;
  frames?: number;
}

/**
 * Pluggable probe used by `ArtifactTransaction.validate()` when the caller
 * passes `expectedDurationSeconds`. Default uses the producer's ffprobe
 * wrapper; tests inject a deterministic stub.
 *
 * A probe that cannot determine duration MUST throw rather than return a
 * zero — the caller's whole reason for asking is to detect a truncated
 * artifact, and a silent "0" is structurally indistinguishable from a
 * zero-duration container.
 */
export type ArtifactDurationProbe = (path: string) => Promise<ArtifactDurationProbeResult>;

async function defaultArtifactDurationProbe(path: string): Promise<ArtifactDurationProbeResult> {
  const meta = await extractMediaMetadata(path);
  // Forward the probed frame count when ffprobe reported one. The frame
  // count check (#3395) catches the multi-worker encode mode where the
  // container duration is reported correctly but the decoded stream is
  // shorter; without forwarding frames here, the caller's `expectedFrames`
  // is silently dropped (the assertion short-circuits on `undefined`). A
  // probe that cannot determine frames returns `undefined` — the caller
  // treats that as "no answer" and does not throw.
  return {
    durationSeconds: meta.durationSeconds,
    frames: meta.frames,
  };
}

/**
 * Caller-supplied expectation for file-artifact validation. The transaction
 * still does the readable-non-empty check; this layer adds a duration /
 * frame-count comparison against the values the pipeline already held.
 *
 * `expectedDurationSeconds` is required for the probe comparison. `fps` and
 * `expectedFrames` are optional; when both are present, frame-count is
 * checked too, which catches the multi-worker encode failure mode where
 * container duration is reported correctly but the decoded stream is shorter.
 *
 * `toleranceSeconds` defaults to a single frame at `fps` (or 20 ms when fps
 * is unknown) so that a normal container-level last-frame rounding does not
 * trip the gate. Multi-frame drops (e.g. the 326-frame / 11s truncation in
 * #3395) still fail.
 *
 * `probeTarget` / `requiredFiles` exist for directory artifacts. A `"file"`
 * artifact is its own probe target; a directory has no single one, so an HLS
 * output names its video playlist (`probeTarget: "video.m3u8"`) and the files
 * that must be present (`requiredFiles: ["master.m3u8"]`). Without
 * `probeTarget` the directory branch keeps its historical behavior — readable
 * non-empty files only, no duration gate (png-sequence).
 */
export interface ArtifactValidationExpectation {
  expectedDurationSeconds: number;
  fps?: number;
  expectedFrames?: number;
  toleranceSeconds?: number;
  /** Path relative to the staging directory to run the duration probe against. */
  probeTarget?: string;
  /** Paths relative to the staging directory that must exist as non-empty files. */
  requiredFiles?: readonly string[];
}

/**
 * The per-format expectation the render pipeline hands `validate()`, or
 * `undefined` when the format has nothing probeable.
 *
 * - `png-sequence` / `gif`: no expectation. A PNG directory has no container
 *   duration, and the GIF encoder writes `outputPath` itself without a
 *   frame-accurate duration the pipeline could compare against.
 * - `hls`: the directory's `video.m3u8` is the probe target and `master.m3u8`
 *   must exist. `expectedFrames` is passed through but is inert — ffprobe
 *   reports no frame count through the hls demuxer — so duration carries the
 *   gate.
 * - everything else: the staged file itself, duration + frame count.
 */
export function buildArtifactExpectation(input: {
  outputFormat: RenderOutputFormat;
  durationSeconds: number;
  fps: number;
  expectedFrames: number | undefined;
}): ArtifactValidationExpectation | undefined {
  if (input.outputFormat === "png-sequence" || input.outputFormat === "gif") return undefined;
  if (!Number.isFinite(input.durationSeconds) || input.durationSeconds <= 0) return undefined;
  const expectation: ArtifactValidationExpectation = {
    expectedDurationSeconds: input.durationSeconds,
    fps: input.fps,
    expectedFrames: input.expectedFrames,
  };
  if (input.outputFormat !== "hls") return expectation;
  return {
    ...expectation,
    probeTarget: HLS_VIDEO_PLAYLIST,
    requiredFiles: [HLS_MASTER_PLAYLIST],
  };
}

function createSiblingTransactionDirectory(destination: string): string {
  const parent = dirname(destination);
  const extension = extname(destination);
  const stem = extension ? basename(destination, extension) : basename(destination);
  // mkdtemp reserves the directory atomically and creates it with private
  // permissions. Keeping it beside the destination preserves same-filesystem
  // rename semantics without exposing predictable files in a shared temp dir.
  return mkdtempSync(join(parent, `.${stem}.hf-transaction-`));
}

function assertReadableNonEmptyFile(path: string): void {
  // Validate the opened object, not a pathname checked before opening it.
  // The descriptor pins the file across validation and closes the TOCTOU gap
  // between lstat(path) and open(path).
  const fd = openSync(path, "r");
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size <= 0) {
      throw new Error(`Render artifact is not a non-empty file: ${path}`);
    }
    readSync(fd, Buffer.allocUnsafe(1), 0, 1, 0);
  } finally {
    closeSync(fd);
  }
}

function collectDirectoryFiles(root: string): string[] {
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  visit(root);
  return files;
}

/**
 * Default tolerance for the duration check: one frame at the job fps, or
 * 20 ms when fps is unknown. A normal container-level last-frame rounding
 * sits inside this window; multi-frame truncations (#3395: 326 frames /
 * 11 s) fall outside it.
 */
function durationToleranceSeconds(expected: ArtifactValidationExpectation): number {
  if (expected.toleranceSeconds !== undefined) return expected.toleranceSeconds;
  const fps = expected.fps;
  return fps && fps > 0 ? 1 / fps : 0.02;
}

function assertUsableProbedDuration(
  probedSeconds: number,
  expectedSeconds: number,
  stagingPath: string,
): void {
  // A probe returning 0 or NaN cannot be compared against an expected
  // duration — it has to fail loud. Silently passing would regress the
  // truncate-then-succeed failure mode #3395 reported.
  if (!Number.isFinite(probedSeconds) || probedSeconds <= 0) {
    throw new Error(
      `Render artifact duration probe returned no usable duration for ${stagingPath} ` +
        `(got ${String(probedSeconds)}); expected ${expectedSeconds.toFixed(3)}s. ` +
        `Refusing to publish an artifact whose duration cannot be verified.`,
    );
  }
}

function assertDurationWithinTolerance(
  expectedSeconds: number,
  probedSeconds: number,
  toleranceSeconds: number,
  stagingPath: string,
): void {
  const deficit = expectedSeconds - probedSeconds;
  if (deficit <= toleranceSeconds) return;
  throw new Error(
    `Render artifact is truncated: expected ${expectedSeconds.toFixed(3)}s, ` +
      `probed ${probedSeconds.toFixed(3)}s ` +
      `(deficit ${deficit.toFixed(3)}s exceeds tolerance ${toleranceSeconds.toFixed(3)}s). ` +
      `Artifact: ${stagingPath}`,
  );
}

function assertFrameCountWithinTolerance(
  expectedFrames: number,
  probedFrames: number | undefined,
  stagingPath: string,
): void {
  if (probedFrames === undefined || !Number.isFinite(probedFrames) || probedFrames <= 0) {
    return;
  }
  const shortfall = expectedFrames - probedFrames;
  if (shortfall <= 1) return;
  throw new Error(
    `Render artifact is truncated: expected ${expectedFrames} frames, ` +
      `probed ${probedFrames} frames ` +
      `(shortfall ${shortfall} frames). Artifact: ${stagingPath}`,
  );
}

/**
 * Stages a render beside its final destination and promotes only a validated
 * artifact. File promotion uses one atomic replacement rename, so an existing
 * file remains addressable until the new file replaces it. Replacing a
 * non-empty directory cannot be expressed as one portable rename; that case
 * uses a recoverable backup handoff while preserving the previous contents on
 * ordinary failures.
 *
 * When the caller passes an `expected` expectation to `validate()`, the
 * transaction additionally probes the staged artifact's container duration
 * (and decoded frame count when available) and rejects any artifact that is
 * significantly shorter than what the pipeline asked for. A directory artifact
 * is probed only when `expected.probeTarget` names a file inside it. The
 * readable-non-empty check is unchanged; this is a second gate on top.
 */
export class ArtifactTransaction {
  readonly destinationPath: string;
  readonly stagingPath: string;
  private readonly transactionDirectory: string;
  private readonly backupPath: string;
  private state: "active" | "committed" | "rolled-back" = "active";
  private readonly durationProbe: ArtifactDurationProbe;

  constructor(
    destinationPath: string,
    private readonly kind: ArtifactKind,
    private readonly fileSystem: ArtifactTransactionFileSystem = defaultFileSystem,
    durationProbe: ArtifactDurationProbe = defaultArtifactDurationProbe,
  ) {
    this.destinationPath = resolve(destinationPath);
    this.transactionDirectory = createSiblingTransactionDirectory(this.destinationPath);
    this.stagingPath = join(this.transactionDirectory, basename(this.destinationPath));
    this.backupPath = join(this.transactionDirectory, "backup");
    this.durationProbe = durationProbe;
  }

  async validate(expected?: ArtifactValidationExpectation): Promise<void> {
    if (this.kind === "file") {
      assertReadableNonEmptyFile(this.stagingPath);
      if (expected) await this.assertArtifactDuration(expected);
      return;
    }
    this.assertReadableNonEmptyDirectory();
    if (expected) await this.assertDirectoryExpectation(expected);
  }

  private assertReadableNonEmptyDirectory(): void {
    let files: string[];
    try {
      files = collectDirectoryFiles(this.stagingPath);
    } catch (error) {
      throw new Error(`Render artifact is not a readable directory: ${this.stagingPath}`, {
        cause: error,
      });
    }
    if (files.length === 0) {
      throw new Error(`Render artifact directory is empty: ${this.stagingPath}`);
    }
    for (const file of files) assertReadableNonEmptyFile(file);
  }

  /**
   * The named-entry and duration gates a directory artifact opts into. A
   * directory has no single probe target, so an expectation without
   * `probeTarget` (png-sequence) keeps the historical behavior: structure only.
   */
  private async assertDirectoryExpectation(expected: ArtifactValidationExpectation): Promise<void> {
    for (const required of expected.requiredFiles ?? []) {
      const path = join(this.stagingPath, required);
      if (!existsSync(path)) {
        throw new Error(`Render artifact directory is missing ${required}: ${this.stagingPath}`);
      }
      assertReadableNonEmptyFile(path);
    }
    if (expected.probeTarget === undefined) return;
    await this.assertArtifactDuration(expected, join(this.stagingPath, expected.probeTarget));
  }

  private async assertArtifactDuration(
    expected: ArtifactValidationExpectation,
    probePath: string = this.stagingPath,
  ): Promise<void> {
    const expectedSeconds = expected.expectedDurationSeconds;
    if (!Number.isFinite(expectedSeconds) || expectedSeconds <= 0) return;

    const probed = await this.runDurationProbe(probePath);
    assertUsableProbedDuration(probed.durationSeconds, expectedSeconds, probePath);

    const toleranceSeconds = durationToleranceSeconds(expected);
    assertDurationWithinTolerance(
      expectedSeconds,
      probed.durationSeconds,
      toleranceSeconds,
      probePath,
    );

    if (expected.expectedFrames !== undefined) {
      // ffprobe reports `nb_frames=N/A` through the hls demuxer, so for a
      // playlist probe this assertion is a no-op by construction (the helper
      // short-circuits on an undefined frame count) and the duration check
      // above carries the gate on its own.
      assertFrameCountWithinTolerance(expected.expectedFrames, probed.frames, probePath);
    }
  }

  private async runDurationProbe(probePath: string): Promise<ArtifactDurationProbeResult> {
    try {
      return await this.durationProbe(probePath);
    } catch (error) {
      // Probe failure means we cannot assert; do not silently pass a gate the
      // caller asked for. Surfacing the probe error keeps the truncate-then-
      // succeed failure mode from regressing back into "validation passes".
      throw new Error(
        `Render artifact duration probe failed for ${probePath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error },
      );
    }
  }

  async commit(): Promise<void> {
    if (this.state !== "active") {
      throw new Error(`Cannot commit an artifact transaction in state ${this.state}`);
    }
    await this.validate();
    const hadDestination = this.fileSystem.existsSync(this.destinationPath);

    // Both files and new directories publish with one rename. In particular,
    // do not move an existing file out of the way first: rename replaces it
    // atomically, so readers see either the complete old file or the complete
    // new file and a failed rename leaves the old file untouched.
    if (this.kind === "file" || !hadDestination) {
      this.fileSystem.renameSync(this.stagingPath, this.destinationPath);
      this.state = "committed";
      this.cleanupTransactionDirectory();
      return;
    }

    // Portable Node filesystem APIs cannot atomically replace a non-empty
    // directory. Keep the backup handoff for an existing PNG-sequence output;
    // it provides recovery on ordinary errors, but not atomic visibility or
    // crash recovery. Callers should publish directory outputs to a fresh path
    // when they require the same visibility guarantee as file artifacts.
    this.fileSystem.renameSync(this.destinationPath, this.backupPath);
    try {
      this.fileSystem.renameSync(this.stagingPath, this.destinationPath);
      this.state = "committed";
    } catch (error) {
      // A competing transaction may have published while this destination was
      // temporarily vacant. Never remove that caller-visible directory: only
      // restore our backup while the destination remains unclaimed.
      this.restoreBackupIfDestinationUnclaimed();
      this.state = "rolled-back";
      this.cleanupTransactionDirectory();
      throw error;
    }
    // Promotion succeeded. Cleanup is best-effort: a stale private transaction
    // directory is safer than reporting failure after publishing the artifact.
    this.cleanupTransactionDirectory();
  }

  rollback(): void {
    if (this.state !== "active") return;
    this.fileSystem.rmSync(this.stagingPath, { recursive: true, force: true });
    if (
      this.fileSystem.existsSync(this.backupPath) &&
      !this.fileSystem.existsSync(this.destinationPath)
    ) {
      this.fileSystem.renameSync(this.backupPath, this.destinationPath);
    }
    this.cleanupTransactionDirectory();
    this.state = "rolled-back";
  }

  private restoreBackupIfDestinationUnclaimed(): void {
    if (
      !this.fileSystem.existsSync(this.backupPath) ||
      this.fileSystem.existsSync(this.destinationPath)
    ) {
      return;
    }
    try {
      this.fileSystem.renameSync(this.backupPath, this.destinationPath);
    } catch (error) {
      // Losing the rename race to a concurrent publisher is successful
      // recovery: its complete artifact owns the destination. Propagate other
      // restore failures so the caller can retry rollback with the backup kept.
      if (!this.fileSystem.existsSync(this.destinationPath)) throw error;
    }
  }

  private cleanupTransactionDirectory(): void {
    try {
      this.fileSystem.rmSync(this.transactionDirectory, { recursive: true, force: true });
    } catch {
      // Never turn a successfully published artifact into a failed render just
      // because best-effort cleanup of its private transaction directory failed.
    }
  }
}

export async function commitArtifactTransaction(
  transaction: ArtifactTransaction,
  assertNotAborted: () => void,
): Promise<void> {
  assertNotAborted();
  await transaction.commit();
}
