// The one lock on ~/.hyperframes/config.json, for the CLI, its auto-update step and media-use. The auto-update step
// embeds this function's source, so it must use only its arguments and globals.
export function withFileLock(lockPath, fs, task) {
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const started = Date.now();
  for (;;) {
    try {
      const fd = fs.openSync(lockPath, "wx");
      try {
        fs.writeSync(fd, token);
      } catch (error) {
        fs.rmSync(lockPath, { force: true });
        throw error;
      } finally {
        fs.closeSync(fd);
      }
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    try {
      const seen = fs.readFileSync(lockPath, "utf8");
      if (Date.now() - fs.statSync(lockPath).mtimeMs > 5000) {
        // Steal by renaming aside; a live lock renamed by mistake (it changed after the read) goes back.
        const aside = `${lockPath}.${token}`;
        fs.renameSync(lockPath, aside);
        if (fs.readFileSync(aside, "utf8") !== seen) fs.linkSync(aside, lockPath);
        fs.rmSync(aside, { force: true });
        continue;
      }
    } catch {}
    if (Date.now() - started > 10000)
      throw new Error("Another hyperframes process kept its settings locked.");
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
  }
  try {
    return task();
  } finally {
    try {
      if (fs.readFileSync(lockPath, "utf8") === token) fs.rmSync(lockPath);
    } catch {}
  }
}
