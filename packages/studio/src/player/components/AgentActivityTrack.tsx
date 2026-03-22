import { memo } from "react";

const TRACK_H = 20;
const GUTTER = 32;

export interface AgentActivity {
  agentId: string;
  name: string;
  color: string;
  /** Active work periods mapped to VIDEO time (not wall clock) */
  periods: Array<{ start: number; end: number }>;
  /** Element creation events at specific video times */
  events: Array<{ time: number; type: "create" | "modify" }>;
}

interface AgentActivityTrackProps {
  agents: AgentActivity[];
  duration: number;
}

export const AgentActivityTrack = memo(function AgentActivityTrack({ agents, duration }: AgentActivityTrackProps) {
  if (agents.length === 0 || duration <= 0) return null;

  return (
    <div className="border-t border-neutral-800/30">
      {/* Section header */}
      <div className="flex items-center gap-1.5 px-2 py-1 text-[9px] text-neutral-600 font-medium uppercase tracking-wider">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="4" /></svg>
        Agent Activity
      </div>

      {agents.map((agent) => (
        <div
          key={agent.agentId}
          className="relative flex"
          style={{ height: TRACK_H }}
        >
          {/* Gutter: agent name */}
          <div
            className="flex-shrink-0 flex items-center justify-center"
            style={{ width: GUTTER }}
            title={agent.name}
          >
            <div
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: agent.color }}
            />
          </div>

          {/* Lane */}
          <div className="flex-1 relative" style={{ backgroundColor: `${agent.color}06` }}>
            {/* Active work periods */}
            {agent.periods.map((period, i) => {
              const leftPct = (period.start / duration) * 100;
              const widthPct = ((period.end - period.start) / duration) * 100;
              return (
                <div
                  key={`period-${i}`}
                  className="absolute top-1 bottom-1 rounded-sm"
                  style={{
                    left: `${leftPct}%`,
                    width: `${Math.max(widthPct, 0.5)}%`,
                    backgroundColor: `${agent.color}30`,
                    border: `1px solid ${agent.color}20`,
                  }}
                />
              );
            })}

            {/* Events: diamonds for create, circles for modify */}
            {agent.events.map((event, i) => {
              const leftPct = (event.time / duration) * 100;
              return (
                <div
                  key={`event-${i}`}
                  className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2"
                  style={{ left: `${leftPct}%` }}
                >
                  {event.type === "create" ? (
                    <div
                      className="w-2 h-2 rotate-45"
                      style={{ backgroundColor: agent.color }}
                    />
                  ) : (
                    <div
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ backgroundColor: agent.color }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
});
