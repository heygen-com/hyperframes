import { HyperframesPlayer, type HyperframesPlayerHandle } from "@hyperframes/player/react";
import { useRef, useState } from "react";

const COMPOSITION_SRC = "/composition/index.html";
const RATES = [0.5, 1, 1.5, 2];
const MAX_LOG_ENTRIES = 12;

type LogEntry = { id: number; label: string };

let nextLogId = 0;

export function App() {
  const player = useRef<HyperframesPlayerHandle>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [muted, setMuted] = useState(false);
  const [loop, setLoop] = useState(false);
  const [nativeControls, setNativeControls] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);

  const logEvent = (label: string) =>
    setLog((prev) => [{ id: nextLogId++, label }, ...prev].slice(0, MAX_LOG_ENTRIES));

  return (
    <main className="app">
      <header>
        <h1>
          <code>&lt;HyperframesPlayer&gt;</code> React playground
        </h1>
        <p>
          Drives <code>@hyperframes/player/react</code> — props, event callbacks, and the imperative
          ref handle.
        </p>
      </header>

      <HyperframesPlayer
        ref={player}
        src={COMPOSITION_SRC}
        controls={nativeControls}
        muted={muted}
        loop={loop}
        playbackRate={rate}
        className="player"
        style={{ width: "100%", aspectRatio: "16 / 9", display: "block", background: "#06060a" }}
        onReady={(detail) => {
          setDuration(detail.duration);
          logEvent(`ready — duration ${detail.duration.toFixed(2)}s`);
        }}
        onPlay={() => {
          setPlaying(true);
          logEvent("play");
        }}
        onPause={() => {
          setPlaying(false);
          logEvent("pause");
        }}
        onTimeUpdate={(detail) => setCurrentTime(detail.currentTime)}
        onEnded={() => logEvent("ended")}
        onError={(detail) => logEvent(`error — ${detail.message}`)}
        onScenes={(detail) => logEvent(`scenes — ${detail.scenes.length} scene(s)`)}
      />

      <section className="transport">
        <button onClick={() => (playing ? player.current?.pause() : player.current?.play())}>
          {playing ? "Pause" : "Play"}
        </button>
        <input
          type="range"
          min={0}
          max={duration || 1}
          step={0.01}
          value={currentTime}
          disabled={!duration}
          onChange={(e) => {
            const t = Number(e.target.value);
            setCurrentTime(t);
            player.current?.seek(t);
          }}
        />
        <span className="time">
          {currentTime.toFixed(1)}s / {duration.toFixed(1)}s
        </span>
      </section>

      <section className="options">
        <label>
          Speed
          <select value={rate} onChange={(e) => setRate(Number(e.target.value))}>
            {RATES.map((r) => (
              <option key={r} value={r}>
                {r}×
              </option>
            ))}
          </select>
        </label>
        <label>
          <input type="checkbox" checked={muted} onChange={(e) => setMuted(e.target.checked)} />
          Muted
        </label>
        <label>
          <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} />
          Loop
        </label>
        <label>
          <input
            type="checkbox"
            checked={nativeControls}
            onChange={(e) => setNativeControls(e.target.checked)}
          />
          Built-in controls
        </label>
      </section>

      <section className="log">
        <h2>Events</h2>
        {log.length === 0 ? (
          <p className="empty">Waiting for the composition to load…</p>
        ) : (
          <ul>
            {log.map((entry) => (
              <li key={entry.id}>{entry.label}</li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
