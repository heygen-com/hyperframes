// OpenCV for the measuring tools that need it (template tracking, optical flow, faces), as opencv.js: one WebAssembly
// file that gives every machine the same numbers. It is not shipped in the CLI; the first use downloads it and the
// Haar face models, pinned by size and sha256, into ~/.cache/hyperframes/opencv/<version>/.
import { mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { downloadToFile } from "../cloud/download.js";
import { verifies, type ModelFile } from "../whisper/modelFile.js";
import { Fix } from "./media.js";

const VERSION = "4.10.0";
export const OPENCV_DIR = join(homedir(), ".cache", "hyperframes", "opencv", VERSION);

interface Pinned extends ModelFile {
  url: string;
}

// opencv.js is @techstark/opencv-js 4.10.0-release.1 (Apache-2.0); the cascades are OpenCV's own (BSD-3-Clause).
const CASCADES = "https://raw.githubusercontent.com/opencv/opencv/4.10.0/data/haarcascades";
const FILES: readonly Pinned[] = [
  {
    name: "opencv.js",
    bytes: 10_378_215,
    sha256: "19b46167b59efbef9cc3836264b0b657110833e4b1df84282004b8b3141c048d",
    url: "https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.10.0-release.1/dist/opencv.js",
  },
  {
    name: "haarcascade_frontalface_alt2.xml",
    bytes: 540_616,
    sha256: "7b0c967d9abbdfbde025eb9c786947d151b6426040d07a8f9562ed8fd90724b4",
    url: `${CASCADES}/haarcascade_frontalface_alt2.xml`,
  },
  {
    name: "haarcascade_profileface.xml",
    bytes: 828_514,
    sha256: "b39a4a3be45539db146a7fc1d3e761a292c196eb88421185e6a615b3055e612d",
    url: `${CASCADES}/haarcascade_profileface.xml`,
  },
];

/** The parts of the OpenCV API the measuring tools use. */
export interface Mat {
  rows: number;
  cols: number;
  data32F: Float32Array;
  data64F: Float64Array;
  data: Uint8Array;
  delete(): void;
}
interface Size {
  width: number;
  height: number;
}
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface RectVector {
  size(): number;
  get(i: number): Rect;
  delete(): void;
}
export interface Cv {
  Mat: new () => Mat;
  RectVector: new () => RectVector;
  Size: new (w: number, h: number) => Size;
  CascadeClassifier: new () => {
    load(path: string): boolean;
    detectMultiScale(
      gray: Mat,
      out: RectVector,
      scale: number,
      neighbours: number,
      flags: number,
      min: Size,
    ): void;
    delete(): void;
  };
  matFromArray(rows: number, cols: number, type: number, data: ArrayLike<number>): Mat;
  matchTemplate(image: Mat, templ: Mat, result: Mat, method: number): void;
  minMaxLoc(src: Mat): {
    minVal: number;
    maxVal: number;
    minLoc: { x: number; y: number };
    maxLoc: { x: number; y: number };
  };
  calcOpticalFlowFarneback(
    prev: Mat,
    next: Mat,
    flow: Mat,
    pyrScale: number,
    levels: number,
    winsize: number,
    iterations: number,
    polyN: number,
    polySigma: number,
    flags: number,
  ): void;
  estimateAffine2D(from: Mat, to: Mat): Mat;
  FS_createDataFile(
    parent: string,
    name: string,
    data: Uint8Array,
    read: boolean,
    write: boolean,
    own: boolean,
  ): void;
  CV_8UC1: number;
  CV_32FC2: number;
  TM_CCOEFF_NORMED: number;
}

const isCv = (v: unknown): v is Cv =>
  typeof v === "object" && v !== null && "Mat" in v && "matFromArray" in v;

/** Every pinned file present and verified; the missing ones fetched. */
// fallow-ignore-next-line complexity
async function ensureOpenCv(onStatus?: (message: string) => void): Promise<void> {
  const missing: Pinned[] = [];
  for (const f of FILES) if (!(await verifies(join(OPENCV_DIR, f.name), f))) missing.push(f);
  if (!missing.length) return;
  mkdirSync(OPENCV_DIR, { recursive: true });
  for (const f of missing) {
    onStatus?.(`Downloading ${f.name} (${Math.round(f.bytes / 1e5) / 10} MB, once)...`);
    const temp = join(OPENCV_DIR, `${f.name}.part-${process.pid}`);
    try {
      await downloadToFile(f.url, temp);
      if (!(await verifies(temp, f)))
        throw new Fix(
          `${f.name} did not match its pinned size and sha256`,
          "run the command again to retry the download",
        );
      renameSync(temp, join(OPENCV_DIR, f.name));
    } catch (err) {
      if (err instanceof Fix) throw err;
      throw new Fix(
        `could not download ${f.name} (${err instanceof Error ? err.message : String(err)})`,
        "check the network and run the command again",
      );
    } finally {
      rmSync(temp, { force: true });
    }
  }
}

let loaded: Promise<Cv> | null = null;

/** opencv.js, ready to call, with the face models in its file system. Loaded once per process. */
export function loadOpenCv(onStatus?: (message: string) => void): Promise<Cv> {
  loaded ??= (async () => {
    await ensureOpenCv(onStatus);
    const mod: unknown = createRequire(import.meta.url)(join(OPENCV_DIR, "opencv.js"));
    if (typeof mod !== "object" || mod === null) throw new Error("opencv.js did not load");
    // Wait on its init hook, never on the module: it is a thenable that does not settle under await.
    await new Promise<void>((resolve) => {
      if ("Mat" in mod) resolve();
      else Object.assign(mod, { onRuntimeInitialized: () => resolve() });
    });
    // Ready now; without its `then`, promises can carry it like any other object.
    Reflect.deleteProperty(mod, "then");
    if (!isCv(mod)) throw new Error("opencv.js did not initialize");
    const cv = mod;
    for (const f of FILES.filter((x) => x.name.endsWith(".xml")))
      cv.FS_createDataFile("/", f.name, readFileSync(join(OPENCV_DIR, f.name)), true, false, false);
    return cv;
  })();
  return loaded;
}

/** Grey bytes as an 8-bit single-channel Mat. */
export const greyMat = (cv: Cv, px: Uint8Array, w: number, h: number) =>
  cv.matFromArray(h, w, cv.CV_8UC1, px);
