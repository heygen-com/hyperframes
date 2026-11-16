import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { copyFile, mkdir, mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

// Paths supplied by callers resolve from their current working directory.
const { values } = parseArgs({
  options: {
    props: { type: "string" },
    text: { type: "string" },
    "bg-video": { type: "string" },
    output: { type: "string" },
    frames: { type: "string" },
  },
});
const props = values.props ? JSON.parse(values.props) : {};
if (!props || typeof props !== "object" || Array.isArray(props))
  throw new Error("--props must be a JSON object");
const inputProps = { text: values.text ?? props.text ?? "Your financial story" };
if (typeof inputProps.text !== "string") throw new Error("text must be a string");
const background = values["bg-video"] ?? props.bgVideo;
if (background !== undefined && typeof background !== "string")
  throw new Error("bgVideo must be a local file path");
const appDir = fileURLToPath(new URL("../", import.meta.url));
const outputLocation = path.resolve(values.output ?? path.join(appDir, "out/video.mp4"));
let browserExecutable = process.env.REMOTION_BROWSER_EXECUTABLE;
if (!browserExecutable) {
  try {
    await access("/usr/bin/chromium");
    browserExecutable = "/usr/bin/chromium";
  } catch {
    /* Remotion downloads Chrome if needed. */
  }
}
const frames = values.frames === undefined ? undefined : Number(values.frames);
if (frames !== undefined && (!Number.isInteger(frames) || frames < 1 || frames > 240))
  throw new Error("--frames must be an integer from 1 to 240");
const temporary = await mkdtemp(path.join(tmpdir(), "hyperframes-remotion-"));
try {
  const publicDir = path.join(temporary, "public");
  await mkdir(publicDir);
  if (background) {
    const name = `background${path.extname(background) || ".mp4"}`;
    await copyFile(path.resolve(background), path.join(publicDir, name));
    inputProps.bgVideo = name;
  }
  const serveUrl = await bundle({
    entryPoint: path.join(appDir, "src/index.tsx"),
    publicDir,
    outDir: path.join(temporary, "bundle"),
  });
  const composition = await selectComposition({
    serveUrl,
    id: "FinanceFrame",
    inputProps,
    browserExecutable,
  });
  await mkdir(path.dirname(outputLocation), { recursive: true });
  await renderMedia({
    serveUrl,
    composition,
    inputProps,
    codec: "h264",
    outputLocation,
    browserExecutable,
    concurrency: 2,
    ...(frames === undefined ? {} : { frameRange: [0, frames - 1] }),
  });
  console.log(`Rendered ${outputLocation}`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
