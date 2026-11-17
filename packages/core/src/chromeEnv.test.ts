import { describe, expect, it } from "vitest";
import { buildChromeLaunchEnv, CHROME_ENV_ALLOWLIST } from "./chromeEnv";

const DROPPED = {
  AWS_ACCESS_KEY_ID: "x",
  AWS_SECRET_ACCESS_KEY: "x",
  AWS_SESSION_TOKEN: "x",
  GITHUB_TOKEN: "x",
  OPENAI_API_KEY: "x",
  STRIPE_SECRET: "x",
  DATABASE_URL: "x",
  GOOGLE_APPLICATION_CREDENTIALS: "x",
  GOOGLE_API_KEY: "x",
  NPM_CONFIG_USERCONFIG: "x",
  NODE_OPTIONS: "x",
  LD_PRELOAD: "x",
  HYPERFRAMES_API_KEY: "x",
  PRODUCER_HEADLESS_SHELL_PATH: "x",
};

describe("buildChromeLaunchEnv", () => {
  it("drops everything the allowlist does not name", () => {
    expect(buildChromeLaunchEnv({ ...DROPPED, PATH: "/usr/bin" })).toEqual({ PATH: "/usr/bin" });
  });

  it.each<[string, NodeJS.ProcessEnv]>([
    ["process basics", { PATH: "/bin", HOME: "/h", USER: "u", LOGNAME: "u", TMPDIR: "/t" }],
    ["temp dirs", { TMP: "/t", TEMP: "/t" }],
    ["locale and time", { LANG: "en_US.UTF-8", LANGUAGE: "en", LC_ALL: "C", TZ: "UTC" }],
    ["Nix locales and zoneinfo", { LOCALE_ARCHIVE: "/nix/l", TZDIR: "/nix/z" }],
    ["display", { DISPLAY: ":0", WAYLAND_DISPLAY: "wayland-0", XAUTHORITY: "/x" }],
    [
      "XDG dirs",
      { XDG_RUNTIME_DIR: "/run/user/1000", XDG_CONFIG_HOME: "/c", XDG_CACHE_HOME: "/k" },
    ],
    ["session bus", { DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus" }],
    ["fonts", { FONTCONFIG_FILE: "/f/fonts.conf", FONTCONFIG_PATH: "/tmp/fonts" }],
    ["shared libraries", { LD_LIBRARY_PATH: "/tmp/al2023/lib" }],
    [
      "Mesa",
      { MESA_LOADER_DRIVER_OVERRIDE: "zink", GALLIUM_DRIVER: "d3d12", LIBGL_ALWAYS_SOFTWARE: "1" },
    ],
    ["Vulkan", { VK_ICD_FILENAMES: "/v.json", VK_DRIVER_FILES: "/v.json" }],
    [
      "glvnd and NVIDIA",
      {
        __GLX_VENDOR_LIBRARY_NAME: "nvidia",
        __EGL_VENDOR_LIBRARY_FILENAMES: "/e",
        __NV_PRIME_RENDER_OFFLOAD: "1",
        __GL_SYNC_TO_VBLANK: "0",
      },
    ],
    [
      "other GPU selection",
      { DRI_PRIME: "1", EGL_PLATFORM: "surfaceless", LIBVA_DRIVER_NAME: "iHD" },
    ],
    ["proxies, upper case", { HTTP_PROXY: "p", HTTPS_PROXY: "p", ALL_PROXY: "p", NO_PROXY: "n" }],
    ["proxies, lower case", { http_proxy: "p", https_proxy: "p", all_proxy: "p", no_proxy: "n" }],
    ["Chrome's own proxy vars", { auto_proxy: "p", SOCKS_SERVER: "s", SOCKS_VERSION: "5" }],
    ["CA bundles", { SSL_CERT_FILE: "/c.pem", SSL_CERT_DIR: "/certs" }],
    ["the setuid sandbox helper", { CHROME_DEVEL_SANDBOX: "/opt/chrome/chrome-sandbox" }],
    [
      "Windows system dirs",
      { SystemRoot: "C:\\Windows", windir: "C:\\Windows", SystemDrive: "C:" },
    ],
    [
      "Windows program dirs",
      { ProgramFiles: "a", "ProgramFiles(x86)": "b", ProgramW6432: "c", ProgramData: "d" },
    ],
    [
      "Windows profile",
      {
        LOCALAPPDATA: "a",
        APPDATA: "b",
        USERPROFILE: "c",
        USERNAME: "u",
        HOMEDRIVE: "C:",
        HOMEPATH: "\\u",
      },
    ],
    [
      "Windows shell",
      { ComSpec: "cmd.exe", PATHEXT: ".EXE", Path: "C:\\Windows", OS: "Windows_NT" },
    ],
    ["macOS text encoding", { __CF_USER_TEXT_ENCODING: "0x1F5:0x0:0x0" }],
  ])("keeps %s", (_, env) => {
    expect(buildChromeLaunchEnv({ ...DROPPED, ...env })).toEqual(env);
  });

  it("keeps the variables HYPERFRAMES_CHROME_ENV_PASSTHROUGH names, and nothing more", () => {
    const env = {
      ...DROPPED,
      HYPERFRAMES_CHROME_ENV_PASSTHROUGH: " KRB5CCNAME, radv_perftest ",
      KRB5CCNAME: "FILE:/tmp/krb5cc",
      RADV_PERFTEST: "gpl",
    };
    expect(buildChromeLaunchEnv(env)).toEqual({
      HYPERFRAMES_CHROME_ENV_PASSTHROUGH: " KRB5CCNAME, radv_perftest ",
      KRB5CCNAME: "FILE:/tmp/krb5cc",
      RADV_PERFTEST: "gpl",
    });
  });

  it("keeps the passthrough names when an env is filtered twice", () => {
    const env = {
      PATH: "/usr/bin",
      HYPERFRAMES_CHROME_ENV_PASSTHROUGH: "RADV_PERFTEST",
      RADV_PERFTEST: "gpl",
    };
    const once = buildChromeLaunchEnv(env);
    expect(buildChromeLaunchEnv(once)).toEqual(once);
    expect(once.RADV_PERFTEST).toBe("gpl");
  });

  it("reads process.env by default and leaves it untouched", () => {
    const before = { ...process.env };
    const env = buildChromeLaunchEnv();
    expect(env.PATH).toBe(process.env.PATH);
    expect(process.env).toEqual(before);
  });

  it("names no secret-shaped variable or prefix", () => {
    for (const name of CHROME_ENV_ALLOWLIST)
      expect(name).not.toMatch(/TOKEN|SECRET|PASSWORD|_KEY|CREDENTIAL|AWS_|DATABASE/);
  });
});
