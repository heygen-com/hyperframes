import { describe, expect, it } from "vitest";
import { resolveChromeProxyArgs } from "./chromeProxy.js";

const bypass = "--proxy-bypass-list=localhost;127.0.0.1;[::1]";

describe("Chrome proxy environment", () => {
  it.each([
    [{}, []],
    [{ NO_PROXY: "example.test" }, []],
    [{ HTTP_PROXY: "proxy.test:8080" }, ["--proxy-server=http=http://proxy.test:8080", bypass]],
    [
      { HTTPS_PROXY: "http://secure.test:8080" },
      ["--proxy-server=https=http://secure.test:8080", bypass],
    ],
    [
      { ALL_PROXY: "socks5://proxy.test:1080" },
      [
        "--proxy-server=http=socks5://proxy.test:1080;https=socks5://proxy.test:1080;socks=socks5://proxy.test:1080",
        bypass,
      ],
    ],
    [
      { HTTP_PROXY: "http://one.test:80", HTTPS_PROXY: "https://two.test:443" },
      ["--proxy-server=http=http://one.test;https=https://two.test", bypass],
    ],
    [
      {
        ALL_PROXY: "http://all.test:8000",
        https_proxy: "http://secure.test:8001",
      },
      [
        "--proxy-server=http=http://all.test:8000;https=http://secure.test:8001;socks=http://all.test:8000",
        bypass,
      ],
    ],
    [
      {
        http_proxy: "http://lower.test:81",
        HTTP_PROXY: "http://upper.test:82",
      },
      ["--proxy-server=http=http://lower.test:81", bypass],
    ],
    [{ https_proxy: "", HTTPS_PROXY: "http://upper.test:82" }, []],
    [
      { all_proxy: "http://lower.test:81", ALL_PROXY: "http://upper.test:82" },
      [
        "--proxy-server=http=http://lower.test:81;https=http://lower.test:81;socks=http://lower.test:81",
        bypass,
      ],
    ],
  ])("maps %j to native Chrome flags", (env, args) => {
    expect(resolveChromeProxyArgs(env)).toEqual(args);
  });

  it("always bypasses loopback and preserves lower-case NO_PROXY entries", () => {
    expect(
      resolveChromeProxyArgs({
        HTTPS_PROXY: "http://proxy.test:80",
        no_proxy: " .example.test, localhost, 10.0.0.0/8, [::1] ",
        NO_PROXY: "ignored.test",
      }),
    ).toEqual([
      "--proxy-server=https=http://proxy.test",
      "--proxy-bypass-list=example.test;.example.test;.localhost;10.0.0.0/8;localhost;127.0.0.1;[::1]",
    ]);
  });

  it("matches NO_PROXY domains, IPv6 literals and ports without losing required loopback bypass", () => {
    expect(
      resolveChromeProxyArgs({
        HTTP_PROXY: "http://proxy.test",
        NO_PROXY: "example.test,::1,192.0.2.1:8080,<-loopback>",
      })[1],
    ).toBe(
      "--proxy-bypass-list=example.test;.example.test;192.0.2.1:8080;<-loopback>;localhost;127.0.0.1;[::1]",
    );
  });

  it.each(["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"])(
    "rejects %s credentials without exposing them",
    (name) => {
      const operation = () =>
        resolveChromeProxyArgs({
          [name]: "http://secret-user:secret-pass@proxy.test:80",
        });
      expect(operation).toThrow(`${name} contains proxy credentials.`);
      try {
        operation();
      } catch (error) {
        expect(String(error)).not.toContain("secret-user");
        expect(String(error)).not.toContain("secret-pass");
      }
    },
  );

  it.each([
    "ftp://proxy.test",
    "http://proxy.test/path",
    "http://proxy.test/?query",
    "http://proxy.test/#fragment",
    "http://[",
    "http://proxy.test;direct",
  ])("rejects invalid proxy %s", (value) => {
    expect(() => resolveChromeProxyArgs({ HTTPS_PROXY: value })).toThrow(/HTTPS_PROXY must be/);
  });
});
