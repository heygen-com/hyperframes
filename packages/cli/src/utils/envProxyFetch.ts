import { envProxyEnabled } from "@hyperframes/core/env-proxy";

if (envProxyEnabled()) {
  const { EnvHttpProxyAgent, setGlobalDispatcher } = await import("undici/index.js");
  setGlobalDispatcher(new EnvHttpProxyAgent());
}
