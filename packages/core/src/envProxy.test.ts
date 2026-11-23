import { describe, expect, it } from "vitest";
import { envProxyEnabled, fetchGoesThroughEnvProxy } from "./envProxy.js";

describe("env proxy", () => {
  it("needs a proxy variable and Node started with env-proxy support", () => {
    const proxy = { HTTPS_PROXY: "http://proxy.test:3128" };
    expect(fetchGoesThroughEnvProxy({ ...proxy, NODE_USE_ENV_PROXY: "1" }, [])).toBe(true);
    expect(fetchGoesThroughEnvProxy(proxy, ["--use-env-proxy"])).toBe(true);
    expect(
      fetchGoesThroughEnvProxy({ ...proxy, NODE_OPTIONS: "--no-warnings --use-env-proxy" }, []),
    ).toBe(true);
    expect(
      fetchGoesThroughEnvProxy({ https_proxy: " http://proxy.test ", NODE_USE_ENV_PROXY: "1" }, []),
    ).toBe(true);
    expect(fetchGoesThroughEnvProxy(proxy, [])).toBe(false);
    expect(fetchGoesThroughEnvProxy({ NODE_USE_ENV_PROXY: "1" }, [])).toBe(false);
    expect(fetchGoesThroughEnvProxy({ HTTPS_PROXY: " ", NODE_USE_ENV_PROXY: "1" }, [])).toBe(false);
  });

  it("reports env-proxy support separately from the variables", () => {
    expect(envProxyEnabled({ NODE_USE_ENV_PROXY: "1" }, [])).toBe(true);
    expect(envProxyEnabled({}, [])).toBe(false);
  });
});
