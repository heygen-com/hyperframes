// The one lock on ~/.hyperframes/config.json, for the CLI, its auto-update step and media-use. The auto-update step
// embeds this function's source, so it must use only its arguments and globals.
export function withFileLock(lockPath, fs, task) {
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const reaper = `${lockPath}.reap`;
  const nap = () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
  const create = (path) => {
    let fd;
    try {
      fd = fs.openSync(path, "wx");
    } catch (error) {
      if (error.code === "EEXIST") return false;
      throw error;
    }
    try {
      fs.writeSync(fd, token);
    } catch (error) {
      fs.rmSync(path, { force: true });
      throw error;
    } finally {
      fs.closeSync(fd);
    }
    return true;
  };
  const olderThan = (path, ms) => {
    try {
      return Date.now() - fs.statSync(path).mtimeMs > ms;
    } catch {
      return false;
    }
  };
  // Every removal of the lock happens while holding the reaper file, so a check-then-remove never hits a newer lock.
  const reaping = (remove) => {
    if (!create(reaper)) {
      if (olderThan(reaper, 60000)) fs.rmSync(reaper, { force: true });
      return false;
    }
    try {
      remove();
    } finally {
      fs.rmSync(reaper, { force: true });
    }
    return true;
  };
  const started = Date.now();
  while (!create(lockPath)) {
    if (olderThan(lockPath, 5000))
      reaping(() => olderThan(lockPath, 5000) && fs.rmSync(lockPath, { force: true }));
    if (Date.now() - started > 10000)
      throw new Error("Another hyperframes process kept its settings locked.");
    nap();
  }
  try {
    return task();
  } finally {
    const releaseOwn = () => {
      try {
        if (fs.readFileSync(lockPath, "utf8") === token) fs.rmSync(lockPath);
      } catch {}
    };
    for (let tries = 0; tries < 40 && !reaping(releaseOwn); tries++) nap();
  }
}
