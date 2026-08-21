/** Format a render/job timestamp from one local calendar and clock. */
export function formatRenderOutputTimestamp(now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  const datePart = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const timePart = `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  return `${datePart}_${timePart}`;
}
