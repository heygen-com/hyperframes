import { createHash, randomUUID } from "node:crypto";
import { HTTPException } from "hono/http-exception";
import {
  accessSync,
  closeSync,
  constants,
  fsyncSync,
  fstatSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
  type BigIntStats,
} from "node:fs";
import { basename, dirname, isAbsolute, join, posix, win32 } from "node:path";
import { isLinkFreeWithinProject } from "./safePath.js";
import {
  readRenderHistory,
  RENDER_FILE_PATTERN,
  type RenderArtifactKind,
  type RenderListingRow,
} from "./renderHistory.js";

const REGISTRY = ".hf-render-identities";
const ALIAS_PREFIX = ".hf-render~";

export interface RenderOwner {
  root: string;
  output: string;
  kind: RenderArtifactKind;
}

type Identity = { version: 1; id: string; root: string } & (
  | { blocked: true }
  | { output: string; kind: RenderArtifactKind }
);

interface IdentitySnapshot {
  roots: string[];
  identities: Map<string, Identity>;
  reservedIds: Set<string>;
  historicalRoots: Set<string>;
}

export class RenderIdentityError extends HTTPException {
  constructor(message: string, status: 403 | 409 | 503 = 503) {
    super(status, { message, res: Response.json({ error: message }, { status }) });
  }
}

const validRenderId = (id: string): boolean =>
  id !== "" && id !== "." && id !== ".." && !/[\\/]/.test(id) && !id.includes("\0");

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const recordName = (id: string) => `${hash(id)}.json`;
const outputKey = (owner: RenderOwner) => JSON.stringify([owner.root, owner.kind, owner.output]);
export const renderFamilyKey = (owner: RenderOwner): string =>
  JSON.stringify([
    owner.root,
    owner.kind,
    owner.kind === "file" ? owner.output.replace(RENDER_FILE_PATTERN, "") : owner.output,
  ]);

function checkedRoot(root: string): string {
  if (!isAbsolute(root)) throw new RenderIdentityError("Unsafe render root", 403);
  const stat = lstatSync(root, { throwIfNoEntry: false });
  if (stat?.isSymbolicLink()) {
    throw new RenderIdentityError("Unsafe render root", 403);
  }
  if (!stat?.isDirectory()) throw new RenderIdentityError("Render root is not available");
  return realpathSync(root);
}

function registryPath(root: string, create: boolean): string | null {
  const path = join(root, REGISTRY);
  if (create) {
    try {
      mkdirSync(path, { mode: 0o700 });
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    }
  }
  if (!isLinkFreeWithinProject(root, path))
    throw new RenderIdentityError("Unsafe identity registry", 403);
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat) return null;
  if (!stat.isDirectory()) throw new RenderIdentityError("Invalid identity registry");
  return path;
}

function sameIdentityFile(a: BigIntStats, b: BigIntStats): boolean {
  return a.isFile() && b.isFile() && a.dev === b.dev && a.ino === b.ino;
}

function identityPathState(path: string, fd: number, opened: BigIntStats) {
  let current = opened.nlink === 2n ? fstatSync(fd, { bigint: true }) : opened;
  const named = lstatSync(path, { bigint: true });
  if (current.nlink === 2n && named.nlink === 1n) current = fstatSync(fd, { bigint: true });
  if (!sameIdentityFile(current, named) || current.nlink !== named.nlink)
    throw new RenderIdentityError("Unsafe identity record", 403);
  return current;
}

function identityLinkState(path: string, fd: number) {
  const opened = fstatSync(fd, { bigint: true });
  let paired = false;
  if (opened.nlink === 2n) {
    const registry = dirname(path);
    paired = readdirSync(registry).some((name) => {
      if (
        !/^\.[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.tmp$/.test(name)
      )
        return false;
      const staging = lstatSync(join(registry, name), { bigint: true, throwIfNoEntry: false });
      return staging !== undefined && sameIdentityFile(staging, opened);
    });
  }
  const current = identityPathState(path, fd, opened);
  if (!(current.nlink === 1n || (current.nlink === 2n && paired)))
    throw new RenderIdentityError("Unsafe identity record", 403);
  return current;
}

function readIdentity(path: string): Identity {
  const stat = lstatSync(path, { bigint: true });
  if (!stat.isFile()) throw new RenderIdentityError("Unsafe identity record", 403);
  const fd = openSync(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
  );
  try {
    const opened = identityLinkState(path, fd);
    if (!sameIdentityFile(opened, stat)) throw new RenderIdentityError("Identity record changed");
    const identity = decodeIdentity(JSON.parse(readFileSync(fd, "utf8")), path);
    const final = identityLinkState(path, fd);
    if (opened.size !== final.size || opened.mtimeNs !== final.mtimeNs)
      throw new RenderIdentityError("Identity record changed");
    return identity;
  } catch (error) {
    if (error instanceof RenderIdentityError) throw error;
    throw new RenderIdentityError("Unreadable or corrupt identity record");
  } finally {
    closeSync(fd);
  }
}

function decodeIdentity(value: unknown, path: string): Identity {
  if (!value || typeof value !== "object") throw new RenderIdentityError("Invalid identity record");
  const {
    version,
    id: rawId,
    root: rawRoot,
    ...owner
  }: {
    version?: unknown;
    id?: unknown;
    root?: unknown;
    blocked?: unknown;
    output?: unknown;
    kind?: unknown;
  } = value;
  const id = checkedId(version, rawId, path);
  const root = decodeRoot(rawRoot);
  if (owner.blocked === true && Object.keys(owner).length === 1)
    return { version: 1, id, root, blocked: true };
  if (!isOwnerBody(owner)) throw new RenderIdentityError("Invalid identity owner");
  return { version: 1, id, root, output: owner.output, kind: owner.kind };
}

function decodeRoot(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.includes("\0") ||
    !(value.startsWith("/")
      ? posix.normalize(value) === value
      : /^(?:[a-z]:\\|\\\\)/i.test(value) && win32.normalize(value) === value)
  )
    throw new RenderIdentityError("Invalid identity root");
  return value;
}

function checkedId(version: unknown, id: unknown, path: string): string {
  if (version !== 1 || typeof id !== "string" || !validRenderId(id)) {
    throw new RenderIdentityError("Invalid identity record");
  }
  if (basename(path) !== recordName(id)) throw new RenderIdentityError("Invalid identity filename");
  return id;
}

function isOwnerBody(owner: {
  blocked?: unknown;
  output?: unknown;
  kind?: unknown;
}): owner is Omit<RenderOwner, "root"> {
  if (Object.keys(owner).length !== 2 || "blocked" in owner) return false;
  if (
    typeof owner.output !== "string" ||
    !validRenderId(owner.output) ||
    owner.output.startsWith(".")
  )
    return false;
  return (
    owner.kind === "directory" || (owner.kind === "file" && RENDER_FILE_PATTERN.test(owner.output))
  );
}

function publish(identity: Identity): { record: Identity; created: boolean } {
  const registry = writableRegistry(identity.root, true);
  const final = join(registry, recordName(identity.id));
  const temporary = join(registry, `.${randomUUID()}.tmp`);
  const fd = openSync(temporary, "wx", 0o600);
  let created = false;
  try {
    writeFileSync(fd, JSON.stringify(identity) + "\n");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    try {
      linkSync(temporary, final);
      created = true;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    }
  } finally {
    unlinkSync(temporary);
  }
  return { record: readIdentity(final), created };
}

function writableRegistry(root: string, create: boolean): string {
  const registry = registryPath(root, create);
  if (!registry || (lstatSync(registry).mode & 0o222) === 0)
    throw new RenderIdentityError("Identity registry is not writable");
  try {
    accessSync(registry, constants.W_OK);
  } catch {
    throw new RenderIdentityError("Identity registry is not writable");
  }
  return registry;
}

function sameOwner(record: Identity, owner: RenderOwner): boolean {
  return !("blocked" in record) && outputKey(record) === outputKey(owner);
}

function mergeIdentity(identities: Map<string, Identity>, record: Identity): void {
  const previous = identities.get(record.id);
  if (previous && JSON.stringify(previous) !== JSON.stringify(record)) {
    if ("blocked" in previous && "blocked" in record) return;
    throw new RenderIdentityError("Conflicting identity records; refresh render history", 409);
  }
  identities.set(record.id, record);
}

function mergeRootIdentities(snapshot: IdentitySnapshot, root: string): void {
  const registry = registryPath(root, false);
  if (!registry) return;
  for (const name of readdirSync(registry)) {
    if (/^\..+\.tmp$/.test(name)) continue;
    if (!/^[a-f0-9]{64}\.json$/.test(name))
      throw new RenderIdentityError("Unknown identity record");
    const record = readIdentity(join(registry, name));
    snapshot.reservedIds.add(record.id);
    if (record.root !== root) {
      snapshot.historicalRoots.add(root);
      continue;
    }
    mergeIdentity(snapshot.identities, record);
  }
}

function rowOwner(row: RenderListingRow): RenderOwner {
  return {
    root: row.root,
    output: row.filename,
    kind: row.kind === "directory" ? "directory" : "file",
  };
}

function blockAmbiguousGroups(rows: RenderListingRow[], snapshot: IdentitySnapshot): void {
  const groups = new Map<string, RenderListingRow[]>();
  for (const row of rows) {
    if (snapshot.historicalRoots.has(row.root)) continue;
    groups.set(row.id, [...(groups.get(row.id) ?? []), row]);
  }
  for (const [id, group] of groups) {
    if (
      snapshot.reservedIds.has(id) ||
      new Set(group.map((row) => renderFamilyKey(rowOwner(row)))).size < 2
    )
      continue;
    for (const root of new Set(group.map((row) => row.root))) {
      const { record } = publish({ version: 1, id, root, blocked: true });
      if (!("blocked" in record))
        throw new RenderIdentityError("Ownership changed; refresh render history", 409);
      snapshot.identities.set(id, record);
      snapshot.reservedIds.add(id);
    }
  }
}

function assignRowIdentity(row: RenderListingRow, snapshot: IdentitySnapshot): void {
  const { identities, reservedIds, historicalRoots } = snapshot;
  const owner = rowOwner(row);
  const existing = [...identities.values()].find((record) => sameOwner(record, owner));
  if (existing) {
    row.id = existing.id;
    return;
  }
  const alias = `${ALIAS_PREFIX}${hash(outputKey(owner))}`;
  let id = reservedIds.has(row.id) || historicalRoots.has(owner.root) ? alias : row.id;
  let suffix = 1;
  for (;;) {
    if (!reservedIds.has(id)) {
      const { record } = publish({ version: 1, id, ...owner });
      reservedIds.add(id);
      if (sameOwner(record, owner)) {
        identities.set(id, record);
        row.id = id;
        return;
      }
    }
    id = suffix === 1 ? alias : `${alias}-${suffix}`;
    suffix++;
  }
}

export class RenderIdentityStore {
  private readonly knownRoots = new Set<string>();

  constructor(private readonly roots: () => Promise<string[]>) {}

  includeRoot(root: string): void {
    this.knownRoots.add(checkedRoot(root));
  }

  assertWritable(owner: RenderOwner): void {
    writableRegistry(owner.root, false);
  }

  private async snapshot(): Promise<IdentitySnapshot> {
    const roots = new Set([...this.knownRoots, ...(await this.roots())]);
    const snapshot: IdentitySnapshot = {
      roots: [],
      identities: new Map(),
      reservedIds: new Set(),
      historicalRoots: new Set(),
    };
    for (const candidate of roots) {
      if (!lstatSync(candidate, { throwIfNoEntry: false })) continue;
      const root = checkedRoot(candidate);
      this.knownRoots.add(root);
      snapshot.roots.push(root);
      mergeRootIdentities(snapshot, root);
    }
    snapshot.roots = [...new Set(snapshot.roots)];
    return snapshot;
  }

  async claim(
    rootPath: string,
    baseId: string,
    extension: string,
    kind: RenderArtifactKind,
  ): Promise<RenderOwner & { id: string }> {
    const root = checkedRoot(rootPath);
    this.knownRoots.add(root);
    const { reservedIds, roots } = await this.snapshot();
    if (checkedRoot(rootPath) !== root)
      throw new RenderIdentityError("Render root changed; retry the render request", 409);
    const namespacedBase = `${baseId}-${hash(root).slice(0, 32)}`;
    for (let n = 1; ; n++) {
      const id = n === 1 ? namespacedBase : `${namespacedBase}-${n}`;
      if (!validRenderId(id) || id.startsWith("."))
        throw new RenderIdentityError("Unsafe render ID", 403);
      if (
        reservedIds.has(id) ||
        roots.some((dir) =>
          [id, `${id}.mp4`, `${id}.webm`, `${id}.mov`, `${id}.gif`, `${id}.meta.json`].some(
            (name) => lstatSync(join(dir, name), { throwIfNoEntry: false }),
          ),
        )
      )
        continue;
      const owner = { root, output: `${id}${extension}`, kind };
      const { created } = publish({ version: 1, id, ...owner });
      if (created) return { id, ...owner };
    }
  }

  async history(): Promise<RenderListingRow[]> {
    const snapshot = await this.snapshot();
    const rows = snapshot.roots
      .flatMap(readRenderHistory)
      .sort(
        (a, b) =>
          Number(a.kind === "directory") - Number(b.kind === "directory") ||
          a.filename.localeCompare(b.filename),
      );
    blockAmbiguousGroups(rows, snapshot);
    for (const row of rows) assignRowIdentity(row, snapshot);
    return rows;
  }

  async resolve(id: string): Promise<RenderOwner | null> {
    if (!validRenderId(id)) throw new RenderIdentityError("forbidden", 403);
    let { identities } = await this.snapshot();
    if (!identities.has(id) && !id.startsWith(ALIAS_PREFIX)) {
      await this.history();
      ({ identities } = await this.snapshot());
    }
    const record = identities.get(id);
    if (!record) return null;
    if ("blocked" in record)
      throw new RenderIdentityError("Ambiguous render ID; refresh render history and retry", 409);
    return { root: record.root, output: record.output, kind: record.kind };
  }
}
