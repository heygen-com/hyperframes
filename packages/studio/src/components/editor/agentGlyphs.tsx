/** Mirrors the server's AgentKind — the harness whose mark Studio shows. */
export type AgentKind = "claude" | "codex" | "hermes" | "openclaw" | "custom";

export interface AgentJob {
  id: string;
  kind: AgentKind;
  label: string;
  target: string;
  instruction: string;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  activity: string;
  message?: string;
  startedAt: number;
  endedAt?: number;
}

/**
 * Harness marks. These are our own glyphs, not traced vendor logos: a
 * hand-copied trademark reads as a bad forgery and we would be shipping someone
 * else's mark. Each harness gets a distinct silhouette and hue instead, and any
 * harness can override it with a real asset via HYPERFRAMES_AGENT_ICON — which
 * is also the path for agents with no preset (pi, an in-house wrapper).
 */
const GLYPH_PATHS: Record<Exclude<AgentKind, "claude">, { paths: string[]; className: string }> = {
  // Terminal caret: Codex runs as an exec.
  codex: {
    paths: ["M4 4.5 L7.5 8 L4 11.5", "M9 11.5 H12.5"],
    className: "text-neutral-300",
  },
  // Winged staff: Hermes, the messenger.
  hermes: {
    paths: ["M8 2.5 V13.5", "M8 5.5 L3.5 3.5 L4.5 6.5", "M8 5.5 L12.5 3.5 L11.5 6.5"],
    className: "text-violet-300",
  },
  // Three talons.
  openclaw: {
    paths: ["M4 3 C4 7.5 4.5 10 6 13", "M8 2.5 C8 7.5 8 10 8 13.5", "M12 3 C12 7.5 11.5 10 10 13"],
    className: "text-amber-400",
  },
  // Unknown harness: a neutral spark.
  custom: {
    paths: ["M8 3 V13", "M3 8 H13", "M4.8 4.8 L11.2 11.2", "M11.2 4.8 L4.8 11.2"],
    className: "text-neutral-400",
  },
};

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
    // Eight tapered spokes on 45° steps — the Claude asterisk.
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 16 16"
        className="shrink-0"
        fill="#d97757"
        aria-hidden="true"
      >
        {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
          <path
            key={angle}
            d="M8 1.2 L8.9 6.4 L8 8 L7.1 6.4 Z"
            transform={`rotate(${angle} 8 8)`}
          />
        ))}
      </svg>
    );
  }

  const glyph = GLYPH_PATHS[kind] ?? GLYPH_PATHS.custom;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${glyph.className}`}
      aria-hidden="true"
    >
      {glyph.paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
