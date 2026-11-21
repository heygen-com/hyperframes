import assert from "node:assert/strict";

import type { Frame } from "puppeteer-core";

import { launchBrowser } from "../perf/runner.js";
import { startServer } from "../perf/server.js";

/**
 * Seeded sequences of media edits, each run in the sealed film and in the same film unsealed: the same runtime, whose
 * CORS helper starts only in an opaque origin. The unsealed film is the control for source, playback and pixels.
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
  | "outage";
type Source = { id: string; kind: Kind };
type Step =
  | { do: "create"; el: number; sources: Source[] }
  | { do: "prepend" | "append"; el: number; source: Source }
  | { do: "remove"; el: number; index: number }
  | { do: "reverse" | "reload"; el: number }
  | { do: "author"; el: number; value: string; duringRetry?: boolean; replace?: Source }
  | { do: "play"; el: number; rate: number }
  | { do: "interrupt"; el: number; action: Interrupt; source?: Source };
// Done by the composition right after the runtime's next load of that element, or at the round's end without one.
type Interrupt = "pause" | "seek" | "rate" | "source" | "author";
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
];
const PLAYABLE = new Set<Kind>(["cors", "nocors", "foreignCors", "foreignNocors"]);
// A host that fails some requests plays only if a later selection asks it again, as in unsealed Studio.
const MAY_PLAY = new Set<Kind>([...PLAYABLE, "flaky", "outage"]);
const SENDS_CORS = new Set<Kind>(["cors", "foreignCors", "flaky", "outage"]);
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
  for (let round = 0; round < 4; round++) {
    const steps: Step[] = [];
    for (let el = 0; el < elements; el++) {
      if (!lists[el]) {
        if (round > 0 && random() < 0.5) continue;
        const sources = Array.from({ length: 1 + Math.floor(random() * 3) }, () => pick(pool));
        lists[el] = [...new Map(sources.map((s) => [s.id, s])).values()];
        steps.push({ do: "create", el, sources: lists[el] });
        if (random() < 0.5) steps.push({ do: "play", el, rate: pick([1, 1.5]) });
        continue;
      }
      const action = pick(["prepend", "append", "remove", "reverse", "reload", "author", "none"]);
      const list = lists[el];
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

const own = (id: string, kind: Kind): Source => ({ id, kind });
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
    name: "a host down with and without CORS, then back, the same element reloaded",
    rounds: [
      [{ do: "create", el: 0, sources: [own("f6-a", "outage")] }],
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
];

const server = startServer();
const foreignOrigin = server.origin.replace("127.0.0.1", "localhost");

type SourceAttrs = { src: string; type?: string; media?: string };

// Each run asks for its own URLs, so the server's per-URL failures and request counts stay apart.
function urlFor(source: Source, run: string): SourceAttrs {
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
  seekGap?: string;
  interrupted?: string;
  pixels: string;
  currentSrc: string;
  loads: number;
  ours: number;
  resets: number;
  failedWithCors: string[];
};

async function installDriver(frame: Frame) {
  await frame.evaluate(() => {
    const state = new Map<string, { video: HTMLVideoElement; last: number; failed: Set<string> }>();
    const touch = (video: HTMLVideoElement) => {
      const entry = state.get(video.dataset.table ?? "");
      if (entry) entry.last = performance.now();
    };
    // On window, so it runs before the runtime's document listener can drop the attribute.
    // A load() between this window listener and a document one added after the runtime's is the runtime's answer.
    const handling = new WeakSet<HTMLMediaElement>();
    const handled = (video: HTMLVideoElement) => handling.add(video);
    for (const type of ["error", "loadeddata"])
      document.addEventListener(
        type,
        (event) => {
          const target = event.target as Element | null;
          const video = target?.closest?.("video[data-table]") as HTMLVideoElement | null;
          if (video) handling.delete(video);
        },
        true,
      );
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
      else if (step.action === "seek") {
        video.dataset.seekTo = "0.5";
        video.currentTime = 0.5;
      } else if (step.action === "rate") video.playbackRate = 2;
      else if (step.action === "author") video.setAttribute("crossorigin", "anonymous");
      else {
        video.prepend(sourceEl(step.src!));
        video.load();
      }
    };
    const load = HTMLMediaElement.prototype.load;
    HTMLMediaElement.prototype.load = function (this: HTMLMediaElement) {
      if (this.dataset.table && handling.has(this)) {
        const data = this.dataset;
        data.ours = String(Number(data.ours ?? 0) + 1);
        if (!this.hasAttribute("crossorigin")) data.dropped = "1";
        else data.upgrades = String(Number(data.upgrades ?? 0) + 1);
        delete data.restartGap;
        if (!this.paused) {
          data.savedTime = String(this.currentTime);
          data.savedRate = String(this.playbackRate);
          data.watch = "1";
        }
        if (pending.has(this)) setTimeout(() => interrupt(this));
      }
      return load.call(this);
    };
    window.addEventListener(
      "loadeddata",
      (event) => {
        const video = event.target as HTMLVideoElement;
        if (!video.dataset?.table) return;
        handled(video);
        delete video.dataset.dropped;
      },
      true,
    );
    window.addEventListener(
      "error",
      (event) => {
        const target = event.target as Element | null;
        const video = target?.closest?.("video[data-table]") as HTMLVideoElement | null;
        if (!video) return;
        handled(video);
        touch(video);
        // A drop of CORS whose load fails too: the runtime forgets that source, so its budget starts over.
        const exhausted = target === video || video.networkState === 3;
        if (exhausted && video.dataset.dropped && !video.hasAttribute("crossorigin")) {
          delete video.dataset.dropped;
          video.dataset.resets = String(Number(video.dataset.resets ?? 0) + 1);
        }
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
        create(key: string, sources: Array<{ src: string; type?: string; media?: string }>) {
          const video = document.createElement("video");
          video.dataset.table = key;
          video.muted = true;
          video.loop = true;
          video.preload = "auto";
          video.addEventListener("playing", () => {
            const data = video.dataset;
            if (data.watch) {
              delete data.watch;
              data.restartGap = String(Math.abs(video.currentTime - Number(data.savedTime)));
              data.restartRate = String(video.playbackRate);
            }
            if (data.seekTo) {
              data.seekGap = String(Math.abs(video.currentTime - Number(data.seekTo)));
              delete data.seekTo;
            }
          });
          for (const name of ["loadstart", "loadeddata", "emptied", "stalled"])
            video.addEventListener(name, () => touch(video));
          video.addEventListener(
            "loadstart",
            () => (video.dataset.loads = String(Number(video.dataset.loads ?? 0) + 1)),
          );
          video.append(...sources.map(sourceEl));
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
          },
        ) {
          const { video } = state.get(key)!;
          if (step.do === "play") {
            video.playbackRate = step.rate!;
            void video.play().catch(() => undefined);
            return;
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
          video.load();
        },
        flush() {
          const any = pending.size > 0;
          for (const video of [...pending.keys()]) interrupt(video);
          return any;
        },
        async advancing(key: string) {
          const { video } = state.get(key)!;
          if (video.paused || video.readyState < 2) return false;
          const at = video.currentTime;
          await new Promise((resolve) => setTimeout(resolve, 300));
          return video.currentTime !== at;
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
            seekGap: data.seekGap,
            interrupted: data.interrupted,
            pixels,
            currentSrc: video.currentSrc,
            loads: Number(video.dataset.loads ?? 0),
            ours: Number(video.dataset.ours ?? 0),
            resets: Number(video.dataset.resets ?? 0),
            failedWithCors: [...failed],
          };
        },
      },
    });
  });
}

type Table = {
  create: (key: string, sources: SourceAttrs[]) => void;
  edit: (key: string, step: object) => void;
  settled: () => boolean;
  flush: () => boolean;
  keys: () => string[];
  advancing: (key: string) => Promise<boolean>;
  read: (key: string) => Seen;
};
declare global {
  interface Window {
    __table: Table;
  }
}

async function runAll(frame: Frame, sequences: Sequence[], run: string) {
  const rounds = Math.max(...sequences.map((s) => s.rounds.length));
  for (let round = 0; round < rounds; round++) {
    for (const [index, sequence] of sequences.entries()) {
      for (const step of sequence.rounds[round] ?? []) {
        const key = `${index}-${step.el}`;
        if (step.do === "create")
          await frame.evaluate(
            (k, s) => window.__table.create(k, s),
            key,
            step.sources.map((source) => urlFor(source, run)),
          );
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
  }
}

const describe = (sequence: Sequence) =>
  sequence.rounds
    .map((steps) =>
      steps
        .map((step) => {
          const listed = "sources" in step ? step.sources : "source" in step ? [step.source] : [];
          const what = step.do === "interrupt" ? ` ${step.action}` : "";
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
      const [seen, moves] = await Promise.all([
        frame.evaluate((k) => window.__table.read(k), key),
        frame.evaluate((k) => window.__table.advancing(k), key),
      ]);
      readings.set(key, { ...seen, moves });
    }),
  );
  return readings;
}
const idOf = (src: string) => (src ? new URL(src).searchParams.get("id")!.slice(2) : "");
// One frame at 30 fps, with room for the timer that reads it.
const FRAME = 1 / 30 + 0.01;

function history(sequence: Sequence) {
  const lists = new Map<number, Source[]>();
  const everListed = new Map<number, Map<string, Kind>>();
  const authored = new Map<number, string>();
  for (const steps of sequence.rounds)
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

// Per element, against the unsealed film: the same source, playing state and moving playhead; after a load of ours
// while it played, it resumes where it was at the same rate. Pixels readable wherever the unsealed film reads them
// from a source that sends CORS, except the known gap.
function judge(sequences: Sequence[], sealed: Readings, control: Readings) {
  const budget = new Map<string, number>();
  const gaps: string[] = [];
  const all = sequences.map((sequence, index) => {
    const { lists, everListed, authored } = history(sequence);
    const problems: string[] = [];
    for (const [el, list] of lists) {
      const key = `${index}-${el}`;
      const seen = sealed.get(key)!;
      const plain = control.get(key)!;
      const { moves } = seen;
      const movesPlain = plain.moves;
      const where = `${sequence.name} (${describe(sequence)}), element ${el}`;
      const kinds = everListed.get(el)!;
      const selections = seen.loads - seen.ours;
      for (const id of kinds.keys()) budget.set(id, (budget.get(id) ?? 0) + 2 * selections);
      if (seen.ours > selections)
        problems.push(`${where}: ${seen.ours} loads of ours for ${selections} other selections`);
      const most = 2 * kinds.size * (seen.resets + 1);
      if (seen.ours > most)
        problems.push(
          `${where}: ${seen.ours} loads of ours, at most ${most} (${seen.resets} resets)`,
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
      if (!variable) {
        if (idOf(seen.currentSrc) !== idOf(plain.currentSrc))
          problems.push(
            `${where}: plays ${idOf(seen.currentSrc)}, unsealed ${idOf(plain.currentSrc)}`,
          );
        if (seen.playing !== plain.playing || seen.paused !== plain.paused)
          problems.push(`${where}: ${JSON.stringify(seen)}, unsealed ${JSON.stringify(plain)}`);
        if (movesPlain && !moves)
          problems.push(`${where}: the playhead stopped ${JSON.stringify(seen)}`);
      }
      const action = seen.interrupted;
      if (action === "pause" && !seen.paused)
        problems.push(`${where}: plays after the composition paused it`);
      if (action === "rate" && seen.rate !== 2)
        problems.push(`${where}: rate ${seen.rate}, set to 2`);
      if (action === "seek" && !(Number(seen.seekGap ?? 1) <= FRAME))
        problems.push(`${where}: resumed ${seen.seekGap} s off the composition's seek`);
      if (seen.savedRate !== undefined && !action && !variable && movesPlain) {
        if (!(Number(seen.restartGap ?? 1) <= FRAME))
          problems.push(`${where}: after our load it resumed ${seen.restartGap ?? "never"} s off`);
        else if (seen.restartRate !== seen.savedRate)
          problems.push(`${where}: rate ${seen.restartRate} after our load, was ${seen.savedRate}`);
      }
      const canPlay =
        list.some((s) => PLAYABLE.has(s.kind)) || Boolean(sequence.keepsCors?.includes(el));
      const mayPlay = canPlay || list.some((s) => MAY_PLAY.has(s.kind));
      if (seen.playing ? !mayPlay : canPlay)
        problems.push(`${where}: ${canPlay ? "does not play" : "plays"} ${JSON.stringify(seen)}`);
      if (!seen.playing) continue;
      const kind = kinds.get(idOf(seen.currentSrc))!;
      const readable =
        plain.pixels === "readable" &&
        SENDS_CORS.has(kind) &&
        (sequence.keepsCors?.includes(el) || !seen.failedWithCors.includes(seen.currentSrc));
      if (!readable || seen.pixels === "readable") continue;
      const line = `${where}: plays ${idOf(seen.currentSrc)} unreadable ${JSON.stringify(seen)}`;
      if (mixed(list) && !foreign(kind)) gaps.push(line);
      else problems.push(line);
    }
    return problems;
  });
  return { problems: all.flat(), gaps, budget };
}

async function filmFrame(page: import("puppeteer-core").Page, query: string) {
  await page.goto(`${server.origin}/host.html?fixture=10-video-grid${query}`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForFunction(() => window.__playerReady || window.__playerError, {
    timeout: 60_000,
  });
  const frame = page.frames().find((candidate) => candidate.url().includes("/10-video-grid/"));
  assert.ok(frame, "the film's frame must load");
  return frame;
}

const browser = await launchBrowser();
try {
  const page = await browser.newPage();
  const seeds = Number(process.env.SEALED_MEDIA_SEEDS ?? 40);
  const sequences = [...FIXED, ...Array.from({ length: seeds }, (_, seed) => generated(seed + 1))];
  const run = async (query: string, prefix: string) => {
    const frame = await filmFrame(page, query);
    await installDriver(frame);
    await runAll(frame, sequences, prefix);
    return readAll(frame);
  };
  const control = await run("", "c");
  const sealed = await run("&sealed=1", "s");
  const { problems, gaps, budget } = judge(sequences, sealed, control);
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
  console.log("[sealed-media-table] every element matches the unsealed film");
} finally {
  await browser.close();
  await server.stop();
}
