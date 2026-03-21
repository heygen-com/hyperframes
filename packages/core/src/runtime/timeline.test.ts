import { describe, it, expect, afterEach } from "vitest";
import { collectRuntimeTimelinePayload } from "./timeline";

describe("collectRuntimeTimelinePayload", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    delete (window as any).__timelines;
  });

  const defaultParams = { canonicalFps: 30, maxTimelineDurationSeconds: 1800 };

  it("returns minimal payload for empty document", () => {
    const result = collectRuntimeTimelinePayload(defaultParams);
    expect(result.source).toBe("hf-preview");
    expect(result.type).toBe("timeline");
    expect(result.clips).toEqual([]);
    expect(result.scenes).toEqual([]);
    expect(result.durationInFrames).toBeGreaterThanOrEqual(1);
    expect(result.compositionWidth).toBe(1920);
    expect(result.compositionHeight).toBe(1080);
  });

  it("collects clips from elements with data-start and data-duration", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-duration", "10");
    document.body.appendChild(root);

    const clip = document.createElement("div");
    clip.id = "text-1";
    clip.setAttribute("data-start", "1");
    clip.setAttribute("data-duration", "3");
    clip.setAttribute("data-track-index", "0");
    root.appendChild(clip);

    const result = collectRuntimeTimelinePayload(defaultParams);
    expect(result.clips).toHaveLength(1);
    expect(result.clips[0].id).toBe("text-1");
    expect(result.clips[0].start).toBe(1);
    expect(result.clips[0].duration).toBe(3);
    expect(result.clips[0].kind).toBe("element");
  });

  it("identifies video clips by tag", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-duration", "10");
    document.body.appendChild(root);

    const video = document.createElement("video");
    video.id = "v1";
    video.setAttribute("data-start", "0");
    video.setAttribute("data-duration", "5");
    root.appendChild(video);

    const result = collectRuntimeTimelinePayload(defaultParams);
    expect(result.clips[0].kind).toBe("video");
  });

  it("identifies audio clips by tag", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-duration", "10");
    document.body.appendChild(root);

    const audio = document.createElement("audio");
    audio.id = "a1";
    audio.setAttribute("data-start", "0");
    audio.setAttribute("data-duration", "5");
    root.appendChild(audio);

    const result = collectRuntimeTimelinePayload(defaultParams);
    expect(result.clips[0].kind).toBe("audio");
  });

  it("identifies image clips by tag", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-duration", "10");
    document.body.appendChild(root);

    const img = document.createElement("img");
    img.id = "img1";
    img.setAttribute("data-start", "0");
    img.setAttribute("data-duration", "5");
    root.appendChild(img);

    const result = collectRuntimeTimelinePayload(defaultParams);
    expect(result.clips[0].kind).toBe("image");
  });

  it("identifies composition clips", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-duration", "20");
    document.body.appendChild(root);

    const comp = document.createElement("div");
    comp.id = "scene-1";
    comp.setAttribute("data-composition-id", "scene-1");
    comp.setAttribute("data-start", "0");
    comp.setAttribute("data-duration", "10");
    root.appendChild(comp);

    const result = collectRuntimeTimelinePayload(defaultParams);
    expect(result.clips[0].kind).toBe("composition");
  });

  it("collects scenes from composition nodes", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-duration", "20");
    document.body.appendChild(root);

    const scene = document.createElement("div");
    scene.setAttribute("data-composition-id", "scene-intro");
    scene.setAttribute("data-start", "0");
    scene.setAttribute("data-duration", "10");
    scene.setAttribute("data-label", "Intro");
    root.appendChild(scene);

    const result = collectRuntimeTimelinePayload(defaultParams);
    expect(result.scenes).toHaveLength(1);
    expect(result.scenes[0].id).toBe("scene-intro");
    expect(result.scenes[0].label).toBe("Intro");
    expect(result.scenes[0].start).toBe(0);
    expect(result.scenes[0].duration).toBe(10);
  });

  it("skips caption and ambient compositions from scenes", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-duration", "20");
    document.body.appendChild(root);

    const caption = document.createElement("div");
    caption.setAttribute("data-composition-id", "caption-1");
    caption.setAttribute("data-start", "0");
    caption.setAttribute("data-duration", "5");
    root.appendChild(caption);

    const ambient = document.createElement("div");
    ambient.setAttribute("data-composition-id", "ambient-bg");
    ambient.setAttribute("data-start", "0");
    ambient.setAttribute("data-duration", "5");
    root.appendChild(ambient);

    const result = collectRuntimeTimelinePayload(defaultParams);
    expect(result.scenes).toHaveLength(0);
  });

  it("reads composition dimensions from root", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-width", "3840");
    root.setAttribute("data-height", "2160");
    root.setAttribute("data-duration", "5");
    document.body.appendChild(root);

    const result = collectRuntimeTimelinePayload(defaultParams);
    expect(result.compositionWidth).toBe(3840);
    expect(result.compositionHeight).toBe(2160);
  });

  it("defaults composition dimensions to 1920x1080", () => {
    const result = collectRuntimeTimelinePayload(defaultParams);
    expect(result.compositionWidth).toBe(1920);
    expect(result.compositionHeight).toBe(1080);
  });

  it("computes durationInFrames from max clip end", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-duration", "10");
    document.body.appendChild(root);

    const clip = document.createElement("div");
    clip.setAttribute("data-start", "0");
    clip.setAttribute("data-duration", "10");
    root.appendChild(clip);

    const result = collectRuntimeTimelinePayload(defaultParams);
    expect(result.durationInFrames).toBe(300); // 10s * 30fps
  });

  it("clamps duration to maxTimelineDurationSeconds", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-duration", "5000");
    document.body.appendChild(root);

    const clip = document.createElement("div");
    clip.setAttribute("data-start", "0");
    clip.setAttribute("data-duration", "5000");
    root.appendChild(clip);

    const result = collectRuntimeTimelinePayload({ canonicalFps: 30, maxTimelineDurationSeconds: 60 });
    expect(result.durationInFrames).toBeLessThanOrEqual(60 * 30);
  });

  it("skips script/style/meta nodes", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-duration", "10");
    document.body.appendChild(root);

    const script = document.createElement("script");
    script.setAttribute("data-start", "0");
    script.setAttribute("data-duration", "5");
    root.appendChild(script);

    const style = document.createElement("style");
    style.setAttribute("data-start", "0");
    style.setAttribute("data-duration", "5");
    root.appendChild(style);

    const result = collectRuntimeTimelinePayload(defaultParams);
    expect(result.clips).toHaveLength(0);
  });

  it("resolves asset URLs from src attribute", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-duration", "10");
    document.body.appendChild(root);

    const img = document.createElement("img");
    img.id = "hero";
    img.setAttribute("src", "https://example.com/hero.jpg");
    img.setAttribute("data-start", "0");
    img.setAttribute("data-duration", "5");
    root.appendChild(img);

    const result = collectRuntimeTimelinePayload(defaultParams);
    expect(result.clips[0].assetUrl).toBe("https://example.com/hero.jpg");
  });

  it("uses label from data-timeline-label", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-duration", "10");
    document.body.appendChild(root);

    const clip = document.createElement("div");
    clip.id = "clip-1";
    clip.setAttribute("data-start", "0");
    clip.setAttribute("data-duration", "5");
    clip.setAttribute("data-timeline-label", "Hero Shot");
    root.appendChild(clip);

    const result = collectRuntimeTimelinePayload(defaultParams);
    expect(result.clips[0].label).toBe("Hero Shot");
  });

  it("handles timeline registry for composition duration", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    document.body.appendChild(root);

    const comp = document.createElement("div");
    comp.setAttribute("data-composition-id", "scene-1");
    comp.setAttribute("data-start", "0");
    root.appendChild(comp);

    (window as any).__timelines = {
      "main": { duration: () => 15, time: () => 0, play: () => {}, pause: () => {}, seek: () => {}, add: () => {}, paused: () => {}, set: () => {} },
      "scene-1": { duration: () => 8, time: () => 0, play: () => {}, pause: () => {}, seek: () => {}, add: () => {}, paused: () => {}, set: () => {} },
    };

    const result = collectRuntimeTimelinePayload(defaultParams);
    // scene-1 should get duration 8 from timeline registry
    const sceneClip = result.clips.find(c => c.compositionId === "scene-1");
    expect(sceneClip).toBeDefined();
    expect(sceneClip?.duration).toBe(8);
  });
});
