import assert from "node:assert/strict";

import type { Frame } from "puppeteer-core";

import { launchBrowser } from "../perf/runner.js";
import { startServer } from "../perf/server.js";

/**
 * Seeded sequences of media edits, each run in the sealed film, in the sealed film with the CORS helper off (the
 * control for source and playback), and in the film unsealed (the control for pixels).
 */

type Kind =
  | "cors"
  | "nocors"
  | "unsupported"
  | "missing"
  | "flaky"
  | "foreignCors"
  | "foreignNocors"
  | "foreignUnsupported"
  | "foreignMissing"
  | "unmatched"
  | "down"
  | "outage"
  | "lapse"
  | "lapseCors"
  | "slowNocors";
type Source = { id: string; kind: Kind; start?: number; delay?: number };
type Step =
  | { do: "create"; el: number; sources: Source[]; attr?: true }
  | { do: "prepend" | "append"; el: number; source: Source }
  | { do: "remove"; el: number; index: number }
  | { do: "reverse" | "reload"; el: number }
  | { do: "author"; el: number; value: string; duringRetry?: boolean; replace?: Source }
  | { do: "play"; el: number; rate: number; pauseOnReject?: true }
  | { do: "interrupt"; el: number; action: Interrupt; source?: Source }
  | { do: "recover"; el: number; source: Source };
// Interrupt: done by the composition right after the runtime's next load of that element, or at the round's end.
// Recover: the source's host comes back (without CORS headers unless lapseCors), then the composition reloads el.
type Interrupt = "pause" | "seek" | "seekPlaying" | "rate" | "source" | "author";
type Sequence = { name: string; rounds: Step[][]; keepsCors?: number[]; upgradesAtMost?: number };

const KINDS: Kind[] = [
  "cors",
  "nocors",
  "unsupported",
  "missing",
  "flaky",
  "foreignCors",
  "foreignNocors",
  "foreignUnsupported",
  "foreignMissing",
  "unmatched",
  "down",
  "lapse",
  "lapseCors",
  "slowNocors",
];
const PLAYABLE = new Set<Kind>(["cors", "nocors", "slowNocors", "foreignCors", "foreignNocors"]);
// A host that fails some requests plays only if a later selection asks it again, as in unsealed Studio.
const MAY_PLAY = new Set<Kind>([...PLAYABLE, "flaky", "outage", "lapse", "lapseCors"]);
const SENDS_CORS = new Set<Kind>(["cors", "foreignCors", "flaky", "outage", "lapseCors"]);
const lapses = (kind: Kind) => kind === "lapse" || kind === "lapseCors";
const NOT_SELECTABLE = new Set<Kind>(["unsupported", "foreignUnsupported", "unmatched"]);
const foreign = (kind: Kind) => kind.startsWith("foreign");
// The accepted gap: a list whose selectable sources name another host is left as authored, so own media is not read.
const mixed = (list: Source[]) => {
  const selectable = list.filter((source) => !NOT_SELECTABLE.has(source.kind));
  return selectable.some((x) => foreign(x.kind)) && selectable.some((x) => !foreign(x.kind));
};

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generated(seed: number): Sequence {
  const random = mulberry32(seed);
  const pick = <T>(list: readonly T[]) => list[Math.floor(random() * list.length)]!;
  const pool = Array.from({ length: 4 }, (_, k) => ({ id: `g${seed}-${k}`, kind: pick(KINDS) }));
  const lists: Source[][] = [];
  const rounds: Step[][] = [];
  const elements = 2 + Math.floor(random() * 2);
  const recovered = new Set<string>();
  for (let round = 0; round < 4; round++) {
    const steps: Step[] = [];
    for (let el = 0; el < elements; el++) {
      if (!lists[el]) {
        if (round > 0 && random() < 0.5) continue;
        const sources = Array.from({ length: 1 + Math.floor(random() * 3) }, () => pick(pool));
        lists[el] = [...new Map(sources.map((s) => [s.id, s])).values()];
        steps.push({ do: "create", el, sources: lists[el] });
        if (random() < 0.5)
          steps.push({
            do: "play",
            el,
            rate: pick([1, 1.5]),
            ...(random() < 0.5 ? { pauseOnReject: true as const } : {}),
          });
        continue;
      }
      const list = lists[el];
      const lapsed = list.find((s) => lapses(s.kind) && !recovered.has(s.id));
      if (lapsed && random() < 0.5) {
        recovered.add(lapsed.id);
        steps.push({ do: "recover", el, source: lapsed });
        continue;
      }
      const action = pick(["prepend", "append", "remove", "reverse", "reload", "author", "none"]);
      const fresh = pool.filter((s) => !list.some((listed) => listed.id === s.id));
      if ((action === "prepend" || action === "append") && fresh.length) {
        const source = pick(fresh);
        lists[el] = action === "prepend" ? [source, ...list] : [...list, source];
        steps.push({ do: action, el, source });
      } else if (action === "remove" && list.length > 1) {
        const index = Math.floor(random() * list.length);
        lists[el] = list.filter((_, i) => i !== index);
        steps.push({ do: "remove", el, index });
      } else if (action === "reverse" && list.length > 1) {
        lists[el] = [...list].reverse();
        steps.push({ do: "reverse", el });
      } else if (action === "reload") steps.push({ do: "reload", el });
      else if (action === "author" && random() < 0.4)
        steps.push({ do: "author", el, value: pick(["anonymous", "use-credentials"]) });
    }
    rounds.push(steps);
  }
  return { name: `seed ${seed}`, rounds };
}

const own = (id: string, kind: Kind, at: { start?: number; delay?: number } = {}): Source => ({
  id,
  kind,
  ...at,
});
// Earlier review repros, written in the same steps.
const FIXED: Sequence[] = [
  {
    name: "a CORS source prepended after a fallback, then load()",
    rounds: [
      [{ do: "create", el: 0, sources: [own("f1-a", "nocors")] }],
      [{ do: "prepend", el: 0, source: own("f1-b", "cors") }],
    ],
  },
  {
    name: "the source that fell back removed beside a CORS source",
    rounds: [
      [{ do: "create", el: 0, sources: [own("f2-a", "nocors")] }],
      [{ do: "append", el: 0, source: own("f2-b", "cors") }],
      [{ do: "remove", el: 0, index: 0 }],
    ],
  },
  {
    name: "a foreign source the browser cannot play before an own playable one",
    rounds: [
      [
        {
          do: "create",
          el: 0,
          sources: [own("f3-a", "foreignUnsupported"), own("f3-b", "cors")],
        },
      ],
    ],
  },
  {
    name: "the composition sets crossorigin during the retry, then a fresh element plays that URL",
    rounds: [
      [
        { do: "create", el: 0, sources: [own("f4-a", "flaky")] },
        { do: "author", el: 0, value: "anonymous", duringRetry: true },
      ],
      [{ do: "create", el: 1, sources: [own("f4-a", "flaky")] }],
    ],
    keepsCors: [1],
  },
  {
    name: "a no-CORS source beside one whose media never matches, reloaded",
    rounds: [
      [{ do: "create", el: 0, sources: [own("f5-a", "nocors"), own("f5-b", "unmatched")] }],
      [{ do: "reload", el: 0 }],
    ],
  },
  {
    name: "a host down with and without CORS, then back, the same element reloaded twice",
    // The second reload is the one every film's host answers, so the unsealed film always has a frame to compare.
    rounds: [
      [{ do: "create", el: 0, sources: [own("f6-a", "outage")] }],
      [{ do: "reload", el: 0 }],
      [{ do: "reload", el: 0 }],
    ],
    keepsCors: [0],
  },
  {
    name: "a host down for the whole run, reloaded",
    rounds: [[{ do: "create", el: 0, sources: [own("f7-a", "down")] }], [{ do: "reload", el: 0 }]],
  },
  {
    name: "the composition sets crossorigin in the same task as a new source",
    rounds: [
      [{ do: "create", el: 0, sources: [own("f8-a", "cors")] }],
      [{ do: "author", el: 0, value: "use-credentials", replace: own("f8-b", "nocors") }],
    ],
  },
  {
    name: "an outside MP4 without CORS prepended to a playing own source, then load()",
    rounds: [
      [
        { do: "create", el: 0, sources: [own("r7a-a", "cors")] },
        { do: "play", el: 0, rate: 1 },
      ],
      [{ do: "prepend", el: 0, source: own("r7a-b", "foreignNocors") }],
    ],
  },
  {
    name: "an unavailable outside source before a playable own one, played",
    rounds: [
      [
        { do: "create", el: 0, sources: [own("r7b-a", "foreignMissing"), own("r7b-b", "cors")] },
        { do: "play", el: 0, rate: 1.5 },
      ],
    ],
  },
  {
    name: "an own URL played again after the element played an outside clip",
    rounds: [
      [
        { do: "create", el: 0, sources: [own("r7c-a", "foreignMissing"), own("r7c-b", "cors")] },
        { do: "play", el: 0, rate: 1 },
      ],
      [{ do: "prepend", el: 0, source: own("r7c-c", "foreignNocors") }],
      [{ do: "remove", el: 0, index: 0 }],
    ],
  },
  {
    name: "an own CORS URL played again, all own, after the element played another own clip",
    rounds: [
      [{ do: "create", el: 0, sources: [own("r7g-n", "nocors")] }],
      [{ do: "prepend", el: 0, source: own("r7g-a", "cors") }],
      [{ do: "remove", el: 0, index: 0 }],
      [{ do: "prepend", el: 0, source: own("r7g-a", "cors") }],
    ],
  },
  {
    name: "an own source without CORS prepended to a playing own CORS source, then load()",
    rounds: [
      [
        { do: "create", el: 0, sources: [own("r7d-a", "cors")] },
        { do: "play", el: 0, rate: 1 },
      ],
      [{ do: "prepend", el: 0, source: own("r7d-b", "nocors") }],
    ],
  },
  {
    name: "a host down for good before a source without CORS: one upgrade, refused, none after",
    rounds: [[{ do: "create", el: 0, sources: [own("r7e-a", "down"), own("r7e-b", "nocors")] }]],
    upgradesAtMost: 1,
  },
  {
    name: "a host down for good before a playing CORS source: playback goes on after the upgrade",
    rounds: [
      [
        { do: "create", el: 0, sources: [own("r7f-a", "down"), own("r7f-b", "cors")] },
        { do: "play", el: 0, rate: 1.5 },
      ],
    ],
  },
  ...(["pause", "seek", "rate", "source", "author"] as const).map(
    (action): Sequence => ({
      name: `a ${action} by the composition during the runtime's load wins`,
      rounds: [
        [
          {
            do: "create",
            el: 0,
            sources: [own(`r7${action}-a`, "down"), own(`r7${action}-b`, "cors")],
          },
          { do: "play", el: 0, rate: 1.5 },
          { do: "interrupt", el: 0, action, source: own(`r7${action}-c`, "cors") },
        ],
      ],
    }),
  ),
  {
    name: "a seek by the composition during the runtime's load of a playing clip wins",
    rounds: [
      [
        {
          do: "create",
          el: 0,
          sources: [
            own("r7seekPlaying-a", "down"),
            own("r7seekPlaying-b", "cors", { start: 1.5, delay: 4000 }),
          ],
        },
        { do: "play", el: 0, rate: 1.5 },
        { do: "interrupt", el: 0, action: "seekPlaying", source: own("r7seekPlaying-c", "cors") },
      ],
    ],
  },
  ...(["lapse", "lapseCors"] as const).map(
    (kind): Sequence => ({
      name: `a playing element whose first own source was down and came back (${kind}), reloaded`,
      rounds: [
        [
          { do: "create", el: 0, sources: [own(`r8${kind}-a`, kind), own(`r8${kind}-b`, "cors")] },
          { do: "play", el: 0, rate: 1 },
        ],
        [{ do: "recover", el: 0, source: own(`r8${kind}-a`, kind) }],
      ],
    }),
  ),
  {
    name: "an own source without CORS on a slow host, played",
    rounds: [
      [
        { do: "create", el: 0, sources: [own("r8b-a", "slowNocors")] },
        { do: "play", el: 0, rate: 1 },
      ],
    ],
  },
  {
    name: "an own src attribute without CORS on a slow host, played",
    rounds: [
      [
        { do: "create", el: 0, sources: [own("r8c-a", "slowNocors")], attr: true },
        { do: "play", el: 0, rate: 1 },
      ],
    ],
  },
];

// Generated sequences that found a fault by themselves: the composition's play() rejected for a fallback
// (1, 24, 36, 43, 74) and a recovered source skipped (241, 346). Run on every count of seeds.
const PINNED = [1, 24, 36, 43, 74, 241, 346];

const server = startServer();
const foreignOrigin = server.origin.replace("127.0.0.1", "localhost");

type SourceAttrs = { src: string; type?: string; media?: string };

// Each run asks for its own URLs, so the server's per-URL failures and request counts stay apart.
// A trimmed clip's source opens past 0 (#t=), as a media-start does; a slow host answers its first request late.
function urlFor(source: Source, run: string): SourceAttrs {
  const attrs = urlForKind(source, run);
  const slow = source.delay ? `&delay=${source.delay}` : "";
  return { ...attrs, src: `${attrs.src}${slow}${source.start ? `#t=${source.start}` : ""}` };
}

function urlForKind(source: Source, run: string): SourceAttrs {
  const query = `?id=${run}.${source.id}&no-store`;
  const path = (dir: string) => `${dir}/10-video-grid/sample.mp4${query}`;
  switch (source.kind) {
    case "cors":
      return { src: `${server.origin}${path("/fixtures")}` };
    case "nocors":
      return { src: `${server.origin}${path("/fixtures-no-cors")}` };
    case "unsupported":
      return { src: `${server.origin}${path("/fixtures")}`, type: "video/x-nope" };
    case "missing":
      return { src: `${server.origin}/fixtures/10-video-grid/missing.mp4${query}` };
    case "flaky":
      return { src: `${server.origin}${path("/fixtures-flaky")}` };
    case "foreignCors":
      return { src: `${foreignOrigin}${path("/fixtures")}` };
    case "foreignNocors":
      return { src: `${foreignOrigin}${path("/fixtures-no-cors")}` };
    case "foreignUnsupported":
      return { src: `${foreignOrigin}${path("/fixtures")}`, type: "video/x-nope" };
    case "foreignMissing":
      return { src: `${foreignOrigin}/fixtures/10-video-grid/missing.mp4${query}` };
    case "unmatched":
      return { src: `${server.origin}${path("/fixtures")}`, media: "(max-width: 1px)" };
    case "down":
      return { src: `${server.origin}${path("/fixtures-flaky")}&fail=1000` };
    case "outage":
      return { src: `${server.origin}${path("/fixtures-flaky")}&fail=2` };
    case "slowNocors":
      return { src: `${server.origin}${path("/fixtures-no-cors")}&delay=1500` };
    case "lapse":
      return { src: `${server.origin}${path("/fixtures-lapse")}` };
    case "lapseCors":
      return { src: `${server.origin}${path("/fixtures-lapse")}&cors` };
  }
}

type Seen = {
  crossOrigin: string | null;
  playing: boolean;
  paused: boolean;
  rate: number;
  upgrades: number;
  savedRate?: string;
  restartGap?: string;
  restartRate?: string;
  seekAt?: string;
  seekCarry?: string;
  seekPaused?: string;
  extraSeeks?: string;
  loops: number;
  restores: number;
  interrupted?: string;
  play?: string;
  pixels: string;
  currentSrc: string;
  loads: number;
  ours: number;
  selections: number;
  failedWithCors: string[];
};

async function installDriver(frame: Frame) {
  await frame.evaluate(() => {
    const state = new Map<string, { video: HTMLVideoElement; last: number; failed: Set<string> }>();
    const touch = (video: HTMLVideoElement) => {
      const entry = state.get(video.dataset.table ?? "");
      if (entry) entry.last = performance.now();
    };
    // The composition here is this driver: every other load() of a table video is the runtime's.
    let driving = false;
    const driven = (video: HTMLMediaElement) => {
      driving = true;
      try {
        video.load();
      } finally {
        driving = false;
      }
      video.dataset.selections = String(Number(video.dataset.selections ?? 1) + 1);
    };
    const sourceEl = (src: { src: string; type?: string; media?: string }) => {
      const el = document.createElement("source");
      el.src = src.src;
      if (src.type) el.type = src.type;
      if (src.media) el.media = src.media;
      return el;
    };
    const pending = new Map<HTMLMediaElement, { action: string; src?: { src: string } }>();
    const interrupt = (video: HTMLMediaElement) => {
      const step = pending.get(video);
      if (!step) return;
      pending.delete(video);
      video.dataset.interrupted = step.action;
      if (step.action === "pause") video.pause();
      else if (step.action === "seek" || step.action === "seekPlaying") {
        video.dataset.seekTo = "0.5";
        video.dataset.seekIssued = String(performance.now());
        video.currentTime = 0.5;
      } else if (step.action === "rate") video.playbackRate = 2;
      else if (step.action === "author") video.setAttribute("crossorigin", "anonymous");
      else {
        video.prepend(sourceEl(step.src!));
        driven(video);
      }
    };
    const load = HTMLMediaElement.prototype.load;
    HTMLMediaElement.prototype.load = function (this: HTMLMediaElement) {
      const data = this.dataset;
      const cors = String(this.getAttribute("crossorigin"));
      // The CORS handling writes crossorigin, then loads; the runtime's preload loads leave it as it was.
      const corsReload = data.corsAtLoad !== undefined && data.corsAtLoad !== cors;
      if (data.table) data.corsAtLoad = cors;
      if (data.table && !driving) {
        data.ours = String(Number(data.ours ?? 0) + 1);
        data.loadedAt = String(this.currentTime);
        if (this.hasAttribute("crossorigin"))
          data.upgrades = String(Number(data.upgrades ?? 0) + 1);
        delete data.restartGap;
        if (!this.paused) {
          data.savedTime = String(this.currentTime);
          data.savedRate = String(this.playbackRate);
          data.watch = "1";
        }
        const races =
          pending.get(this)?.action !== "seekPlaying" ||
          (this.currentTime > 0 && data.play !== undefined);
        if (pending.has(this) && corsReload && races) setTimeout(() => interrupt(this));
      }
      return load.call(this);
    };
    window.addEventListener(
      "error",
      (event) => {
        const target = event.target as Element | null;
        const video = target?.closest?.("video[data-table]") as HTMLVideoElement | null;
        if (!video) return;
        touch(video);
        const src = target === video ? video.currentSrc : (target as HTMLSourceElement).src;
        if (video.hasAttribute("crossorigin") && src)
          state.get(video.dataset.table!)!.failed.add(src);
        const during = video.dataset.authorDuringRetry;
        if (during) {
          delete video.dataset.authorDuringRetry;
          setTimeout(() => video.setAttribute("crossorigin", during));
        }
      },
      true,
    );
    Object.assign(window, {
      __table: {
        create(
          key: string,
          sources: Array<{ src: string; type?: string; media?: string }>,
          attr?: boolean,
          duringRetry?: string,
          seekOnReload?: boolean,
        ) {
          const video = document.createElement("video");
          video.dataset.table = key;
          if (duringRetry) video.dataset.authorDuringRetry = duringRetry;
          if (seekOnReload) pending.set(video, { action: "seekPlaying" });
          video.muted = true;
          video.loop = true;
          // The runtime binds new media with preload auto and a load() of its own, at a time of its choosing.
          video.preload = "metadata";
          // Where a load of ours starts the video again: its metadata places the playhead before it plays.
          video.addEventListener("loadedmetadata", () => {
            const data = video.dataset;
            if (data.watch) {
              delete data.watch;
              data.restartGap = String(Math.abs(video.currentTime - Number(data.savedTime)));
              data.restartRate = String(video.playbackRate);
            }
          });
          // Where the composition's seek settles, and any seek after it other than the loop starting over.
          video.addEventListener(
            "timeupdate",
            () => (video.dataset.lastTime = String(video.currentTime)),
          );
          // A seek fires timeupdate at its new time before seeked; where it came from is read at seeking.
          video.addEventListener(
            "seeking",
            () => (video.dataset.seekFrom = video.dataset.lastTime),
          );
          video.addEventListener("seeked", () => {
            const data = video.dataset;
            const looped = Number(data.seekFrom ?? 0) > 2 && video.currentTime < 1;
            if (looped) data.loops = String(Number(data.loops ?? 0) + 1);
            // A load of ours puts the playhead back where it was; within a frame of that, it is not a jump.
            const restored = Math.abs(video.currentTime - Number(data.loadedAt)) <= 1 / 30 + 0.01;
            if (data.seekAt !== undefined && !looped && restored)
              data.restores = String(Number(data.restores ?? 0) + 1);
            else if (data.seekAt !== undefined && !looped)
              data.extraSeeks =
                `${data.extraSeeks ?? ""} ${data.seekFrom}->${video.currentTime}`.trim();
            if (!data.seekTo) return;
            data.seekAt = String(video.currentTime);
            data.seekCarry = String(
              (video.playbackRate * (performance.now() - Number(data.seekIssued))) / 1000,
            );
            data.seekPaused = String(video.paused);
            delete data.seekTo;
          });
          for (const name of ["loadstart", "loadeddata", "emptied", "stalled"])
            video.addEventListener(name, () => touch(video));
          video.addEventListener(
            "loadstart",
            () => (video.dataset.loads = String(Number(video.dataset.loads ?? 0) + 1)),
          );
          if (attr) video.src = sources[0]!.src;
          else video.append(...sources.map(sourceEl));
          state.set(key, { video, last: performance.now(), failed: new Set() });
          document.body.append(video);
        },
        edit(
          key: string,
          step: {
            do: string;
            src?: { src: string; type?: string; media?: string };
            index?: number;
            value?: string;
            duringRetry?: boolean;
            rate?: number;
            action?: string;
            pauseOnReject?: boolean;
          },
        ) {
          const { video } = state.get(key)!;
          if (step.do === "play") {
            // After the runtime's binding load, which would otherwise cancel this play() in either film.
            const since = performance.now();
            return new Promise<void>((resolve) => {
              const ready = () => video.preload === "auto" || performance.now() - since > 3000;
              const check = () => (ready() ? resolve() : setTimeout(check, 10));
              check();
            }).then(() => {
              video.playbackRate = step.rate!;
              video.dataset.play = "pending";
              video.play().then(
                () => (video.dataset.play = "resolved"),
                (error: Error) => {
                  video.dataset.play = `rejected ${error.name}`;
                  if (step.pauseOnReject) video.pause();
                },
              );
            });
          }
          if (step.do === "interrupt") {
            pending.set(video, { action: step.action!, src: step.src });
            return;
          }
          if (step.do === "prepend") video.prepend(sourceEl(step.src!));
          else if (step.do === "append") video.append(sourceEl(step.src!));
          else if (step.do === "remove") video.querySelectorAll("source")[step.index!]!.remove();
          else if (step.do === "reverse")
            video.append(...[...video.querySelectorAll("source")].reverse());
          else if (step.do === "author" && step.duringRetry) {
            video.dataset.authorDuringRetry = step.value!;
            return;
          } else if (step.do === "author") {
            if (step.src) video.replaceChildren(sourceEl(step.src));
            video.setAttribute("crossorigin", step.value!);
          }
          driven(video);
        },
        flush() {
          const any = pending.size > 0;
          for (const video of [...pending.keys()]) interrupt(video);
          return any;
        },
        async advancing(key: string) {
          const { video } = state.get(key)!;
          if (video.paused || video.readyState < 2) return false;
          // Moving within a second: one short sample on a busy page catches a buffering pause.
          const at = video.currentTime;
          for (let waited = 0; waited < 1000; waited += 100) {
            await new Promise((resolve) => setTimeout(resolve, 100));
            if (video.currentTime !== at) return true;
          }
          return false;
        },
        // Every film alike: a looping clip at its end has no frame until the loop's seek lands.
        async loopRestart(key: string, loops: number) {
          const { video } = state.get(key)!;
          for (let waited = 0; waited < 2000; waited += 50) {
            if (Number(video.dataset.loops ?? 0) > loops) return true;
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          return false;
        },
        keys: () => [...state.keys()],
        settled: () =>
          [...state.values()].every(
            ({ video, last }) =>
              performance.now() - last > 400 &&
              (video.readyState >= 2 || video.error !== null || video.networkState === 3),
          ),
        read(key: string) {
          const { video, failed } = state.get(key)!;
          let pixels = "none";
          if (video.readyState >= 2) {
            const context = document.createElement("canvas").getContext("2d")!;
            context.drawImage(video, 0, 0, 1, 1);
            try {
              context.getImageData(0, 0, 1, 1);
              pixels = "readable";
            } catch {
              pixels = "refused";
            }
          }
          const data = video.dataset;
          return {
            crossOrigin: video.getAttribute("crossorigin"),
            playing: video.readyState >= 2,
            paused: video.paused,
            rate: video.playbackRate,
            upgrades: Number(data.upgrades ?? 0),
            savedRate: data.savedRate,
            restartGap: data.restartGap,
            restartRate: data.restartRate,
            seekAt: data.seekAt,
            seekCarry: data.seekCarry,
            seekPaused: data.seekPaused,
            extraSeeks: data.extraSeeks,
            interrupted: data.interrupted,
            loops: Number(data.loops ?? 0),
            restores: Number(data.restores ?? 0),
            play: data.play,
            pixels,
            currentSrc: video.currentSrc,
            loads: Number(video.dataset.loads ?? 0),
            ours: Number(video.dataset.ours ?? 0),
            selections: Number(video.dataset.selections ?? 1),
            failedWithCors: [...failed],
          };
        },
      },
    });
  });
}

type Table = {
  create: (
    key: string,
    sources: SourceAttrs[],
    attr: boolean,
    duringRetry?: string,
    seekOnReload?: boolean,
  ) => void;
  edit: (key: string, step: object) => unknown;
  settled: () => boolean;
  flush: () => boolean;
  keys: () => string[];
  advancing: (key: string) => Promise<boolean>;
  loopRestart: (key: string, loops: number) => Promise<boolean>;
  read: (key: string) => Seen;
};
declare global {
  interface Window {
    __table: Table;
  }
}

async function runAll(frame: Frame, sequences: Sequence[], run: string) {
  const rounds = Math.max(...sequences.map((s) => s.rounds.length));
  const readings: Readings[] = [];
  for (let round = 0; round < rounds; round++) {
    for (const [index, sequence] of sequences.entries()) {
      const steps = sequence.rounds[round] ?? [];
      // A write during the retry is registered with its element: as a later call, a fast failure could beat it.
      const duringRetry = (el: number) =>
        steps.find((step) => step.do === "author" && step.duringRetry && step.el === el);
      // So is a seek on a playing clip's reload past 0: that reload can come while the play step waits.
      const seekOnReload = (el: number) =>
        steps.some(
          (step) => step.do === "interrupt" && step.action === "seekPlaying" && step.el === el,
        );
      for (const step of steps) {
        const key = `${index}-${step.el}`;
        if (step.do === "recover") server.recover(`${run}.${step.source.id}`);
        if (step.do === "create") {
          const during = duringRetry(step.el);
          await frame.evaluate(
            (k, s, a, d, o) => window.__table.create(k, s, a, d, o),
            key,
            step.sources.map((source) => urlFor(source, run)),
            step.attr ?? false,
            during?.do === "author" ? during.value : undefined,
            seekOnReload(step.el),
          );
        } else if (
          ((step.do === "author" && step.duringRetry) ||
            (step.do === "interrupt" && step.action === "seekPlaying")) &&
          steps.some((s) => s.do === "create" && s.el === step.el)
        )
          continue;
        else {
          const listed =
            "source" in step ? step.source : step.do === "author" ? step.replace : undefined;
          const src = listed && urlFor(listed, run);
          await frame.evaluate((k, s) => window.__table.edit(k, s), key, { ...step, src });
        }
      }
    }
    const settle = () =>
      frame
        .waitForFunction(() => window.__table.settled(), { timeout: 20_000, polling: 100 })
        .catch(() => undefined);
    await settle();
    if (await frame.evaluate(() => window.__table.flush())) await settle();
    readings.push(await readAll(frame));
  }
  return readings;
}

const describe = (sequence: Sequence) =>
  sequence.rounds
    .map((steps) =>
      steps
        .map((step) => {
          const listed = "sources" in step ? step.sources : "source" in step ? [step.source] : [];
          const what =
            step.do === "interrupt"
              ? ` ${step.action}`
              : step.do === "play"
                ? ` ${step.rate}${step.pauseOnReject ? " pausing-on-reject" : ""}`
                : "";
          return `${step.do}${step.el}${what}${listed.map((x) => ` ${x.kind}`).join("")}`;
        })
        .join(", "),
    )
    .join(" | ");

type Reading = Seen & { moves: boolean };
type Readings = Map<string, Reading>;

// Every element of a run, read while its film is still the page in front.
async function readAll(frame: Frame) {
  const keys = await frame.evaluate(() => window.__table.keys());
  const readings: Readings = new Map();
  await Promise.all(
    keys.map(async (key) => {
      const readOnce = () =>
        Promise.all([
          frame.evaluate((k) => window.__table.read(k), key),
          frame.evaluate((k) => window.__table.advancing(k), key),
        ]);
      let [seen, moves] = await readOnce();
      const restarting = !seen.playing && !seen.paused;
      if (
        restarting &&
        (await frame.evaluate((k, l) => window.__table.loopRestart(k, l), key, seen.loops))
      )
        [seen, moves] = await readOnce();
      readings.set(key, { ...seen, moves });
    }),
  );
  return readings;
}
const idOf = (src: string) => (src ? new URL(src).searchParams.get("id")!.slice(2) : "");
// One frame at 30 fps, with room for the timer that reads it.
const FRAME = 1 / 30 + 0.01;

function history(sequence: Sequence, upTo = sequence.rounds.length - 1) {
  const lists = new Map<number, Source[]>();
  const everListed = new Map<number, Map<string, Kind>>();
  const authored = new Map<number, string>();
  for (const steps of sequence.rounds.slice(0, upTo + 1))
    for (const step of steps) {
      const list = lists.get(step.el) ?? [];
      if (step.do === "create") lists.set(step.el, [...step.sources]);
      else if (step.do === "prepend") lists.set(step.el, [step.source, ...list]);
      else if (step.do === "append") lists.set(step.el, [...list, step.source]);
      else if (step.do === "remove")
        lists.set(
          step.el,
          list.filter((_, i) => i !== step.index),
        );
      else if (step.do === "reverse") lists.set(step.el, [...list].reverse());
      else if (step.do === "author") authored.set(step.el, step.value);
      else if (step.do === "interrupt" && step.action === "author")
        authored.set(step.el, "anonymous");
      else if (step.do === "interrupt" && step.action === "source")
        lists.set(step.el, [step.source!, ...list]);
      if (step.do === "author" && step.replace) lists.set(step.el, [step.replace]);
      const kinds = everListed.get(step.el) ?? new Map<string, Kind>();
      for (const source of lists.get(step.el)!) kinds.set(source.id, source.kind);
      everListed.set(step.el, kinds);
    }
  return { lists, everListed, authored };
}

// Per element, against the helper off: the same source, playing state and moving playhead; after a load of ours
// while it played, it resumes where it was at the same rate. Pixels readable wherever the unsealed film reads them
// from a source that sends CORS, except the known gap.
// Each round of each sequence, so a wrong middle step is not hidden by a right end; an element is reported once.
function judge(sequences: Sequence[], sealed: Readings[], control: Readings[], open: Readings[]) {
  const budget = new Map<string, number>();
  const playback = { judged: 0, skipped: 0 };
  const landings: string[] = [];
  const gaps: string[] = [];
  const reported = new Set<string>();
  const all = sequences.flatMap((sequence, index) =>
    sequence.rounds.map((_, round) => judgeRound(sequence, index, round)),
  );
  function judgeRound(sequence: Sequence, index: number, round: number) {
    const { lists, everListed, authored } = history(sequence, round);
    const last = round === sequence.rounds.length - 1;
    const problems: string[] = [];
    const starts: Array<[string, number]> = [];
    for (const [el, list] of lists) {
      const key = `${index}-${el}`;
      if (reported.has(key)) continue;
      starts.push([key, problems.length]);
      const seen = sealed[round]!.get(key)!;
      const plain = control[round]!.get(key)!;
      const unsealed = open[round]!.get(key)!;
      const { moves } = seen;
      const movesPlain = plain.moves;
      const where = `${sequence.name} (${describe(sequence)}), element ${el} after round ${round + 1}`;
      const kinds = everListed.get(el)!;
      // The runtime loads media without the helper too; the helper's share is what the sealed film adds.
      const helper = Math.max(0, seen.ours - plain.ours);
      // Every load the runtime's CORS handling did not make starts a selection: the driver's and the runtime's own.
      const selections = seen.selections + plain.ours;
      const most = 2 * kinds.size * selections;
      if (helper > most)
        problems.push(
          `${where}: ${helper} loads of the helper, at most ${most} for ${selections} selections`,
        );
      if (sequence.upgradesAtMost !== undefined && seen.upgrades > sequence.upgradesAtMost)
        problems.push(`${where}: ${seen.upgrades} upgrades, at most ${sequence.upgradesAtMost}`);
      // An authored crossorigin is the composition's, and an opaque origin loads it differently by design.
      const value = authored.get(el);
      if (value !== undefined) {
        if (seen.crossOrigin !== value)
          problems.push(`${where}: the composition's ${value} became ${seen.crossOrigin}`);
        continue;
      }
      // A host failing some requests may play after the runtime's extra request and not without it.
      const variable = [...kinds.values()].some((kind) => kind === "flaky" || kind === "outage");
      // A control that resolved play() and was not paused but has no frame is buffering: it says nothing.
      const stalled = !plain.playing && !plain.paused && plain.play === "resolved";
      if (!variable) playback[stalled ? "skipped" : "judged"]++;
      if (!variable && !stalled) {
        if (idOf(seen.currentSrc) !== idOf(plain.currentSrc))
          problems.push(
            `${where}: plays ${idOf(seen.currentSrc)}, without the helper ${idOf(plain.currentSrc)}`,
          );
        if (seen.playing !== plain.playing || (plain.playing && seen.paused !== plain.paused))
          problems.push(
            `${where}: ${JSON.stringify(seen)}, without the helper ${JSON.stringify(plain)}`,
          );
        if (movesPlain && !moves)
          problems.push(`${where}: the playhead stopped ${JSON.stringify(seen)}`);
        // A play() still pending is rejected by whichever load comes next, ours or the runtime's binding load.
        // The composition's own pause or load rejects a pending play() in either film, at different moments.
        const ownAbort = seen.interrupted === "pause" || seen.interrupted === "source";
        if (plain.play === "resolved" && seen.play !== "resolved" && !ownAbort)
          problems.push(`${where}: play() ${seen.play}, without the helper resolved`);
      }
      const action = seen.interrupted;
      if (action === "pause" && !seen.paused)
        problems.push(`${where}: plays after the composition paused it`);
      if (action === "rate" && seen.rate !== 2)
        problems.push(`${where}: rate ${seen.rate}, set to 2`);
      const settled = ({ seekAt, seekCarry, seekPaused, extraSeeks }: Reading) => ({
        seekAt,
        seekCarry,
        seekPaused,
        extraSeeks,
      });
      // Its seek won where the playhead sits between the target and what playback carried it to before seeked ran.
      const landed = ({ seekAt, seekCarry }: Reading) =>
        Number(seekAt) >= 0.5 - FRAME && Number(seekAt) <= 0.5 + Number(seekCarry) + FRAME;
      // Past the target at seeked, and how far playback could carry it: sealed beside unsealed, the parity bar.
      const past = ({ seekAt, seekCarry }: Reading) =>
        `+${(Number(seekAt) - 0.5).toFixed(3)} of ${Number(seekCarry).toFixed(3)}`;
      const seeks = action === "seek" || action === "seekPlaying";
      if (seeks) landings.push(`sealed ${past(seen)}, unsealed ${past(unsealed)}`);
      if (
        seeks &&
        (!landed(seen) ||
          seen.seekPaused !== plain.seekPaused ||
          seen.extraSeeks !== plain.extraSeeks)
      )
        problems.push(
          `${where}: after the composition's seek ${JSON.stringify(settled(seen))}, without the helper ${JSON.stringify(settled(plain))}`,
        );
      if (seen.savedRate !== undefined && !action && !variable && movesPlain) {
        if (!(Number(seen.restartGap ?? 1) <= FRAME))
          problems.push(`${where}: after our load it resumed ${seen.restartGap ?? "never"} s off`);
        else if (seen.restartRate !== seen.savedRate)
          problems.push(`${where}: rate ${seen.restartRate} after our load, was ${seen.savedRate}`);
      }
      const canPlay =
        list.some((s) => PLAYABLE.has(s.kind)) ||
        (last && Boolean(sequence.keepsCors?.includes(el)));
      const mayPlay = canPlay || list.some((s) => MAY_PLAY.has(s.kind));
      if (seen.playing ? !mayPlay : canPlay)
        problems.push(`${where}: ${canPlay ? "does not play" : "plays"} ${JSON.stringify(seen)}`);
      if (!seen.playing) continue;
      const kind = kinds.get(idOf(seen.currentSrc))!;
      const readable =
        unsealed.pixels === "readable" &&
        !foreign(kind) &&
        SENDS_CORS.has(kind) &&
        (sequence.keepsCors?.includes(el) || !seen.failedWithCors.includes(seen.currentSrc));
      if (!readable || seen.pixels === "readable") continue;
      const line = `${where}: plays ${idOf(seen.currentSrc)} unreadable ${JSON.stringify(seen)}`;
      if (mixed(list) && !foreign(kind)) {
        if (last) gaps.push(line);
      } else problems.push(line);
    }
    starts.forEach(([key, start], i) => {
      if ((starts[i + 1]?.[1] ?? problems.length) > start) reported.add(key);
    });
    return problems;
  }
  const final = sealed.at(-1)!;
  sequences.forEach((sequence, index) => {
    for (const [el, kinds] of history(sequence).everListed) {
      const tryAndRangePerLoad = 2 * final.get(`${index}-${el}`)!.loads;
      for (const id of kinds.keys()) budget.set(id, (budget.get(id) ?? 0) + tryAndRangePerLoad);
    }
  });
  // A skip that grows past a tenth of the comparisons would weaken the oracle without saying so.
  if (playback.skipped > 0.1 * (playback.judged + playback.skipped))
    all.push([
      `${playback.skipped} of ${playback.judged + playback.skipped} playback comparisons skipped`,
    ]);
  return { problems: all.flat(), gaps, budget, playback, landings };
}

async function filmFrame(page: import("puppeteer-core").Page, query: string) {
  await page.goto(`${server.origin}/host.html?fixture=10-video-grid${query}`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForFunction(() => window.__playerReady || window.__playerError, {
    timeout: 60_000,
  });
  // A sealed same-site film is shown as srcdoc: reach its frame through the player, not by URL.
  const frame = await (
    await page.evaluateHandle(
      () => document.getElementById("player")!.shadowRoot!.querySelector("iframe")!,
    )
  )
    .asElement()!
    .contentFrame();
  assert.ok(frame, "the film's frame must load");
  return frame;
}

const browser = await launchBrowser();
try {
  const seeds = Number(process.env.SEALED_MEDIA_SEEDS ?? 40);
  const from = Number(process.env.SEALED_MEDIA_SEED_FROM ?? 1);
  const numbers = [...new Set([...Array.from({ length: seeds }, (_, n) => n + from), ...PINNED])];
  const sequences = [...FIXED, ...numbers.map(generated)];
  // One page at a time: a page behind another one has its media held back.
  const run = async (query: string, prefix: string, helperOff = false) => {
    const page = await browser.newPage();
    // The helper starts only where window.origin reads "null"; the other two readers touch no table video.
    if (helperOff)
      await page.evaluateOnNewDocument(() => {
        if (window.origin === "null")
          Object.defineProperty(window, "origin", { value: "helper-off" });
      });
    const frame = await filmFrame(page, query);
    await installDriver(frame);
    const readings = await runAll(frame, sequences, prefix);
    await page.close();
    return readings;
  };
  const sealed = await run("&sealed=1", "s");
  const control = await run("&sealed=1", "c", true);
  const open = await run("", "o");
  const { problems, gaps, budget, playback, landings } = judge(sequences, sealed, control, open);
  console.log(
    `[sealed-media-table] seek landings past 0.5 (of what playback carried): ${landings.join("; ")}`,
  );
  const loops = (film: Readings[]) =>
    [...film.at(-1)!.values()].reduce((sum, reading) => sum + reading.loops, 0);
  const restores = (film: Readings[]) =>
    [...film.at(-1)!.values()].reduce((sum, reading) => sum + reading.restores, 0);
  console.log(
    `[sealed-media-table] playback comparisons ${playback.judged}, skipped for a buffering control ${playback.skipped}; ` +
      `loop restarts not counted as seeks: sealed ${loops(sealed)}, without the helper ${loops(control)}; ` +
      `restores by our loads after a composition seek: ${restores(sealed)}`,
  );
  const requests = new Map<string, number>();
  for (const url of server.requested) {
    const id = new URL(url).searchParams.get("id");
    if (id?.startsWith("s.")) requests.set(id.slice(2), (requests.get(id.slice(2)) ?? 0) + 1);
  }
  for (const [id, asked] of requests) {
    const most = budget.get(id) ?? 0;
    if (asked > most) problems.push(`source ${id}: ${asked} requests, at most ${most} expected`);
  }
  console.log(
    `[sealed-media-table] ${gaps.length} known gaps: own media in a list naming another host`,
  );
  for (const gap of gaps) console.log(`  gap: ${gap}`);
  console.log(`[sealed-media-table] ${sequences.length} sequences, ${problems.length} problems`);
  assert.deepEqual(problems, [], problems.join("\n"));
  console.log("[sealed-media-table] every element matches the film without the helper");
} finally {
  await browser.close();
  await server.stop();
}
