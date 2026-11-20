import { envProxyEnabled } from "@hyperframes/core/env-proxy";

// Node's own env proxy (undici 6 and 7) reopens a tunnel the proxy drops with no pause, thousands of times a second,
// and keeps the process alive past the fetch's own error; undici 8's agent reads the same variables and fails once.
if (envProxyEnabled()) {
  const { EnvHttpProxyAgent, setGlobalDispatcher } = await import("undici/index.js");
  setGlobalDispatcher(new EnvHttpProxyAgent());
}
