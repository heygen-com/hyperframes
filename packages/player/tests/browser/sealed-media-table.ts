import assert from "node:assert/strict";

import type { Frame } from "puppeteer-core";

import { launchBrowser } from "../perf/runner.js";
import { startServer } from "../perf/server.js";

/**
 * Seeded sequences of media edits in a sealed film, each media element checked on its own: it plays when one of its
 * sources can; the source it plays keeps CORS unless that source failed with CORS on that element; no loop of loads.
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
  | "unmatched"
  | "down"
  | "outage";
type Source = { id: string; kind: Kind };
type Step =
  | { do: "create"; el: number; sources: Source[] }
  | { do: "prepend" | "append"; el: number; source: Source }
  | { do: "remove"; el: number; index: number }
  | { do: "reverse" | "reload"; el: number }
  | { do: "author"; el: number; value: string; duringRetry?: boolean; replace?: Source };
type Sequence = { name: string; rounds: Step[][]; keepsCors?: number[] };

const KINDS: Kind[] = [
  "cors",
  "nocors",
  "unsupported",
  "missing",
  "flaky",
  "foreignCors",
  "foreignNocors",
  "foreignUnsupported",
  "unmatched",
  "down",
];
// An outage source plays once its host is back; only fixed sequences use it, reloading after the outage.
const PLAYABLE = new Set<Kind>([
  "cors",
  "nocors",
  "flaky",
  "foreignCors",
  "foreignNocors",
  "outage",
]);

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
];

const server = startServer();
const foreignOrigin = server.origin.replace("127.0.0.1", "localhost");

type SourceAttrs = { src: string; type?: string; media?: string };

function urlFor(source: Source): SourceAttrs {
  const query = `?id=${source.id}&no-store`;
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
  pixels: string;
  currentSrc: string;
  loads: number;
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
    const sourceEl = (src: { src: string; type?: string; media?: string }) => {
      const el = document.createElement("source");
      el.src = src.src;
      if (src.type) el.type = src.type;
      if (src.media) el.media = src.media;
      return el;
    };
    Object.assign(window, {
      __table: {
        create(key: string, sources: Array<{ src: string; type?: string; media?: string }>) {
          const video = document.createElement("video");
          video.dataset.table = key;
          video.muted = true;
          video.preload = "auto";
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
          },
        ) {
          const { video } = state.get(key)!;
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
          return {
            crossOrigin: video.getAttribute("crossorigin"),
            playing: video.readyState >= 2,
            pixels,
            currentSrc: video.currentSrc,
            loads: Number(video.dataset.loads ?? 0),
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
  read: (key: string) => Seen;
};
declare global {
  interface Window {
    __table: Table;
  }
}

async function runAll(frame: Frame, sequences: Sequence[]) {
  const rounds = Math.max(...sequences.map((s) => s.rounds.length));
  for (let round = 0; round < rounds; round++) {
    for (const [index, sequence] of sequences.entries()) {
      for (const step of sequence.rounds[round] ?? []) {
        const key = `${index}-${step.el}`;
        if (step.do === "create")
          await frame.evaluate(
            (k, s) => window.__table.create(k, s),
            key,
            step.sources.map(urlFor),
          );
        else {
          const listed =
            "source" in step ? step.source : step.do === "author" ? step.replace : undefined;
          const src = listed && urlFor(listed);
          await frame.evaluate((k, s) => window.__table.edit(k, s), key, { ...step, src });
        }
      }
    }
    await frame
      .waitForFunction(() => window.__table.settled(), { timeout: 20_000, polling: 100 })
      .catch(() => undefined);
  }
}

/** Each selection may fetch every source it lists at most twice: once with CORS, once without. */
function requestBudget(sequences: Sequence[]) {
  const budget = new Map<string, number>();
  for (const sequence of sequences) {
    const lists = new Map<number, Source[]>();
    for (const steps of sequence.rounds)
      for (const step of steps) {
        const list = lists.get(step.el) ?? [];
        if (step.do === "create") lists.set(step.el, [...step.sources]);
        else if (step.do === "prepend" || step.do === "append")
          lists.set(step.el, [...list, step.source]);
        if (step.do === "author" && step.duringRetry) continue;
        for (const source of lists.get(step.el)!)
          budget.set(source.id, (budget.get(source.id) ?? 0) + 2);
      }
  }
  return budget;
}

function judge(sequences: Sequence[], frame: Frame) {
  return Promise.all(
    sequences.map(async (sequence, index) => {
      const lists = new Map<number, Source[]>();
      const selections = new Map<number, number>();
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
          if (step.do === "author") authored.set(step.el, step.value);
          if (!(step.do === "author" && step.duringRetry))
            selections.set(step.el, (selections.get(step.el) ?? 0) + 1);
        }
      const problems: string[] = [];
      for (const [el, list] of lists) {
        const seen = await frame.evaluate((k) => window.__table.read(k), `${index}-${el}`);
        const where = `${sequence.name}, element ${el} [${list.map((s) => s.kind).join(", ")}]`;
        const bound = 2 * selections.get(el)!;
        if (seen.loads > bound)
          problems.push(`${where}: ${seen.loads} loads for ${bound / 2} selections`);
        const value = authored.get(el);
        if (value !== undefined) {
          if (seen.crossOrigin !== value)
            problems.push(`${where}: the composition's ${value} became ${seen.crossOrigin}`);
          continue;
        }
        const canPlay = list.some((s) => PLAYABLE.has(s.kind));
        if (seen.playing !== canPlay)
          problems.push(`${where}: ${canPlay ? "does not play" : "plays"} ${JSON.stringify(seen)}`);
        if (!seen.playing) continue;
        // As in unsealed Studio, only the preview's own host is read with CORS; another host plays as authored.
        if (new URL(seen.currentSrc).origin !== server.origin) continue;
        const keepsCors =
          sequence.keepsCors?.includes(el) || !seen.failedWithCors.includes(seen.currentSrc);
        if (keepsCors && (seen.crossOrigin !== "anonymous" || seen.pixels !== "readable"))
          problems.push(
            `${where}: plays ${seen.currentSrc.split("?")[1]} without CORS ${JSON.stringify(seen)}`,
          );
      }
      return problems;
    }),
  ).then((all) => all.flat());
}

const browser = await launchBrowser();
try {
  const page = await browser.newPage();
  await page.goto(`${server.origin}/host.html?fixture=10-video-grid&sealed=1`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForFunction(() => window.__playerReady || window.__playerError, {
    timeout: 60_000,
  });
  const frame = page.frames().find((candidate) => candidate.url().includes("/10-video-grid/"));
  assert.ok(frame, "the film's frame must load");
  await installDriver(frame);
  const seeds = Number(process.env.SEALED_MEDIA_SEEDS ?? 40);
  const sequences = [...FIXED, ...Array.from({ length: seeds }, (_, seed) => generated(seed + 1))];
  await runAll(frame, sequences);
  const problems = await judge(sequences, frame);
  const requests = new Map<string, number>();
  for (const url of server.requested) {
    const id = new URL(url).searchParams.get("id");
    if (id) requests.set(id, (requests.get(id) ?? 0) + 1);
  }
  for (const [id, budget] of requestBudget(sequences)) {
    const asked = requests.get(id) ?? 0;
    if (asked > budget)
      problems.push(`source ${id}: ${asked} requests, at most ${budget} expected`);
  }
  console.log(`[sealed-media-table] ${sequences.length} sequences, ${problems.length} problems`);
  assert.deepEqual(problems, [], problems.join("\n"));
  console.log(
    "[sealed-media-table] every element plays when it can and keeps CORS unless it failed with it",
  );
} finally {
  await browser.close();
  await server.stop();
}
