export function formatTime(time: number): string {
  if (!Number.isFinite(time) || time < 0) return "0:00";
  const mins = Math.floor(time / 60);
  const secs = Math.floor(time % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}
