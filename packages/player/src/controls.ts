import { PLAY_ICON, PAUSE_ICON } from "./styles.js";

export interface ControlsCallbacks {
  onPlay: () => void;
  onPause: () => void;
  onSeek: (fraction: number) => void;
  onSpeedChange: (speed: number) => void;
}

/** Default logarithmic speed presets — each step roughly doubles/halves. */
export const SPEED_PRESETS = [0.25, 0.5, 1, 1.5, 2, 4] as const;

export interface ControlsOptions {
  /** Speed presets shown in the menu. Defaults to SPEED_PRESETS. */
  speedPresets?: readonly number[];
}

export function formatSpeed(speed: number): string {
  return Number.isInteger(speed) ? `${speed}x` : `${speed}x`;
}

export function formatTime(seconds: number): string {
  // Handle non-finite values gracefully
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "0:00";
  }
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export function createControls(
  parent: ShadowRoot | HTMLElement,
  callbacks: ControlsCallbacks,
  options: ControlsOptions = {},
): {
  updateTime: (current: number, duration: number) => void;
  updatePlaying: (playing: boolean) => void;
  updateSpeed: (speed: number) => void;
  show: () => void;
  hide: () => void;
  destroy: () => void;
} {
  const presets = options.speedPresets ?? SPEED_PRESETS;

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

  const speedWrap = document.createElement("div");
  speedWrap.className = "hfp-speed-wrap";

  const speedBtn = document.createElement("button");
  speedBtn.className = "hfp-speed-btn";
  speedBtn.type = "button";
  speedBtn.textContent = "1x";
  speedBtn.setAttribute("aria-label", "Playback speed");

  const speedMenu = document.createElement("div");
  speedMenu.className = "hfp-speed-menu";
  speedMenu.setAttribute("role", "menu");
  for (const preset of presets) {
    const item = document.createElement("button");
    item.className = "hfp-speed-option";
    item.type = "button";
    item.setAttribute("role", "menuitem");
    item.dataset.speed = String(preset);
    item.textContent = formatSpeed(preset);
    if (preset === 1) item.classList.add("hfp-active");
    speedMenu.appendChild(item);
  }

  speedWrap.appendChild(speedMenu);
  speedWrap.appendChild(speedBtn);

  controls.appendChild(playBtn);
  controls.appendChild(scrubber);
  controls.appendChild(time);
  controls.appendChild(speedWrap);
  parent.appendChild(controls);

  let isPlaying = false;
  let hideTimeout: ReturnType<typeof setTimeout> | null = null;
  let speedIndex = presets.indexOf(1); // start at 1x
  if (speedIndex === -1) speedIndex = 0;

  playBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (isPlaying) callbacks.onPause();
    else callbacks.onPlay();
  });

  const setActiveOption = (speed: number) => {
    for (const opt of speedMenu.querySelectorAll(".hfp-speed-option")) {
      opt.classList.toggle("hfp-active", (opt as HTMLElement).dataset.speed === String(speed));
    }
  };

  speedBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = speedMenu.classList.toggle("hfp-open");
    speedBtn.setAttribute("aria-expanded", String(isOpen));
  });

  speedMenu.addEventListener("click", (e) => {
    e.stopPropagation();
    const target = (e.target as HTMLElement).closest(".hfp-speed-option") as HTMLElement | null;
    if (!target) return;
    const newSpeed = parseFloat(target.dataset.speed!);
    speedIndex = presets.indexOf(newSpeed);
    speedBtn.textContent = formatSpeed(newSpeed);
    setActiveOption(newSpeed);
    speedMenu.classList.remove("hfp-open");
    speedBtn.setAttribute("aria-expanded", "false");
    callbacks.onSpeedChange(newSpeed);
  });

  // Close menu when clicking outside
  const onDocClick = () => {
    speedMenu.classList.remove("hfp-open");
    speedBtn.setAttribute("aria-expanded", "false");
  };
  document.addEventListener("click", onDocClick);

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
    updateSpeed(speed: number) {
      const idx = presets.indexOf(speed);
      if (idx !== -1) speedIndex = idx;
      speedBtn.textContent = formatSpeed(speed);
      setActiveOption(speed);
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
      document.removeEventListener("click", onDocClick);
      if (hideTimeout) clearTimeout(hideTimeout);
    },
  };
}
