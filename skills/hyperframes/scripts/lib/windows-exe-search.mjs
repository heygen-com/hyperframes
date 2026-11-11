// Windows looks in the working directory for a program started by name before it walks PATH,
// unless this variable is set. Scripts run inside project folders, so turn that lookup off for
// this process and its children. A value the person set is kept.
if (process.platform === "win32") process.env.NoDefaultCurrentDirectoryInExePath ??= "1";
