import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { findFFmpeg } from "../browser/ffmpeg.js";
import { probeVideo } from "../measure/media.js";

vi.mock("../cloud/auth.js", () => ({
  resolveCloudAuthHeaders: async () => ({ "x-api-key": "k" }),
  refreshIfNeeded: async <T>(credential: T) => credential,
  resolveCloudBaseUrl: () => "https://api.test",
}));

vi.stubEnv("HEYGEN_API_KEY", "k");

const { checkRequest, foldShort, generate, parseMask, structureRatio, urlOf } = await import("./generate.js");
const { checkLimit, creditsOf, priceOf } = await import("./pricing.js");
const ffmpeg = findFFmpeg();
const project = mkdtempSync(join(tmpdir(), "hf-generate-test-"));
writeFileSync(join(project, "index.html"), "<html></html>");
afterAll(() => rmSync(project, { recursive: true, force: true }));
afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

/** A 30 fps clip of these lavfi sources one after another: each new source is a cut. */
function shots(name: string, sources: string[], size = "180x320"): string {
  const path = join(project, name);
  execFileSync(ffmpeg!, [
    ...["-v", "error", "-y"],
    ...sources.flatMap((src) => ["-f", "lavfi", "-i", `${src}:s=${size}:r=30`]),
    ...["-filter_complex", `concat=n=${sources.length}:v=1`, "-pix_fmt", "yuv420p", path],
  ]);
  return path;
}

describe("generate", () => {
  it("finds the file URL wherever the route keeps it", () => {
    expect(
      urlOf({ id: "a", status: "completed", images: [{ url: "https://x/i.png" }] }, [
        "images.0.url",
      ]),
    ).toBe("https://x/i.png");
    expect(
      urlOf({ id: "a", status: "completed", video_url: "ftp://no" }, ["video_url"]),
    ).toBeNull();
  });

  it.skipIf(!ffmpeg)("edits a picture from a reference, downloads it and records it", async () => {
    const ref = join(project, "ref.png");
    execFileSync(ffmpeg!, [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=red:s=64x36",
      "-frames:v",
      "1",
      ref,
    ]);
    const sent: { url: string; body?: Record<string, unknown> }[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      sent.push({ url, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
      if (url === "https://files.test/plate.png") return new Response(new Uint8Array([1, 2, 3]));
      return json({
        data: {
          id: "img1",
          status: "completed",
          images: [{ url: "https://files.test/plate.png" }],
        },
      });
    });
    const r = await generate({
      type: "image",
      out: join(project, "assets/plate.png"),
      prompt: "empty room",
      references: [ref],
    });
    expect(sent[0]!.body).toMatchObject({
      model: "nano-banana-2",
      prompt: "empty room",
      reference_images: [{ type: "base64", media_type: "image/jpeg" }],
    });
    expect(readFileSync(r.out)).toEqual(Buffer.from([1, 2, 3]));
    const ledger = readFileSync(join(project, ".media/manifest.jsonl"), "utf8");
    expect(ledger).toContain('"source":"generated"');
    expect(ledger).toContain('"references":["ref.png"]');
  });

  it.skipIf(!ffmpeg)("re-shoots a person speaking a stretch of the original voice", async () => {
    const [face, voice] = [join(project, "face.png"), join(project, "voice.m4a")];
    execFileSync(ffmpeg!, [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=gray:s=36x64",
      "-frames:v",
      "1",
      face,
    ]);
    execFileSync(ffmpeg!, ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=d=1", voice]);
    const guide = join(project, "guide.mp4");
    execFileSync(ffmpeg!, [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=d=1:s=180x320",
      guide,
    ]);
    const sent: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (init?.body) sent.push(JSON.parse(String(init.body)));
      if (url === "https://files.test/s.mp4") return new Response(new Uint8Array([7]));
      return json({
        data: { id: "v2", status: "completed", video_url: "https://files.test/s.mp4" },
      });
    });
    await generate({
      type: "video",
      out: join(project, "assets/presenter.mp4"),
      prompt: "talks to camera",
      references: [face],
      audio: voice,
      motion: guide,
      seconds: 8,
      aspect: "9:16",
    });
    expect(sent[0]).toMatchObject({
      mode: "reference_to_video",
      duration: 8,
      aspect_ratio: "9:16",
      reference_images: [{ media_type: "image/jpeg" }],
      reference_audio: [{ media_type: "audio/mpeg" }],
      reference_videos: [{ media_type: "video/mp4" }],
    });
    expect(readFileSync(join(project, ".media/manifest.jsonl"), "utf8")).toContain(
      '"audio":"voice.m4a"',
    );
    await expect(
      generate({ type: "video", out: "x.mp4", prompt: "p", audio: voice, firstFrame: face }),
    ).rejects.toThrow(/--first-frame cannot be used/);
  });

  /** A static sine texture (smooth fills cannot copy it), with a white bar sliding through x 30..150 when `bar`. */
  function textured(name: string, size: string, bar: boolean): string {
    const path = join(project, name);
    const slide = bar ? ",drawbox=x='30+t*40':y=100:w=20:h=30:color=white:t=fill" : "";
    execFileSync(ffmpeg!, [
      ...["-v", "error", "-y", "-f", "lavfi", "-i", `color=c=gray:s=${size}:r=30:d=3`],
      ...[
        "-vf",
        `geq=lum='128+100*sin(X/3)*sin(Y/3)':cb=128:cr=128${slide}`,
        "-pix_fmt",
        "yuv420p",
        path,
      ],
    ]);
    return path;
  }

  const answers = (file: string) => {
    const sent: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (init?.body) sent.push(JSON.parse(String(init.body)));
      if (url === "https://files.test/r.mp4") return new Response(readFileSync(file));
      return json({
        data: { id: "r1", status: "completed", video_url: "https://files.test/r.mp4" },
      });
    });
    return sent;
  };

  it.skipIf(!ffmpeg)(
    "fills a masked box with the picture behind moving text, not a smear",
    async () => {
      const guide = textured("slide.mp4", "180x320", true);
      const sent = answers(guide);
      await generate({
        type: "video",
        out: join(project, "assets/slide-out.mp4"),
        prompt: "p",
        motion: guide,
        masks: [parseMask("30,90,120,50")],
      });
      const [video] = sent[0]!.reference_videos as { data: string }[];
      const sentClip = join(project, "slide-sent.mp4");
      writeFileSync(sentClip, Buffer.from(video!.data, "base64"));
      const box = (f: string) =>
        execFileSync(ffmpeg!, [
          ...["-v", "error", "-ss", "1.5", "-i", f, "-frames:v", "1"],
          ...["-vf", "crop=120:50:30:90,format=gray", "-f", "rawvideo", "-"],
        ]);
      const [got, clean] = [box(sentClip), box(textured("slide-clean.mp4", "180x320", false))];
      const diff = got.reduce((a, v, i) => a + Math.abs(v - clean[i]!), 0) / got.length;
      expect(diff).toBeLessThan(12);
    },
  );

  it("reads a box with more edges than its surroundings as structure", () => {
    const flat = new Uint8Array(100 * 100).fill(100);
    expect(structureRatio(flat, 100, [40, 40, 20, 20])).toEqual({ inside: 0, ring: 0 });
    for (let y = 40; y < 60; y++)
      for (let x = 40; x < 60; x++) flat[y * 100 + x] = (x + y) % 2 ? 255 : 0;
    const { inside, ring } = structureRatio(flat, 100, [40, 40, 20, 20]);
    expect(inside).toBeGreaterThan(100);
    expect(inside).toBeGreaterThan(10 * ring);
  });

  it.skipIf(!ffmpeg)(
    "says so when the result still shows structure inside a masked box",
    async () => {
      const guide = textured("flatguide.mp4", "180x320", false);
      const busy = join(project, "busy.mp4");
      execFileSync(ffmpeg!, [
        ...["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=gray:s=180x320:r=30:d=1"],
        ...[
          "-vf",
          "geq=lum='if(between(X,30,150)*between(Y,90,140),128+120*sin(X*2)*sin(Y*2),128)':cb=128:cr=128",
        ],
        ...["-pix_fmt", "yuv420p", busy],
      ]);
      answers(busy);
      const flatMask = parseMask("30,90,120,50");
      const r = await generate({
        type: "video",
        out: join(project, "assets/busy-out.mp4"),
        prompt: "p",
        motion: guide,
        masks: [flatMask],
        aspect: "9:16",
      });
      expect(r.notes?.join(" ")).toContain("mask 30,90,120,50 still shows structure");
    },
  );

  it.skipIf(!ffmpeg)(
    "crops a 1344x768 answer to the requested 16:9, never stretches it",
    async () => {
      answers(textured("wide.mp4", "1344x768", false));
      const r = await generate({
        type: "video",
        out: join(project, "assets/wide-out.mp4"),
        prompt: "p",
      });
      const { width, height } = probeVideo(r.out);
      expect([width, height]).toEqual([1344, 756]);
      expect(r.notes?.[0]).toBe(
        "HeyGen returned 1344x768 for 16:9; cropped to 1344x756 (centre), not stretched",
      );
    },
  );

  it.skipIf(!ffmpeg)("blanks the motion clip's masked regions before sending it", async () => {
    // A guide with white letters at 40,100 over a moving picture; the mask covers them for its first 0.5 s.
    const guide = join(project, "titled.mp4");
    execFileSync(ffmpeg!, [
      ...["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=d=1:s=180x320", "-vf"],
      "drawbox=x=40:y=100:w=100:h=10:color=white:t=fill,drawbox=x=40:y=120:w=100:h=10:color=white:t=fill",
      guide,
    ]);
    const face = join(project, "face2.png");
    execFileSync(ffmpeg!, [
      ...["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=gray:s=36x64", "-frames:v", "1"],
      face,
    ]);
    const sent: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (init?.body) sent.push(JSON.parse(String(init.body)));
      if (url === "https://files.test/m.mp4") return new Response(new Uint8Array([7]));
      return json({
        data: { id: "v3", status: "completed", video_url: "https://files.test/m.mp4" },
      });
    });
    await generate({
      type: "video",
      out: join(project, "assets/masked.mp4"),
      prompt: "walks",
      references: [face],
      motion: guide,
      masks: [parseMask("30,90,120,50,0-0.5")],
    });
    const [video] = sent[0]!.reference_videos as { data: string }[];
    const sentClip = join(project, "sent.mp4");
    writeFileSync(sentClip, Buffer.from(video!.data, "base64"));
    // The letters are two white rows of bars: the largest step between neighbouring rows' brightness is their edge.
    // Filled from around, no such step is left; after 0.5 s they are back.
    const edge = (t: number) => {
      const px = execFileSync(ffmpeg!, [
        ...["-v", "error", "-ss", String(t), "-i", sentClip, "-frames:v", "1"],
        ...["-vf", "crop=100:40:40:95,format=gray", "-f", "rawvideo", "-"],
      ]);
      const rows = Array.from({ length: 40 }, (_, y) => px.subarray(y * 100, y * 100 + 100));
      const mean = rows.map((r) => r.reduce((a, v) => a + v, 0) / r.length);
      return Math.max(...mean.slice(1).map((m, y) => Math.abs(m - mean[y]!)));
    };
    expect(edge(0.2)).toBeLessThan(30);
    expect(edge(0.8)).toBeGreaterThan(60);
    expect(readFileSync(join(project, ".media/manifest.jsonl"), "utf8")).toContain(
      '"motion_masks":[[30,90,120,50,0,0.5]]',
    );
    expect(() => parseMask("30,90,120")).toThrow(/x,y,w,h/);
    const { repeated } = await import("../commands/media-use/generate.js");
    expect(
      repeated(["--mask", "1,1,2,2", "--out", "a.mp4", "--mask=3,3,4,4,0-1"], "--mask"),
    ).toEqual(["1,1,2,2", "3,3,4,4,0-1"]);
    await expect(
      generate({ type: "video", out: "x.mp4", prompt: "p", masks: [parseMask("1,1,2,2")] }),
    ).rejects.toThrow(/--mask blanks regions of the --motion clip/);
  });

  it.skipIf(!ffmpeg)("refuses a guide with a cut inside before sending anything", async () => {
    const guide = shots("two-shots.mp4", ["color=c=red:d=1", "testsrc2=d=1"]);
    const face = join(project, "face3.png");
    execFileSync(ffmpeg!, [
      ...["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=gray:s=36x64", "-frames:v", "1"],
      face,
    ]);
    const fetched = vi.fn();
    vi.stubGlobal("fetch", fetched);
    const request = {
      type: "video" as const,
      out: join(project, "assets/refused.mp4"),
      prompt: "talks",
      references: [face],
      motion: guide,
    };
    await expect(generate(request)).rejects.toMatchObject({
      message: `--motion ${guide} has a cut at 1.00 s`,
      fix: "guide has a cut at 1.00 s: generate 0–1.00 s and 1.00–2.00 s as two shots, each with its own --motion clip, or pass --allow-cuts for a guide you have checked",
    });
    expect(fetched).not.toHaveBeenCalled();
    expect(existsSync(request.out)).toBe(false);
  });

  it.skipIf(!ffmpeg)("reports where HeyGen cut inside the returned shot", async () => {
    // The guide's last frame is another picture: a cut within a frame of the end is no second shot, so it is sent.
    const guide = shots("stray-frame.mp4", ["testsrc2=d=1", "color=c=blue:d=0.02"]);
    const made = shots("heygen-cut.mp4", ["testsrc2=d=1", "color=c=red:d=1"]);
    const clean = shots("heygen-clean.mp4", ["testsrc2=d=2"]);
    const face = join(project, "face4.png");
    execFileSync(ffmpeg!, [
      ...["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=gray:s=36x64", "-frames:v", "1"],
      face,
    ]);
    let file = made;
    const sent: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (init?.body) sent.push(JSON.parse(String(init.body)));
      if (url === "https://files.test/c.mp4") return new Response(readFileSync(file));
      return json({
        data: { id: `c${sent.length}`, status: "completed", video_url: "https://files.test/c.mp4" },
      });
    });
    const request = { type: "video" as const, prompt: "walks", references: [face], motion: guide };
    const cut = await generate({ ...request, out: join(project, "assets/cut.mp4") });
    expect(sent).toHaveLength(1);
    expect(cut.cuts_inside).toEqual([1]);
    expect(readFileSync(join(project, ".media/manifest.jsonl"), "utf8")).toContain(
      '"cuts_inside":[1]',
    );
    file = clean;
    const one = await generate({ ...request, out: join(project, "assets/one.mp4"), seconds: 6 });
    expect(one.cuts_inside).toEqual([]);
  });

  it.skipIf(!ffmpeg)(
    "asks for 768p whatever the source's size, as 1080p bills about twice",
    async () => {
      const guide = shots("tall.mp4", ["testsrc2=d=1"], "1080x1920");
      const sent: Record<string, unknown>[] = [];
      vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
        if (init?.body) sent.push(JSON.parse(String(init.body)));
        if (url === "https://files.test/t.mp4") return new Response(new Uint8Array([7]));
        return json({
          data: { id: "t1", status: "completed", video_url: "https://files.test/t.mp4" },
        });
      });
      const r = await generate({
        type: "video",
        out: join(project, "assets/tall.mp4"),
        prompt: "walks",
        motion: guide,
        aspect: "9:16",
      });
      expect(sent[0]).toMatchObject({ resolution: "768p", aspect_ratio: "9:16" });
      // An unreadable download is kept and its cuts reported as unknown.
      expect(r.cuts_inside).toBeNull();
      // A reference shot bills its seconds and the guide's at $0.05: 5 s and the 1 s guide.
      expect(priceOf({ type: "video", out: "a.mp4", motion: guide }).usd).toBe(0.3);
    },
  );

  it("waits for a queued shot and downloads it", async () => {
    const answers = [
      json({ data: { video_id: "v1", status: "pending" } }),
      json({ data: { id: "v1", status: "processing" } }),
      json({ data: { id: "v1", status: "completed", video_url: "https://files.test/v1.mp4" } }),
      new Response(new Uint8Array([9])),
    ];
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(url);
      return answers.shift()!;
    });
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const pending = generate({
      type: "video",
      out: join(project, "assets/shot.mp4"),
      prompt: "push in",
      seconds: 6,
    });
    await vi.runAllTimersAsync();
    const r = await pending;
    vi.useRealTimers();
    expect(urls.slice(0, 3)).toEqual([
      "https://api.test/v3/models/videos",
      "https://api.test/v3/models/videos/v1",
      "https://api.test/v3/models/videos/v1",
    ]);
    expect(existsSync(r.out)).toBe(true);
    expect(r.job).toBe("v1");
  });

  it("names its own price when HeyGen refuses for credits without saying how many", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(JSON.stringify({ error: { code: "hf_usage_exhausted" } }), { status: 402 }),
    );
    const request = {
      type: "image",
      out: join(project, "assets/broke.png"),
      prompt: "a desk",
    } as const;
    await expect(
      generate(request, undefined, creditsOf(priceOf(request)) ?? undefined),
    ).rejects.toThrow("this step needs about 67");
  });

  it("prices before making", () => {
    expect(priceOf({ type: "video", out: "a.mp4", seconds: 6 }).usd).toBe(0.12);
    expect(priceOf({ type: "music", out: "a.mp3" }).usd).toBe(0.09);
    expect(
      priceOf({
        type: "image",
        out: "a.png",
        model: "gpt-image-2.5",
        aspect: "1:1",
        references: ["a", "b"],
      }).usd,
    ).toBe(0.07);
    expect(priceOf({ type: "voice", out: "a.mp3" }).usd).toBeNull();
  });

  it("prices only a request the real call would accept", () => {
    // --plan runs the same checks as the real call, so it never prices a request the call would refuse.
    const [plate, voice] = [join(project, "plate.png"), join(project, "voice.m4a")];
    writeFileSync(plate, "");
    writeFileSync(voice, "");
    const shot = { type: "video" as const, out: "a.mp4", references: [plate], audio: voice };
    expect(() => checkRequest(shot)).toThrow("--prompt is required for this type");
    expect(() =>
      checkRequest({ ...shot, prompt: "x", audio: join(project, "missing.m4a") }),
    ).toThrow("no file at");
    expect(() => checkRequest({ ...shot, prompt: "she talks to the camera" })).not.toThrow();
    expect(() => checkRequest({ ...shot, prompt: "x", firstFrame: "f.png" })).toThrow(
      "--first-frame cannot be used",
    );
    expect(() => checkRequest({ ...shot, prompt: "x", out: "a.png" })).toThrow(
      "--out a.png does not fit a video",
    );
    expect(() => checkRequest({ ...shot, prompt: "x", masks: [parseMask("1,1,2,2")] })).toThrow(
      "--mask blanks regions of the --motion clip",
    );
  });

  it("prices an avatar on the plan's avatar rows, not its API price", () => {
    const script = Array.from({ length: 30 }, () => "word").join(" ");
    const avatar = priceOf({ type: "avatar", out: "a.mp4", script });
    expect(creditsOf(avatar)).toBe(200);
    expect(avatar.list).toBeCloseTo(1.2167);
    expect(() => checkLimit(creditsOf(avatar), 220)).not.toThrow();
  });

  it("charges a reference shot's pictures after the first two", () => {
    const shot = (pictures: number) => ({
      type: "video" as const,
      out: "a.mp4",
      seconds: 5,
      references: Array.from({ length: pictures }, (_, i) => `${i}.png`),
    });
    const credits = [1, 2, 3, 9].map((n) => creditsOf(priceOf(shot(n))));
    expect(credits).toEqual([167, 167, 180, 260]);
    expect(priceOf(shot(9)).list).toBeCloseTo(0.39);
    expect(() => checkLimit(credits[3]!, 250)).toThrow("about 260 credits, over --max-credits 250");
    expect(() => checkLimit(credits[3]!, 260)).not.toThrow();
  });

  it("keeps a call under the person's credit limit, or refuses it before sending", () => {
    const shot = creditsOf(priceOf({ type: "video", out: "a.mp4", seconds: 6 }));
    expect(shot).toBe(72);
    expect(creditsOf(priceOf({ type: "image", out: "a.png" }))).toBe(67);
    expect(() => checkLimit(shot, 72)).not.toThrow();
    expect(() => checkLimit(shot, 30)).toThrow("about 72 credits, over --max-credits 30");
    expect(() => checkLimit(null, 30)).toThrow("cannot be priced ahead");
    expect(() => checkLimit(null, undefined)).not.toThrow();
  });
});

describe("foldShort", () => {
  it("folds a piece under half a second into its neighbour", () => {
    expect(foldShort([4, 4.2, 8], 10)).toEqual([4.2, 8]);
    expect(foldShort([0.2, 5], 10)).toEqual([5]);
    expect(foldShort([5, 9.8], 10)).toEqual([5]);
    expect(foldShort([2, 2.1, 2.2, 6], 10)).toEqual([2.2, 6]);
  });
});
