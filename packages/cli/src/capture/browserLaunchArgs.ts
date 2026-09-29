export function captureBrowserArgs(
  disableWebgl: boolean,
  viewportWidth: number,
  viewportHeight: number,
): string[] {
  return [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    ...(disableWebgl
      ? ["--disable-gpu"]
      : ["--enable-webgl", "--ignore-gpu-blocklist", "--use-gl=angle", "--use-angle=swiftshader"]),
    "--disable-blink-features=AutomationControlled",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    `--window-size=${viewportWidth},${viewportHeight}`,
  ];
}
