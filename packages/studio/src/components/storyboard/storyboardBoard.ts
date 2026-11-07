// Read the way HyperFrames Desktop's Storyboard tab reads the page, so a board one shows is a board the other shows.

/** Where the page may sit, in the order a copy wins: the project root, then boards/. */
const BOARD_DIRS = ["", "boards/"];
const BOARD_FILE = "storyboard.html";
const PLAN_FILE = "storyboard.md";

export function findBoardFile(files: readonly string[]): string | null {
  for (const dir of BOARD_DIRS) {
    const found = files.find((path) => path.toLowerCase() === dir + BOARD_FILE);
    if (found) return found;
  }
  return null;
}

const folderOf = (path: string): string => path.slice(0, path.lastIndexOf("/") + 1);

/** Whether a write to `changed` changes what the board at `board` shows: the page, anything beside it, a still
 * it draws (`stills`, as project paths), or the plan. */
export function touchesBoard(
  changed: string,
  board: string,
  stills: ReadonlySet<string> = new Set(),
): boolean {
  const path = changed.replace(/\\/g, "/").replace(/^\.\//, "");
  if (path === board || path.toLowerCase() === PLAN_FILE || stills.has(path)) return true;
  const folder = folderOf(board);
  return folder !== "" && path.startsWith(folder);
}

/** A still's project path, from its `src` as the page wrote it; null for one that is not a project file. */
export function stillPath(board: string, src: string): string | null {
  if (!src || /^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith("//")) return null;
  const clean = src.split(/[?#]/)[0] ?? "";
  const parts = (clean.startsWith("/") ? clean.slice(1) : folderOf(board) + clean).split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (!out.length) return null;
      out.pop();
    } else out.push(part);
  }
  return out.length ? out.map(safeDecode).join("/") : null;
}

const safeDecode = (part: string): string => {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
};

export interface BoardFrame {
  number: string;
  title: string;
  act: string;
  /** Its range as "a to b" ("0.0 to 3.0s"), or "". */
  time: string;
  still: string;
  words: string;
}

const TIME = /\d+(?:[.:]\d+)?\s*s?\s*[–-]\s*\d+(?:[.:]\d+)?\s*s?/;
// "01 — The dial", "00a · Cold open — the line": a frame's number, then its name.
const NUMBERED = /^\s*(\d{1,3}[a-z]?)\s*[—–·.:-]\s*(.+)$/;
const NOTE_PLACES = [".desc", ".description", ".caption", ".note", ".words", "p"];

const text = (el: Element | null | undefined): string =>
  (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const tidy = (words: string): string =>
  words
    .replace(TIME, "")
    .replace(/[\s·—–:-]+$/, "")
    .trim();
const pad = (n: number): string => String(n).padStart(2, "0");

/** The `class="frame"` boxes the page draws, in order; a frame nested in another is part of it. */
export function readBoardFrames(doc: Document): BoardFrame[] {
  const boxes = [...doc.querySelectorAll<HTMLElement>(".frame")].filter(
    (el) => !el.parentElement?.closest(".frame"),
  );
  return boxes.map((el, i) => frameInfo(doc, el, i));
}

/** The frame's own box: its highest ancestor holding no other frame (a scene card, a contact-sheet cell). */
function ownBox(el: HTMLElement): HTMLElement {
  let box = el;
  while (box.parentElement && box.parentElement !== el.ownerDocument.body) {
    if (box.parentElement.querySelectorAll(".frame").length > 1) break;
    box = box.parentElement;
  }
  return box;
}

function frameInfo(doc: Document, el: HTMLElement, i: number): BoardFrame {
  const box = ownBox(el);
  const heading = box.querySelector(".scene-title, .label, [class*='title']");
  const first = heading?.firstElementChild ? text(heading.firstElementChild) : text(heading);
  const named = NUMBERED.exec(tidy(first));
  return {
    number: named?.[1] ?? badgeNumber(box) ?? pad(i + 1),
    title: named?.[2]?.trim() ?? tidy(first),
    act: actBefore(doc, el),
    time: timeOf(box, heading),
    still: el.querySelector("img")?.getAttribute("src") ?? "",
    // First by this order, not the page's: a .words box can hold the title and time before its .note.
    words: text(NOTE_PLACES.map((place) => box.querySelector(place)).find(Boolean)),
  };
}

function timeOf(box: HTMLElement, heading: Element | null): string {
  const raw = text(box.querySelector(".time")) || (text(heading).match(TIME)?.[0] ?? "");
  return raw.replace(/\s*[\u2013-]\s*/, " to ");
}

function badgeNumber(box: HTMLElement): string | undefined {
  const badge = /\d+/.exec(text(box.querySelector(".scene-badge")))?.[0];
  return badge === undefined ? undefined : pad(Number(badge));
}

/** The act heading last before the frame, by its own words (not the times beside them). */
function actBefore(doc: Document, el: HTMLElement): string {
  const acts = [...doc.querySelectorAll(".actbar, .act, [class*='act-bar']")].filter(
    (act) => act.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
  const act = acts.at(-1);
  if (!act) return "";
  const own = [...act.childNodes]
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return tidy(own || text(act));
}

/** The frames in their acts, in film order; frames before any act heading share one untitled group. */
export function groupByAct(frames: readonly BoardFrame[]): { act: string; frames: BoardFrame[] }[] {
  const groups: { act: string; frames: BoardFrame[] }[] = [];
  for (const frame of frames) {
    const last = groups.at(-1);
    if (last && last.act === frame.act) last.frames.push(frame);
    else groups.push({ act: frame.act, frames: [frame] });
  }
  return groups;
}
