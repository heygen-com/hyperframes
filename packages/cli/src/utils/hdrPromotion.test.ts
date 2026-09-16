import { describe, expect, it, vi } from "vitest";
import type { VideoColorSpace } from "@hyperframes/engine";
import { resolveProjectRelativeSrc } from "@hyperframes/engine";
import { inspectHdrAutoPromotion } from "./hdrPromotion.js";

const PROJECT = { dir: "/project", name: "hdr-check", indexPath: "/project/index.html" };
const HDR: VideoColorSpace = {
  colorTransfer: "smpte2084",
  colorPrimaries: "bt2020",
  colorSpace: "bt2020nc",
};
const SDR: VideoColorSpace = {
  colorTransfer: "bt709",
  colorPrimaries: "bt709",
  colorSpace: "bt709",
};

function metadata(colorSpace: VideoColorSpace, videoCodec = "hevc") {
  return {
    durationSeconds: 1,
    videoStreamDurationSeconds: 1,
    width: 1920,
    height: 1080,
    fps: 30,
    videoCodec,
    hasAudio: false,
    isVFR: false,
    hasAlpha: false,
    colorSpace,
  };
}

function bundledMedia(videos: string[], images: string[]) {
  return {
    bundleHtml: vi.fn(async () => "<html>bundled sub-composition</html>"),
    collectMedia: vi.fn(() => ({
      videos: videos.map((src) => ({ src })),
      images: images.map((src) => ({ src })),
    })),
  };
}

describe("inspectHdrAutoPromotion", () => {
  it("reports the local HDR asset that promotes automatic output", async () => {
    const assetPath = resolveProjectRelativeSrc("assets/source-hdr.mp4", PROJECT.dir, PROJECT.dir);
    const extractMetadata = vi.fn(async () => metadata(HDR));

    await expect(
      inspectHdrAutoPromotion(
        PROJECT,
        extractMetadata,
        bundledMedia(["assets/source-hdr.mp4?token=secret#preview"], []),
      ),
    ).resolves.toEqual({
      triggeringAsset: "assets/source-hdr.mp4",
      output: { colorSpace: "BT.2020", codec: "HEVC Main10" },
    });
    expect(extractMetadata).toHaveBeenCalledOnce();
    expect(extractMetadata).toHaveBeenCalledWith(assetPath);
  });

  it("reports an active remote HDR video from the bundled render media", async () => {
    const remote = "https://media.example/remote-hdr.mp4?token=secret";
    const extractMetadata = vi.fn(async () => metadata(HDR));

    await expect(
      inspectHdrAutoPromotion(PROJECT, extractMetadata, bundledMedia([remote], [])),
    ).resolves.toEqual({
      triggeringAsset: "https://media.example/remote-hdr.mp4",
      output: { colorSpace: "BT.2020", codec: "HEVC Main10" },
    });
    expect(extractMetadata).toHaveBeenCalledWith(remote);
  });

  it("uses the first HDR video before an HDR image and still inspects images", async () => {
    const firstVideo = "https://media.example/first-hdr-video.mp4?token=secret";
    const image = "assets/fallback-hdr-image.png";
    const extractMetadata = vi.fn(async (src: string) =>
      metadata(src.replaceAll("\\", "/").endsWith("/assets/sdr.mp4") ? SDR : HDR),
    );

    await expect(
      inspectHdrAutoPromotion(
        PROJECT,
        extractMetadata,
        bundledMedia(["assets/sdr.mp4", firstVideo], [image]),
      ),
    ).resolves.toMatchObject({ triggeringAsset: "https://media.example/first-hdr-video.mp4" });
    expect(extractMetadata).toHaveBeenCalledWith(
      resolveProjectRelativeSrc("assets/sdr.mp4", PROJECT.dir, PROJECT.dir),
    );
    expect(extractMetadata).toHaveBeenCalledWith(firstVideo);
    expect(extractMetadata).toHaveBeenCalledWith(
      resolveProjectRelativeSrc("assets/fallback-hdr-image.png", PROJECT.dir, PROJECT.dir),
    );
  });

  it("reports an HDR image when no HDR video is present", async () => {
    const extractMetadata = vi.fn(async () =>
      metadata(
        { colorTransfer: "arib-std-b67", colorPrimaries: "bt2020", colorSpace: "bt2020nc" },
        "png",
      ),
    );

    await expect(
      inspectHdrAutoPromotion(PROJECT, extractMetadata, bundledMedia([], ["assets/hdr.png"])),
    ).resolves.toMatchObject({ triggeringAsset: "assets/hdr.png" });
  });
});
