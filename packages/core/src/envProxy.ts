/** Whether `fetch` follows the proxy variables (`NODE_USE_ENV_PROXY=1` or `--use-env-proxy`). */
export function envProxyEnabled(
  env: NodeJS.ProcessEnv = process.env,
  execArgv: readonly string[] = process.execArgv,
): boolean {
  const flags = [...execArgv, ...(env["NODE_OPTIONS"]?.split(/\s+/u) ?? [])];
  return env["NODE_USE_ENV_PROXY"] === "1" || flags.includes("--use-env-proxy");
}

/** Whether `fetch` reaches the network through `HTTPS_PROXY`, which then does the name resolution. */
export function fetchGoesThroughEnvProxy(
  env: NodeJS.ProcessEnv = process.env,
  execArgv: readonly string[] = process.execArgv,
): boolean {
  return (
    Boolean((env["HTTPS_PROXY"] ?? env["https_proxy"])?.trim()) && envProxyEnabled(env, execArgv)
  );
}
