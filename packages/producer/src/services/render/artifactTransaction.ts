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
 * Stages a render beside its final destination and promotes only a validated
 * artifact. File promotion uses one atomic replacement rename, so an existing
 * file remains addressable until the new file replaces it. Replacing a
 * non-empty directory cannot be expressed as one portable rename; that case
 * uses a recoverable backup handoff while preserving the previous contents on
 * ordinary failures.
 */
export class ArtifactTransaction {
  readonly destinationPath: string;
  readonly stagingPath: string;
  private readonly transactionDirectory: string;
  private readonly backupPath: string;
  private state: "active" | "committed" | "rolled-back" = "active";

  constructor(
    destinationPath: string,
    private readonly kind: ArtifactKind,
    private readonly fileSystem: ArtifactTransactionFileSystem = defaultFileSystem,
  ) {
    this.destinationPath = resolve(destinationPath);
    this.transactionDirectory = createSiblingTransactionDirectory(this.destinationPath);
    this.stagingPath = join(this.transactionDirectory, basename(this.destinationPath));
    this.backupPath = join(this.transactionDirectory, "backup");
  }

  validate(): void {
    if (this.kind === "file") {
      assertReadableNonEmptyFile(this.stagingPath);
      return;
    }
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

  commit(): void {
    if (this.state !== "active") {
      throw new Error(`Cannot commit an artifact transaction in state ${this.state}`);
    }
    this.validate();
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
