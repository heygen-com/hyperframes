// The one lock on ~/.hyperframes/config.json, for the CLI, its auto-update step and media-use. The auto-update step
// embeds this function's source, so it must use only its arguments and globals.
export function withFileLock(lockPath, fs, task) {
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const started = Date.now();
  for (;;) {
    let fd;
    try {
      fd = fs.openSync(lockPath, "wx");
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      // Never taken over: a lock older than any hold was left by a process that stopped, and a person removes it.
      let leftover = false;
      try {
        leftover = Date.now() - fs.statSync(lockPath).mtimeMs > 5000;
      } catch {}
      if (leftover || Date.now() - started > 10000)
        throw new Error(
          `Settings are locked by another hyperframes process. If none is running, delete ${lockPath}`,
        );
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
      continue;
    }
    try {
      fs.writeSync(fd, token);
    } catch (error) {
      fs.rmSync(lockPath, { force: true });
      throw error;
    } finally {
      fs.closeSync(fd);
    }
    break;
  }
  try {
    return task();
  } finally {
    // Only the owner ever removes the lock; a failed release must not turn a finished task into an error.
    try {
      if (fs.readFileSync(lockPath, "utf8") === token) fs.rmSync(lockPath);
    } catch {}
  }
}
