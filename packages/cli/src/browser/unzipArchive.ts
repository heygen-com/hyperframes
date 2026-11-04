import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { runCancellableProcess } from "../utils/cancellableProcess.js";

const UNZIP_DISK_FULL_STATUS = 50;

/**
 * Unzip with its input closed: on a full disk unzip asks "Continue? (y/n)" on the input `@puppeteer/browsers` leaves
 * open, and hangs. Not detached, so a cancel of the setup worker stops it. False when there is no unzip binary.
 */
export async function unzipArchive(archivePath: string, folderPath: string): Promise<boolean> {
  // unzip -d creates only the last level; an empty folderPath would make install() report a broken install.
  await mkdir(dirname(folderPath), { recursive: true });
  try {
    await runCancellableProcess("unzip", ["-q", "-o", archivePath, "-d", folderPath], {
      detached: false,
    });
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    if ((err as { status?: number }).status === UNZIP_DISK_FULL_STATUS) {
      throw new Error(
        "Extraction failed: the disk filled up while unpacking Chrome. Free disk space, then retry.",
        { cause: err },
      );
    }
    const said = (err as { stderr?: string }).stderr?.trim();
    throw new Error(`Extraction failed: ${said || (err as Error).message}`, { cause: err });
  }
}
