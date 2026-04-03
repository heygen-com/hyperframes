import { PLAY_ICON, PAUSE_ICON } from "./styles.js";

export interface ControlsCallbacks {
  onPlay: () => void;
  onPause: () => void;
  onSeek: (fraction: number) => void;
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export function createControls(
  parent: ShadowRoot | HTMLElement,
  callbacks: ControlsCallbacks,
): {
  updateTime: (current: number, duration: number) => void;
  updatePlaying: (playing: boolean) => void;
  show: () => void;
  hide: () => void;
  destroy: () => void;
} {
  const controls = document.createElement("div");
  controls.className = "hfp-controls";
  // Keep overlay interactions from falling through to the host-level click toggle.
  controls.addEventListener("click", (e) => {
    e.stopPropagation();
  });

  const playBtn = document.createElement("button");
  playBtn.className = "hfp-play-btn";
  playBtn.type = "button";
  playBtn.innerHTML = PLAY_ICON;
  playBtn.setAttribute("aria-label", "Play");

  const scrubber = document.createElement("div");
  scrubber.className = "hfp-scrubber";
  const progress = document.createElement("div");
  progress.className = "hfp-progress";
  progress.style.width = "0%";
  scrubber.appendChild(progress);

  const time = document.createElement("span");
  time.className = "hfp-time";
  time.textContent = "0:00 / 0:00";

  controls.appendChild(playBtn);
  controls.appendChild(scrubber);
  controls.appendChild(time);
  parent.appendChild(controls);

  let isPlaying = false;
  let hideTimeout: ReturnType<typeof setTimeout> | null = null;

  playBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (isPlaying) callbacks.onPause();
    else callbacks.onPlay();
  });

  const handleScrubAt = (clientX: number) => {
    const rect = scrubber.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    callbacks.onSeek(fraction);
  };

  let scrubbing = false;

  scrubber.addEventListener("mousedown", (e) => {
    e.stopPropagation();
    scrubbing = true;
    handleScrubAt(e.clientX);
  });
  const onMouseMove = (e: MouseEvent) => {
    if (scrubbing) handleScrubAt(e.clientX);
  };
  const onMouseUp = () => {
    scrubbing = false;
  };
  document.addEventListener("mousemove", onMouseMove);
  document.addEventListener("mouseup", onMouseUp);

  scrubber.addEventListener(
    "touchstart",
    (e) => {
      scrubbing = true;
      const touch = e.touches[0];
      if (touch) handleScrubAt(touch.clientX);
    },
    { passive: true },
  );
  const onTouchMove = (e: TouchEvent) => {
    if (scrubbing) {
      const touch = e.touches[0];
      if (touch) handleScrubAt(touch.clientX);
    }
  };
  const onTouchEnd = () => {
    scrubbing = false;
  };
  document.addEventListener("touchmove", onTouchMove, { passive: true });
  document.addEventListener("touchend", onTouchEnd);

  const startHideTimer = () => {
    if (hideTimeout) clearTimeout(hideTimeout);
    hideTimeout = setTimeout(() => {
      if (isPlaying) controls.classList.add("hfp-hidden");
    }, 3000);
  };

  const host = parent instanceof ShadowRoot ? (parent.host as HTMLElement) : parent;
  host.addEventListener("mousemove", () => {
    controls.classList.remove("hfp-hidden");
    startHideTimer();
  });
  host.addEventListener("mouseleave", () => {
    if (isPlaying) controls.classList.add("hfp-hidden");
  });

  return {
    updateTime(current: number, duration: number) {
      const pct = duration > 0 ? (current / duration) * 100 : 0;
      progress.style.width = `${pct}%`;
      time.textContent = `${formatTime(current)} / ${formatTime(duration)}`;
    },
    updatePlaying(playing: boolean) {
      isPlaying = playing;
      playBtn.innerHTML = playing ? PAUSE_ICON : PLAY_ICON;
      playBtn.setAttribute("aria-label", playing ? "Pause" : "Play");
      if (playing) startHideTimer();
      else controls.classList.remove("hfp-hidden");
    },
    show() {
      controls.style.display = "";
    },
    hide() {
      controls.style.display = "none";
    },
    destroy() {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      if (hideTimeout) clearTimeout(hideTimeout);
    },
  };
}
