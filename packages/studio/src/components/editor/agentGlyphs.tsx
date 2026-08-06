import { HERMES_MARK_DATA_URI } from "./agentMarkAssets";
import type { OverlayState } from "./overlayState";

/** Mirrors the server's AgentKind — the harness whose mark Studio shows. */
export type AgentKind = "claude" | "codex" | "hermes" | "openclaw" | "custom";

export interface AgentOption {
  /** Built-in kind, or a custom harness' own id. */
  id: string;
  kind: AgentKind;
  label: string;
  available: boolean;
  /** A mark the harness supplied, served by the studio server. */
  iconUrl?: string | null;
}

/** The fields a user-registered harness carries — the presets' own shape. */
export interface CustomAgentDraft {
  label: string;
  command: string;
  args: string[];
  icon?: string;
  modelFlag?: string;
}

export interface AgentTargetRef {
  sourceFile?: string;
  id?: string;
  selector?: string;
  selectorIndex?: number;
  time?: number;
}

export interface AgentModel {
  id: string;
  name: string;
  /** Reasoning levels the model accepts, lowest first. */
  effortOptions?: string[];
  inputCost?: number;
  outputCost?: number;
  contextWindow?: number;
}

/** One thing the agent will do if allowed, in the agent's own words. */
export interface PermissionOption {
  optionId: string;
  name: string;
  kind?: "allow_once" | "allow_always" | "reject_once" | "reject_always";
}

export interface AgentJob {
  id: string;
  kind: AgentKind;
  label: string;
  target: string;
  targetRef?: AgentTargetRef;
  /** The rest of a multi-selection this run covers. */
  targetRefs?: AgentTargetRef[];
  /** What the target is: one element, or a stretch of the timeline. */
  targetKind?: "element" | "range";
  /** Corrections sent after the run was asked for, oldest first. */
  steers?: string[];
  model?: string;
  effort?: string;
  sessionId?: string;
  instruction: string;
  status: "queued" | "running" | "awaiting-permission" | "done" | "failed" | "cancelled";
  /** What the run stopped to ask, while it is waiting for an answer. */
  permission?: { tool: string; options: PermissionOption[] };
  activity: string;
  /** What the agent declared the selection overlay should show. See overlayState. */
  overlay?: OverlayState;
  message?: string;
  startedAt: number;
  endedAt?: number;
}

/** One gradient definition id for every Codex mark on the page. */
const CODEX_GRADIENT_ID = "hf-codex-mark";

/*
 * Each harness' own mark, taken from the vendor's own asset so a run is
 * identifiable at a glance:
 *   claude   — claude.ai/favicon.svg
 *   codex    — Codex's own app icon (its gradient mark, plate dropped, glyph kept white)
 *   openclaw — openclaw/openclaw docs/assets/pixel-lobster.svg (their current mark)
 *   hermes   — the Nous Research portrait its docs ship as a logo (see agentMarkAssets)
 * A harness with no preset renders a neutral spark, or the file pointed at by
 * HYPERFRAMES_AGENT_ICON.
 */
const CLAUDE_PATH =
  "M52.4285 162.873L98.7844 136.879L99.5485 134.602L98.7844 133.334H96.4921L88.7237 132.862L62.2346 132.153L39.3113 131.207L17.0249 130.026L11.4214 128.844L6.2 121.873L6.7094 118.447L11.4214 115.257L18.171 115.847L33.0711 116.911L55.485 118.447L71.6586 119.392L95.728 121.873H99.5485L100.058 120.337L98.7844 119.392L97.7656 118.447L74.5877 102.732L49.4995 86.1905L36.3823 76.62L29.3779 71.7757L25.8121 67.2858L24.2839 57.3608L30.6515 50.2716L39.3113 50.8623L41.4763 51.4531L50.2636 58.1879L68.9842 72.7209L93.4357 90.6804L97.0015 93.6343L98.4374 92.6652L98.6571 91.9801L97.0015 89.2625L83.757 65.2772L69.621 40.8192L63.2534 30.6579L61.5978 24.632C60.9565 22.1032 60.579 20.0111 60.579 17.4246L67.8381 7.49965L71.9133 6.19995L81.7193 7.49965L85.7946 11.0443L91.9074 24.9865L101.714 46.8451L116.996 76.62L121.453 85.4816L123.873 93.6343L124.764 96.1155H126.292V94.6976L127.566 77.9197L129.858 57.3608L132.15 30.8942L132.915 23.4505L136.608 14.4708L143.994 9.62643L149.725 12.344L154.437 19.0788L153.8 23.4505L150.998 41.6463L145.522 70.1215L141.957 89.2625H143.994L146.414 86.7813L156.093 74.0206L172.266 53.698L179.398 45.6635L187.803 36.802L193.152 32.5484H203.34L210.726 43.6549L207.415 55.1159L196.972 68.3492L188.312 79.5739L175.896 96.2095L168.191 109.585L168.882 110.689L170.738 110.53L198.755 104.504L213.91 101.787L231.994 98.7149L240.144 102.496L241.036 106.395L237.852 114.311L218.495 119.037L195.826 123.645L162.07 131.592L161.696 131.893L162.137 132.547L177.36 133.925L183.855 134.279H199.774L229.447 136.524L237.215 141.605L241.8 147.867L241.036 152.711L229.065 158.737L213.019 154.956L175.45 145.977L162.587 142.787H160.805V143.85L171.502 154.366L191.242 172.089L215.82 195.011L217.094 200.682L213.91 205.172L210.599 204.699L188.949 188.394L180.544 181.069L161.696 165.118H160.422V166.772L164.752 173.152L187.803 207.771L188.949 218.405L187.294 221.832L181.308 223.959L174.813 222.777L161.187 203.754L147.305 182.486L136.098 163.345L134.745 164.2L128.075 235.42L125.019 239.082L117.887 241.8L111.902 237.31L108.718 229.984L111.902 215.452L115.722 196.547L118.779 181.541L121.58 162.873L123.291 156.636L123.14 156.219L121.773 156.449L107.699 175.752L86.304 204.699L69.3663 222.777L65.291 224.431L58.2867 220.768L58.9235 214.27L62.8713 208.48L86.304 178.705L100.44 160.155L109.551 149.507L109.462 147.967L108.959 147.924L46.6977 188.512L35.6182 189.93L30.7788 185.44L31.4156 178.115L33.7079 175.752L52.4285 162.873Z";

const CODEX_MARK_PATH =
  "M9.064 3.344a4.578 4.578 0 012.285-.312c1 .115 1.891.54 2.673 1.275.01.01.024.017.037.021a.09.09 0 00.043 0 4.55 4.55 0 013.046.275l.047.022.116.057a4.581 4.581 0 012.188 2.399c.209.51.313 1.041.315 1.595a4.24 4.24 0 01-.134 1.223.123.123 0 00.03.115c.594.607.988 1.33 1.183 2.17.289 1.425-.007 2.71-.887 3.854l-.136.166a4.548 4.548 0 01-2.201 1.388.123.123 0 00-.081.076c-.191.551-.383 1.023-.74 1.494-.9 1.187-2.222 1.846-3.711 1.838-1.187-.006-2.239-.44-3.157-1.302a.107.107 0 00-.105-.024c-.388.125-.78.143-1.204.138a4.441 4.441 0 01-1.945-.466 4.544 4.544 0 01-1.61-1.335c-.152-.202-.303-.392-.414-.617a5.81 5.81 0 01-.37-.961 4.582 4.582 0 01-.014-2.298.124.124 0 00.006-.056.085.085 0 00-.027-.048 4.467 4.467 0 01-1.034-1.651 3.896 3.896 0 01-.251-1.192 5.189 5.189 0 01.141-1.6c.337-1.112.982-1.985 1.933-2.618.212-.141.413-.251.601-.33.215-.089.43-.164.646-.227a.098.098 0 00.065-.066 4.51 4.51 0 01.829-1.615 4.535 4.535 0 011.837-1.388zm3.482 10.565a.637.637 0 000 1.272h3.636a.637.637 0 100-1.272h-3.636zM8.462 9.23a.637.637 0 00-1.106.631l1.272 2.224-1.266 2.136a.636.636 0 101.095.649l1.454-2.455a.636.636 0 00.005-.64L8.462 9.23z";

/**
 * The chevron and dash inside the Codex mark. They are cut out of the mark path
 * itself, so without the app icon's plate behind them they would show whatever
 * the row is painted on. Drawn on top in white, they read as the icon does in
 * the dock, on any background.
 */
const CODEX_GLYPH_PATH =
  "M12.546 13.909a.637.637 0 000 1.272h3.636a.637.637 0 100-1.272h-3.636zM8.462 9.23a.637.637 0 00-1.106.631l1.272 2.224-1.266 2.136a.636.636 0 101.095.649l1.454-2.455a.636.636 0 00.005-.64L8.462 9.23z";

const OPENCLAW_PIXELS: Array<{ fill: string; rects: number[][] }> = [
  {
    fill: "#3a0a0d",
    rects: [
      [1, 5, 1, 3],
      [2, 4, 1, 1],
      [2, 8, 1, 1],
      [3, 3, 1, 1],
      [3, 9, 1, 1],
      [4, 2, 1, 1],
      [4, 10, 1, 1],
      [5, 2, 6, 1],
      [11, 2, 1, 1],
      [12, 3, 1, 1],
      [12, 9, 1, 1],
      [13, 4, 1, 1],
      [13, 8, 1, 1],
      [14, 5, 1, 3],
      [5, 11, 6, 1],
      [4, 12, 1, 1],
      [11, 12, 1, 1],
      [3, 13, 1, 1],
      [12, 13, 1, 1],
      [5, 14, 6, 1],
    ],
  },
  {
    fill: "#ff4f40",
    rects: [
      [5, 3, 6, 1],
      [4, 4, 8, 1],
      [3, 5, 10, 1],
      [3, 6, 10, 1],
      [3, 7, 10, 1],
      [4, 8, 8, 1],
      [5, 9, 6, 1],
      [5, 12, 6, 1],
      [6, 13, 4, 1],
    ],
  },
  {
    fill: "#ff775f",
    rects: [
      [1, 6, 2, 1],
      [2, 5, 1, 1],
      [2, 7, 1, 1],
      [13, 6, 2, 1],
      [13, 5, 1, 1],
      [13, 7, 1, 1],
    ],
  },
  {
    fill: "#081016",
    rects: [
      [6, 5, 1, 1],
      [9, 5, 1, 1],
    ],
  },
  {
    fill: "#f5fbff",
    rects: [
      [6, 4, 1, 1],
      [9, 4, 1, 1],
    ],
  },
];

export function AgentGlyph({
  kind,
  size = 12,
  iconUrl,
}: {
  kind: AgentKind;
  size?: number;
  /** A real logo supplied by the user for this harness; wins over the glyph. */
  iconUrl?: string | null;
}) {
  if (iconUrl) {
    return (
      <img
        src={iconUrl}
        width={size}
        height={size}
        alt=""
        aria-hidden="true"
        className="shrink-0 rounded-[3px] object-contain"
      />
    );
  }

  if (kind === "claude") {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 248 248"
        className="shrink-0"
        fill="#d97757"
        aria-hidden="true"
      >
        <path d={CLAUDE_PATH} />
      </svg>
    );
  }

  if (kind === "codex") {
    // Codex's own app icon, minus its white plate: these marks sit on Studio's
    // dark chrome next to other bare glyphs, and a plate would read as a card
    // pasted onto the row rather than as one icon in a set.
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" className="shrink-0" aria-hidden="true">
        <defs>
          <linearGradient
            id={CODEX_GRADIENT_ID}
            gradientUnits="userSpaceOnUse"
            x1="12"
            x2="12"
            y1="3"
            y2="21"
          >
            <stop stopColor="#B1A7FF" />
            <stop offset=".5" stopColor="#7A9DFF" />
            <stop offset="1" stopColor="#3941FF" />
          </linearGradient>
        </defs>
        <path d={CODEX_MARK_PATH} fill={`url(#${CODEX_GRADIENT_ID})`} />
        <path d={CODEX_GLYPH_PATH} fill="#fff" />
      </svg>
    );
  }

  if (kind === "openclaw") {
    // Their current logo is pixel art (docs/assets/pixel-lobster.svg): keep the
    // rects, they stay crisp at 12px where a traced curve would blur.
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 16 16"
        className="shrink-0"
        shapeRendering="crispEdges"
        aria-hidden="true"
      >
        {OPENCLAW_PIXELS.map((layer) =>
          layer.rects.map(([x, y, w, h]) => (
            <rect
              key={`${layer.fill}-${x}-${y}`}
              x={x}
              y={y}
              width={w}
              height={h}
              fill={layer.fill}
            />
          )),
        )}
      </svg>
    );
  }

  if (kind === "hermes") {
    return (
      <img
        src={HERMES_MARK_DATA_URI}
        width={size}
        height={size}
        alt=""
        aria-hidden="true"
        className="shrink-0 rounded-[2px] object-contain"
      />
    );
  }

  // Unknown harness: a neutral spark.
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      className="shrink-0 text-neutral-400"
      aria-hidden="true"
    >
      <path d="M8 3 V13" />
      <path d="M3 8 H13" />
      <path d="M4.8 4.8 L11.2 11.2" />
      <path d="M11.2 4.8 L4.8 11.2" />
    </svg>
  );
}
