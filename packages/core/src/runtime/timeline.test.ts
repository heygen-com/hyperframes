import { describe, it, expect, afterEach } from "vitest";
import { collectRuntimeTimelinePayload } from "./timeline";

describe("collectRuntimeTimelinePayload", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    delete (window as any).__timelines;
  });

  const defaultParams = { canonicalFps: 30 };

  it("returns minimal payload for empty document", () => {
    const result = collectRuntimeTimelinePayload(defaultParams);
    expect(result.source).toBe("hf-preview");
    expect(result.type).toBe("timeline");
    expect(result.clips).toEqual([]);
    expect(result.scenes).toEqual([]);
    expect(result.durationInFrames).toBeGreaterThanOrEqual(1);
    expect(result.compositionWidth).toBe(1920);
    expect(result.compositionHeight).toBe(1080);
    expect(result).toMatchObject({
      protocolVersion: 1,
      compositionContractVersion: 1,
      durationSeconds: 1,
      fps: { numerator: 30, denominator: 1 },
    });
  });

  // Regression: id-less timed elements (root index.html children carry
  // data-hf-id, not id) must get their data-hf-id as the clip id — not null —
  // so the manifest aligns with __clipTree and inline expansion can join them.
  it("ids an id-less clip by its data-hf-id", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-duration", "10");
    document.body.appendChild(root);

    const clip = document.createElement("h1");
    clip.setAttribute("data-hf-id", "hf-headline");
    clip.setAttribute("data-start", "1");
    clip.setAttribute("data-duration", "3");
    root.appendChild(clip);

    const result = collectRuntimeTimelinePayload(defaultParams);
    expect(result.clips[0].id).toBe("hf-headline");
  });

  // Regression: the authored data-track-index must round-trip verbatim, even
  // when clips of DIFFERENT kinds (video vs element) share a track. The old
  // mixed-kind renumber split them onto separate tracks, which made the
  // written track drift from the displayed one on every editor move.
  it("honors authored track indices verbatim for mixed-kind tracks", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-duration", "20");
    document.body.appendChild(root);

    const video = document.createElement("video");
    video.id = "clip-video";
    video.setAttribute("data-start", "1");
    video.setAttribute("data-duration", "3");
    video.setAttribute("data-track-index", "1");
    root.appendChild(video);

    const caption = document.createElement("div");
    caption.id = "clip-caption";
    caption.setAttribute("data-start", "8");
    caption.setAttribute("data-duration", "3");
    caption.setAttribute("data-track-index", "1");
    root.appendChild(caption);

    const other = document.createElement("div");
    other.id = "clip-other";
    other.setAttribute("data-start", "0");
    other.setAttribute("data-duration", "3");
    other.setAttribute("data-track-index", "2");
    root.appendChild(other);

    const result = collectRuntimeTimelinePayload(defaultParams);
    const trackOf = (id: string) => result.clips.find((c) => c.id === id)?.track;
    expect(trackOf("clip-video")).toBe(1);
    expect(trackOf("clip-caption")).toBe(1);
    expect(trackOf("clip-other")).toBe(2);
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
    expect(result.clips[0].track).toBe(0);
    expect(result.clips[0].kind).toBe("element");
  });

  it("parses inline z-index for timeline clips", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-duration", "10");
    document.body.appendChild(root);

    const clip = document.createElement("div");
    clip.id = "layered";
    clip.style.zIndex = "11";
    clip.setAttribute("data-start", "0");
    clip.setAttribute("data-duration", "4");
    root.appendChild(clip);

    const result = collectRuntimeTimelinePayload(defaultParams);
    expect(result.clips[0].zIndex).toBe(11);
  });

  it("uses zero z-index sentinel when a timeline clip has no inline z-index", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-duration", "10");
    document.body.appendChild(root);

    const clip = document.createElement("div");
    clip.id = "auto-layer";
    clip.setAttribute("data-start", "0");
    clip.setAttribute("data-duration", "4");
    root.appendChild(clip);

    const result = collectRuntimeTimelinePayload(defaultParams);
    expect(result.clips[0].zIndex).toBe(0);
  });

  it("partitions clips by their nearest real CSS stacking context", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-duration", "10");
    document.body.appendChild(root);

    const contextA = document.createElement("div");
    contextA.style.transform = "translateX(0px)";
    const contextB = document.createElement("div");
    contextB.style.opacity = "0.9";
    root.append(contextA, contextB);

    const addClip = (parent: Element, id: string) => {
      const clip = document.createElement("div");
      clip.id = id;
      clip.setAttribute("data-start", "0");
      clip.setAttribute("data-duration", "2");
      parent.appendChild(clip);
    };
    addClip(contextA, "a-1");
    addClip(contextA, "a-2");
    addClip(contextB, "b-1");

    const result = collectRuntimeTimelinePayload(defaultParams);
    const contextOf = (id: string) =>
      result.clips.find((clip) => clip.id === id)?.stackingContextId;

    expect(contextOf("a-1")).toBe(contextOf("a-2"));
    expect(contextOf("a-1")).not.toBe(contextOf("b-1"));
    expect(contextOf("a-1")).not.toBe("css:root");
  });

  it("keeps clips without a stacking-context ancestor in the shared root scope", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-duration", "10");
    document.body.appendChild(root);

    const plainWrapper = document.createElement("div");
    root.appendChild(plainWrapper);
    for (const [parent, id] of [
      [root, "root-layer"],
      [plainWrapper, "wrapped-layer"],
    ] as const) {
      const clip = document.createElement("div");
      clip.id = id;
      clip.setAttribute("data-start", "0");
      clip.setAttribute("data-duration", "2");
      parent.appendChild(clip);
    }

    const result = collectRuntimeTimelinePayload(defaultParams);
    const contextOf = (id: string) =>
      result.clips.find((clip) => clip.id === id)?.stackingContextId;
    expect(contextOf("root-layer")).toBe("css:root");
    expect(contextOf("wrapped-layer")).toBe("css:root");
  });

  it("scopes an element's own z-index in its parent context, not a context it creates", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-duration", "10");
    document.body.appendChild(root);

    for (const id of ["layer-a", "layer-b"]) {
      const clip = document.createElement("div");
      clip.id = id;
      clip.style.cssText = "position: relative; z-index: 1";
      clip.setAttribute("data-start", "0");
      clip.setAttribute("data-duration", "2");
      root.appendChild(clip);
    }

    const result = collectRuntimeTimelinePayload(defaultParams);
    const contexts = result.clips.map((clip) => clip.stackingContextId);
    expect(contexts).toEqual(["css:root", "css:root"]);
  });

  it.each([
    ["positioned z-index", "", "position: relative; z-index: 1"],
    ["fixed position", "", "position: fixed"],
    ["sticky position", "", "position: sticky"],
    ["transform", "", "transform: translateX(0px)"],
    ["opacity", "", "opacity: 0.9"],
    ["isolation", "", "isolation: isolate"],
    ["filter", "", "filter: blur(1px)"],
    ["perspective", "", "perspective: 100px"],
    ["mix blend mode", "", "mix-blend-mode: multiply"],
    ["contain", "", "contain: paint"],
    ["container type", "", "container-type: inline-size"],
    ["will change", "", "will-change: transform"],
    ["z-indexed flex item", "display: flex", "z-index: 1"],
    ["z-indexed grid item", "display: grid", "z-index: 1"],
  ])("recognizes a %s stacking-context ancestor", (_label, rootCssText, contextCssText) => {
    const root = document.createElement("div");
    root.style.cssText = rootCssText;
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-duration", "10");
    document.body.appendChild(root);

    const context = document.createElement("div");
    context.style.cssText = contextCssText;
    root.appendChild(context);
    const clip = document.createElement("div");
    clip.id = "nested-layer";
    clip.setAttribute("data-start", "0");
    clip.setAttribute("data-duration", "2");
    context.appendChild(clip);

    const result = collectRuntimeTimelinePayload(defaultParams);
    expect(result.clips.find((item) => item.id === clip.id)?.stackingContextId).not.toBe(
      "css:root",
    );
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
    comp.setAttribute("data-playback-start", "1.5");
    comp.setAttribute("data-playback-rate", "2");
    root.appendChild(comp);

    const result = collectRuntimeTimelinePayload(defaultParams);
    expect(result.clips[0].kind).toBe("composition");
    expect(result.clips[0].playbackStart).toBe(1.5);
    expect(result.clips[0].playbackRate).toBe(2);
  });

  it("defaults a legacy composition host playback window to zero at unit rate", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-duration", "20");
    document.body.appendChild(root);

    const comp = document.createElement("div");
    comp.id = "scene-legacy";
    comp.setAttribute("data-composition-id", "scene-legacy");
    comp.setAttribute("data-start", "0");
    comp.setAttribute("data-duration", "10");
    root.appendChild(comp);

    const clip = collectRuntimeTimelinePayload(defaultParams).clips[0];
    expect(clip.playbackStart).toBe(0);
    expect(clip.playbackRate).toBe(1);
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

  it("ceil durationInFrames to match render frame count", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-duration", "1.01");
    document.body.appendChild(root);

    const clip = document.createElement("div");
    clip.setAttribute("data-start", "0");
    clip.setAttribute("data-duration", "1.01");
    root.appendChild(clip);

    const result = collectRuntimeTimelinePayload(defaultParams);
    expect(result.durationInFrames).toBe(31); // ceil(1.01s * 30fps), same as render.
  });

  it("preserves the authored root duration when clips end earlier", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-duration", "7");
    document.body.appendChild(root);

    const clip = document.createElement("div");
    clip.id = "trimmed";
    clip.setAttribute("data-start", "0");
    clip.setAttribute("data-duration", "5");
    root.appendChild(clip);

    const result = collectRuntimeTimelinePayload(defaultParams);
    expect(result.durationInFrames).toBe(210); // 7s * 30fps
  });

  it("respects long composition durations without capping", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-duration", "5000");
    document.body.appendChild(root);

    const clip = document.createElement("div");
    clip.setAttribute("data-start", "0");
    clip.setAttribute("data-duration", "5000");
    root.appendChild(clip);

    const result = collectRuntimeTimelinePayload({ canonicalFps: 30 });
    expect(result.durationInFrames).toBe(5000 * 30);
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

  it("uses a friendly label and null id for anonymous clips", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-duration", "10");
    document.body.appendChild(root);

    const clip = document.createElement("div");
    clip.className = "clip hero-card";
    clip.setAttribute("data-start", "0");
    clip.setAttribute("data-duration", "5");
    root.appendChild(clip);

    const result = collectRuntimeTimelinePayload(defaultParams);
    expect(result.clips[0].id).toBeNull();
    expect(result.clips[0].label).toBe("Hero Card");
  });

  it("falls back to a readable ordinal label instead of a node index id", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-duration", "10");
    document.body.appendChild(root);

    const clip = document.createElement("div");
    clip.setAttribute("data-start", "0");
    clip.setAttribute("data-duration", "5");
    root.appendChild(clip);

    const result = collectRuntimeTimelinePayload(defaultParams);
    expect(result.clips[0].id).toBeNull();
    expect(result.clips[0].label).toBe("Element 1");
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
      main: {
        duration: () => 15,
        time: () => 0,
        play: () => {},
        pause: () => {},
        seek: () => {},
        add: () => {},
        paused: () => {},
        set: () => {},
      },
      "scene-1": {
        duration: () => 8,
        time: () => 0,
        play: () => {},
        pause: () => {},
        seek: () => {},
        add: () => {},
        paused: () => {},
        set: () => {},
      },
    };

    const result = collectRuntimeTimelinePayload(defaultParams);
    // scene-1 should get duration 8 from timeline registry
    const sceneClip = result.clips.find((c) => c.compositionId === "scene-1");
    expect(sceneClip).toBeDefined();
    expect(sceneClip?.duration).toBe(8);
  });

  it("keeps composition clips sequential when authored durations were preserved privately", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    document.body.appendChild(root);

    const slide1 = document.createElement("div");
    slide1.id = "slide-1";
    slide1.setAttribute("data-composition-id", "slide-1");
    slide1.setAttribute("data-start", "0");
    slide1.setAttribute("data-hf-authored-duration", "14");
    root.appendChild(slide1);

    const slide2 = document.createElement("div");
    slide2.id = "slide-2";
    slide2.setAttribute("data-composition-id", "slide-2");
    slide2.setAttribute("data-start", "slide-1");
    slide2.setAttribute("data-hf-authored-duration", "12");
    root.appendChild(slide2);

    const slide3 = document.createElement("div");
    slide3.id = "slide-3";
    slide3.setAttribute("data-composition-id", "slide-3");
    slide3.setAttribute("data-start", "slide-2");
    slide3.setAttribute("data-hf-authored-duration", "16");
    root.appendChild(slide3);

    const result = collectRuntimeTimelinePayload(defaultParams);
    const starts = Object.fromEntries(result.clips.map((clip) => [clip.id, clip.start]));
    expect(starts["slide-1"]).toBe(0);
    expect(starts["slide-2"]).toBe(14);
    expect(starts["slide-3"]).toBe(26);
    expect(result.durationInFrames).toBe(42 * 30);
  });

  it("discovers GSAP-animated scene elements via timeline introspection", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-duration", "12");
    root.setAttribute("data-width", "1920");
    root.setAttribute("data-height", "1080");
    document.body.appendChild(root);

    const scene1 = document.createElement("div");
    scene1.id = "scene1";
    root.appendChild(scene1);

    const scene2 = document.createElement("div");
    scene2.id = "scene2";
    root.appendChild(scene2);

    // Mock GSAP timeline with getChildren that returns tweens targeting scene children
    const mockTweens = [
      {
        targets: () => [scene1],
        startTime: () => 0,
        duration: () => 3,
        parent: null,
      },
      {
        targets: () => [scene2],
        startTime: () => 3,
        duration: () => 3,
        parent: null,
      },
    ];

    (window as any).__timelines = {
      main: {
        duration: () => 12,
        time: () => 0,
        play: () => {},
        pause: () => {},
        seek: () => {},
        add: () => {},
        paused: () => {},
        set: () => {},
        getChildren: () => mockTweens,
      },
    };

    const result = collectRuntimeTimelinePayload(defaultParams);
    const s1 = result.clips.find((c) => c.id === "scene1");
    const s2 = result.clips.find((c) => c.id === "scene2");
    expect(s1).toBeDefined();
    expect(s1?.start).toBe(0);
    expect(s1?.duration).toBe(3);
    expect(s2).toBeDefined();
    expect(s2?.start).toBe(3);
    expect(s2?.duration).toBe(3);
  });

  it("does not offset GSAP scene clips by the master timeline start time", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-duration", "20");
    document.body.appendChild(root);

    const scene = document.createElement("div");
    scene.id = "scene-1";
    root.appendChild(scene);

    const masterTimeline = {
      duration: () => 20,
      time: () => 1.25,
      play: () => {},
      pause: () => {},
      seek: () => {},
      add: () => {},
      paused: () => {},
      set: () => {},
      startTime: () => 1.25,
      getChildren: () => [
        {
          targets: () => [scene],
          startTime: () => 4,
          duration: () => 3,
          parent: masterTimeline,
        },
      ],
    };

    (window as any).__timelines = {
      main: masterTimeline,
    };

    const result = collectRuntimeTimelinePayload(defaultParams);
    const clip = result.clips.find((c) => c.id === "scene-1");
    expect(clip).toBeDefined();
    expect(clip?.start).toBe(4);
    expect(clip?.duration).toBe(3);
  });

  it("keeps nested GSAP timeline offsets below the master timeline", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-duration", "20");
    document.body.appendChild(root);

    const scene = document.createElement("div");
    scene.id = "scene-1";
    root.appendChild(scene);

    const masterTimeline = {
      duration: () => 20,
      time: () => 1.25,
      play: () => {},
      pause: () => {},
      seek: () => {},
      add: () => {},
      paused: () => {},
      set: () => {},
      startTime: () => 1.25,
      getChildren: () => [] as unknown[],
    };
    const nestedTimeline = {
      startTime: () => 6,
      parent: masterTimeline,
    };
    const nestedTween = {
      targets: () => [scene],
      startTime: () => 2,
      duration: () => 3,
      parent: nestedTimeline,
    };
    masterTimeline.getChildren = () => [nestedTween];

    (window as any).__timelines = {
      main: masterTimeline,
    };

    const result = collectRuntimeTimelinePayload(defaultParams);
    const clip = result.clips.find((c) => c.id === "scene-1");
    expect(clip).toBeDefined();
    expect(clip?.start).toBe(8);
    expect(clip?.duration).toBe(3);
  });

  it("bubbles child tween ranges up to scene-level ancestors", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-duration", "10");
    document.body.appendChild(root);

    const scene = document.createElement("div");
    scene.id = "my-scene";
    root.appendChild(scene);

    const child = document.createElement("div");
    child.id = "child-elem";
    scene.appendChild(child);

    const mockTweens = [
      {
        targets: () => [child],
        startTime: () => 1,
        duration: () => 2,
        parent: null,
      },
      {
        targets: () => [scene],
        startTime: () => 4,
        duration: () => 0.5,
        parent: null,
      },
    ];

    (window as any).__timelines = {
      main: {
        duration: () => 10,
        time: () => 0,
        play: () => {},
        pause: () => {},
        seek: () => {},
        add: () => {},
        paused: () => {},
        set: () => {},
        getChildren: () => mockTweens,
      },
    };

    const result = collectRuntimeTimelinePayload(defaultParams);
    const clip = result.clips.find((c) => c.id === "my-scene");
    expect(clip).toBeDefined();
    // Range should span from child tween (1) to scene tween end (4.5)
    expect(clip?.start).toBe(1);
    expect(clip?.duration).toBeCloseTo(3.5);
  });

  it("includes persistent overlays as full-duration clips only when opted in", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-duration", "12");
    document.body.appendChild(root);

    const overlay = document.createElement("div");
    overlay.id = "grid-overlay";
    overlay.setAttribute("data-timeline-role", "overlay");
    root.appendChild(overlay);

    (window as any).__timelines = {
      main: {
        duration: () => 12,
        time: () => 0,
        play: () => {},
        pause: () => {},
        seek: () => {},
        add: () => {},
        paused: () => {},
        set: () => {},
        getChildren: () => [],
      },
    };

    const result = collectRuntimeTimelinePayload(defaultParams);
    const clip = result.clips.find((c) => c.id === "grid-overlay");
    expect(clip).toBeDefined();
    expect(clip?.start).toBe(0);
    expect(clip?.duration).toBe(12);
  });

  it("does not include persistent overlays by default", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-duration", "12");
    document.body.appendChild(root);

    const overlay = document.createElement("div");
    overlay.id = "grid-overlay";
    root.appendChild(overlay);

    (window as any).__timelines = {
      main: {
        duration: () => 12,
        time: () => 0,
        play: () => {},
        pause: () => {},
        seek: () => {},
        add: () => {},
        paused: () => {},
        set: () => {},
        getChildren: () => [],
      },
    };

    const result = collectRuntimeTimelinePayload(defaultParams);
    expect(result.clips.find((c) => c.id === "grid-overlay")).toBeUndefined();
  });

  it("does not include script/style elements as persistent overlays", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-duration", "10");
    document.body.appendChild(root);

    const script = document.createElement("script");
    script.id = "my-script";
    root.appendChild(script);

    (window as any).__timelines = {
      main: {
        duration: () => 10,
        time: () => 0,
        play: () => {},
        pause: () => {},
        seek: () => {},
        add: () => {},
        paused: () => {},
        set: () => {},
        getChildren: () => [],
      },
    };

    const result = collectRuntimeTimelinePayload(defaultParams);
    expect(result.clips.find((c) => c.id === "my-script")).toBeUndefined();
  });
});
