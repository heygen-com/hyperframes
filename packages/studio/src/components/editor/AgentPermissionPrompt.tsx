import type { AgentJob, PermissionOption } from "./agentGlyphs";

/**
 * The question a run stopped to ask, and the ways to answer it.
 *
 * Every word here is the agent's: its title for what it wants to do, and its
 * own labels for the choices. Studio writing its own — "Allow once", "Always
 * allow" — would describe a decision the agent is not actually offering, and
 * the ids behind those labels are what gets sent back.
 *
 * Ways of saying no are drawn apart from ways of saying yes, so a fast click
 * lands where the user meant. Nothing is pre-selected and nothing is default:
 * the run stays parked until somebody chooses.
 */
export function AgentPermissionPrompt({
  job,
  onAnswer,
}: {
  job: AgentJob;
  onAnswer: (jobId: string, optionId: string) => void;
}) {
  if (job.status !== "awaiting-permission" || !job.permission) return null;
  const { tool, options } = job.permission;

  return (
    <div
      data-agent-permission="true"
      className="mt-1.5 rounded-lg border border-amber-400/25 bg-amber-400/[0.06] p-1.5"
      role="group"
      aria-label={`${job.label} is asking to ${tool}`}
    >
      <p className="px-0.5 pb-1.5 text-[10px] leading-snug text-amber-200/90">
        <span className="text-amber-200">{job.label}</span> wants to {tool}
      </p>
      <div className="flex flex-wrap gap-1">
        {options.map((option) => (
          <button
            key={option.optionId}
            className={optionClass(option)}
            onClick={() => onAnswer(job.id, option.optionId)}
          >
            {option.name}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Refusals read as the quiet option; allowing is the one that acts. */
function optionClass(option: PermissionOption): string {
  const base =
    "rounded-md px-1.5 py-1 text-[10px] leading-none transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40";
  return option.kind?.startsWith("reject")
    ? `${base} border border-white/10 text-neutral-400 hover:bg-white/5 hover:text-neutral-200`
    : `${base} border border-amber-400/30 bg-amber-400/10 text-amber-100 hover:bg-amber-400/20`;
}
