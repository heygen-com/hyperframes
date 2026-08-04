/** Mirrors the server's AgentKind — the harness whose mark Studio shows. */
export type AgentKind = "claude" | "codex" | "hermes" | "openclaw" | "custom";

export interface AgentOption {
  kind: AgentKind;
  label: string;
  available: boolean;
}

export interface AgentTargetRef {
  sourceFile?: string;
  id?: string;
  selector?: string;
  selectorIndex?: number;
  time?: number;
}

export interface AgentJob {
  id: string;
  kind: AgentKind;
  label: string;
  target: string;
  targetRef?: AgentTargetRef;
  sessionId?: string;
  instruction: string;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  activity: string;
  message?: string;
  startedAt: number;
  endedAt?: number;
}

/*
 * Each harness' own mark, taken from the vendor's own asset so a run is
 * identifiable at a glance:
 *   claude   — claude.ai/favicon.svg
 *   codex    — the OpenAI mark (simple-icons `openai`)
 *   openclaw — docs.openclaw.ai/assets/openclaw.svg, flattened to one fill
 *   hermes   — hermes-agent.nousresearch.com ships the caduceus glyph itself
 * A harness with no preset renders a neutral spark, or the file pointed at by
 * HYPERFRAMES_AGENT_ICON.
 */
const CLAUDE_PATH =
  "M52.4285 162.873L98.7844 136.879L99.5485 134.602L98.7844 133.334H96.4921L88.7237 132.862L62.2346 132.153L39.3113 131.207L17.0249 130.026L11.4214 128.844L6.2 121.873L6.7094 118.447L11.4214 115.257L18.171 115.847L33.0711 116.911L55.485 118.447L71.6586 119.392L95.728 121.873H99.5485L100.058 120.337L98.7844 119.392L97.7656 118.447L74.5877 102.732L49.4995 86.1905L36.3823 76.62L29.3779 71.7757L25.8121 67.2858L24.2839 57.3608L30.6515 50.2716L39.3113 50.8623L41.4763 51.4531L50.2636 58.1879L68.9842 72.7209L93.4357 90.6804L97.0015 93.6343L98.4374 92.6652L98.6571 91.9801L97.0015 89.2625L83.757 65.2772L69.621 40.8192L63.2534 30.6579L61.5978 24.632C60.9565 22.1032 60.579 20.0111 60.579 17.4246L67.8381 7.49965L71.9133 6.19995L81.7193 7.49965L85.7946 11.0443L91.9074 24.9865L101.714 46.8451L116.996 76.62L121.453 85.4816L123.873 93.6343L124.764 96.1155H126.292V94.6976L127.566 77.9197L129.858 57.3608L132.15 30.8942L132.915 23.4505L136.608 14.4708L143.994 9.62643L149.725 12.344L154.437 19.0788L153.8 23.4505L150.998 41.6463L145.522 70.1215L141.957 89.2625H143.994L146.414 86.7813L156.093 74.0206L172.266 53.698L179.398 45.6635L187.803 36.802L193.152 32.5484H203.34L210.726 43.6549L207.415 55.1159L196.972 68.3492L188.312 79.5739L175.896 96.2095L168.191 109.585L168.882 110.689L170.738 110.53L198.755 104.504L213.91 101.787L231.994 98.7149L240.144 102.496L241.036 106.395L237.852 114.311L218.495 119.037L195.826 123.645L162.07 131.592L161.696 131.893L162.137 132.547L177.36 133.925L183.855 134.279H199.774L229.447 136.524L237.215 141.605L241.8 147.867L241.036 152.711L229.065 158.737L213.019 154.956L175.45 145.977L162.587 142.787H160.805V143.85L171.502 154.366L191.242 172.089L215.82 195.011L217.094 200.682L213.91 205.172L210.599 204.699L188.949 188.394L180.544 181.069L161.696 165.118H160.422V166.772L164.752 173.152L187.803 207.771L188.949 218.405L187.294 221.832L181.308 223.959L174.813 222.777L161.187 203.754L147.305 182.486L136.098 163.345L134.745 164.2L128.075 235.42L125.019 239.082L117.887 241.8L111.902 237.31L108.718 229.984L111.902 215.452L115.722 196.547L118.779 181.541L121.58 162.873L123.291 156.636L123.14 156.219L121.773 156.449L107.699 175.752L86.304 204.699L69.3663 222.777L65.291 224.431L58.2867 220.768L58.9235 214.27L62.8713 208.48L86.304 178.705L100.44 160.155L109.551 149.507L109.462 147.967L108.959 147.924L46.6977 188.512L35.6182 189.93L30.7788 185.44L31.4156 178.115L33.7079 175.752L52.4285 162.873Z";

const OPENAI_PATH =
  "M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z";

const OPENCLAW_PATHS = [
  "M60 10 C30 10 15 35 15 55 C15 75 30 95 45 100 L45 110 L55 110 L55 100 C55 100 60 102 65 100 L65 110 L75 110 L75 100 C90 95 105 75 105 55 C105 35 90 10 60 10Z",
  "M20 45 C5 40 0 50 5 60 C10 70 20 65 25 55 C28 48 25 45 20 45Z",
  "M100 45 C115 40 120 50 115 60 C110 70 100 65 95 55 C92 48 95 45 100 45Z",
];

const OPENCLAW_ANTENNAE = ["M45 15 Q35 5 30 8", "M75 15 Q85 5 90 8"];

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
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        className="shrink-0 text-neutral-200"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d={OPENAI_PATH} />
      </svg>
    );
  }

  if (kind === "openclaw") {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 120 120"
        className="shrink-0"
        fill="none"
        aria-hidden="true"
      >
        {OPENCLAW_PATHS.map((d) => (
          <path key={d} d={d} fill="#ff4d4d" />
        ))}
        {OPENCLAW_ANTENNAE.map((d) => (
          <path key={d} d={d} stroke="#ff4d4d" strokeWidth="6" strokeLinecap="round" />
        ))}
      </svg>
    );
  }

  if (kind === "hermes") {
    // Their own favicon is the caduceus character; keep it as type so it stays
    // crisp at 10-12px instead of becoming a traced blob.
    return (
      <span
        aria-hidden="true"
        className="flex shrink-0 items-center justify-center leading-none text-violet-300"
        style={{ width: size, height: size, fontSize: size * 1.15 }}
      >
        &#9877;
      </span>
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
