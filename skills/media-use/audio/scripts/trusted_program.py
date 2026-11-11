"""Find a helper program on PATH without taking one from the project folder.

A program started by bare name can come from the working directory: Windows searches it
before PATH, and a relative or empty PATH entry points into it everywhere. Scripts run
inside project folders, so only absolute PATH folders outside the working directory count,
the same rule as the CLI's trustedExecutable.ts. From the home folder (or above it) only
the folder itself is skipped, since every per-user install folder sits inside it.
"""

import errno
import os
import sys

# Same UTF-8 stdio pin as the scripts that import this module, so it holds on its own too.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors=_stream.errors)


def _comparable(path):
    return os.path.normcase(os.path.realpath(os.path.abspath(path)))


def _contains(parent, child):
    try:
        rel = os.path.relpath(child, parent)
    except ValueError:  # on different Windows drives
        return False
    if rel == os.curdir:
        return True
    return not (rel == os.pardir or rel.startswith(os.pardir + os.sep) or os.path.isabs(rel))


def _expand_home(entry):
    if sys.platform == "win32" or not (entry == "~" or entry.startswith("~/")):
        return entry
    return os.path.expanduser(entry)


def trusted_path_dirs(path_value=None):
    """The PATH folders a helper program may come from, in PATH order."""
    if path_value is None:
        path_value = os.environ.get("PATH", "")
    cwd = _comparable(os.getcwd())
    from_home_or_above = _contains(cwd, _comparable(os.path.expanduser("~")))
    dirs = []
    for raw in path_value.split(os.pathsep):
        entry = _expand_home(raw.strip('"') if sys.platform == "win32" else raw)
        if not entry or not os.path.isabs(entry):
            continue
        target = _comparable(entry)
        if target == cwd or (not from_home_or_above and _contains(cwd, target)):
            continue
        if entry not in dirs:
            dirs.append(entry)
    return dirs


def _extensions():
    if sys.platform != "win32":
        return [""]
    listed = os.environ.get("PATHEXT", ".COM;.EXE;.BAT;.CMD").split(";")
    return list(dict.fromkeys([".exe"] + [ext.strip().lower() for ext in listed if ext.strip()]))


def find_program(name):
    """Absolute path of `name` from a trusted PATH folder.

    A miss raises the same FileNotFoundError that running a missing program by name raises.
    """
    for folder in trusted_path_dirs():
        for ext in _extensions():
            candidate = os.path.join(folder, name + ext)
            if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
                return candidate
    raise FileNotFoundError(errno.ENOENT, os.strerror(errno.ENOENT), name)
