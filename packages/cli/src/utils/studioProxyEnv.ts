export function studioProxyEnv(
  autoProxy: boolean,
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return {
    ...baseEnv,
    HYPERFRAMES_AUTO_PROXY: autoProxy ? "true" : "false",
  };
}
