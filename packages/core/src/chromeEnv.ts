/** The only variables Chrome starts with; a trailing `*` matches a prefix. Names match without regard
 * to case, as Windows treats them, and proxy variables appear in both cases. */
export const CHROME_ENV_ALLOWLIST: readonly string[] = [
  // Finding binaries and the user's profile, temp and identity.
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "TMPDIR",
  "TMP",
  "TEMP",
  // Locale and time zone, which text shaping, number formatting and Date use.
  "LANG",
  "LANGUAGE",
  "LC_*",
  "TZ",
  "TZDIR",
  "LOCALE_ARCHIVE",
  // Display, session bus and per-user dirs on Linux desktops and WSLg.
  "DISPLAY",
  "WAYLAND_DISPLAY",
  "XAUTHORITY",
  "XDG_*",
  "DBUS_SESSION_BUS_ADDRESS",
  // Fonts, including the fontconfig dir AWS Lambda Chromium layers point at.
  "FONTCONFIG_FILE",
  "FONTCONFIG_PATH",
  // Shared libraries: Lambda Chromium layers and WSL's GPU libraries live off the default path.
  "LD_LIBRARY_PATH",
  // GPU drivers: Mesa, libglvnd, Vulkan loader, NVIDIA and VA-API.
  "MESA_*",
  "LIBGL_*",
  "GALLIUM_*",
  "VK_*",
  "__GLX_*",
  "__EGL_*",
  "__GL_*",
  "__NV_*",
  "DRI_PRIME",
  "EGL_PLATFORM",
  "LIBVA_*",
  // Network: proxies and CA bundles for compositions that load remote assets.
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "AUTO_PROXY",
  "SOCKS_SERVER",
  "SOCKS_VERSION",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  // Where Chrome's setuid sandbox helper lives when the sandbox is on.
  "CHROME_DEVEL_SANDBOX",
  // Windows system, profile and shell locations, then macOS CoreFoundation text encoding.
  "SYSTEMROOT",
  "WINDIR",
  "SYSTEMDRIVE",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "PROGRAMW6432",
  "COMMONPROGRAMFILES",
  "COMMONPROGRAMFILES(X86)",
  "COMMONPROGRAMW6432",
  "PROGRAMDATA",
  "ALLUSERSPROFILE",
  "PUBLIC",
  "APPDATA",
  "LOCALAPPDATA",
  "USERPROFILE",
  "USERNAME",
  "USERDOMAIN",
  "HOMEDRIVE",
  "HOMEPATH",
  "COMPUTERNAME",
  "COMSPEC",
  "PATHEXT",
  "OS",
  "PROCESSOR_ARCHITECTURE",
  "NUMBER_OF_PROCESSORS",
  "__CF_USER_TEXT_ENCODING",
];

/** Comma-separated names of more variables to hand Chrome, for a host that needs one the list lacks. */
const CHROME_ENV_PASSTHROUGH = "HYPERFRAMES_CHROME_ENV_PASSTHROUGH";

function nameMatcher(env: NodeJS.ProcessEnv): (name: string) => boolean {
  const extra = (env[CHROME_ENV_PASSTHROUGH] ?? "").split(",").map((name) => name.trim());
  const exact = new Set(
    [...CHROME_ENV_ALLOWLIST, CHROME_ENV_PASSTHROUGH, ...extra].map((name) => name.toUpperCase()),
  );
  const prefixes = CHROME_ENV_ALLOWLIST.filter((name) => name.endsWith("*")).map((name) =>
    name.slice(0, -1),
  );
  return (name) => {
    const upper = name.toUpperCase();
    return exact.has(upper) || prefixes.some((prefix) => upper.startsWith(prefix));
  };
}

export function buildChromeLaunchEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const allowed = nameMatcher(env);
  const chromeEnv: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined && allowed(name)) chromeEnv[name] = value;
  }
  return chromeEnv;
}
