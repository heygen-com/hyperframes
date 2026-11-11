// A program started by name can come from the working directory: Windows looks there before
// PATH unless this variable is set, and a relative or empty PATH entry points there everywhere.
// Scripts run inside project folders, so turn both off for this process and its children.
// A value the person set is kept.
if (process.platform === "win32") {
  process.env.NoDefaultCurrentDirectoryInExePath ??= "1";
} else if (process.env.PATH !== undefined) {
  const absolute = process.env.PATH.split(":").filter((dir) => dir.startsWith("/"));
  if (absolute.length > 0) process.env.PATH = absolute.join(":");
  else delete process.env.PATH;
}
