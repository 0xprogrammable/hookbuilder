import crypto from "node:crypto";
import fs from "node:fs";
import { mkdir, lstat, open, link, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const OBJECT_ID = /^(?!0{40}$)[0-9a-f]{40}$/u;
const MAX_MEMORY_BLOBS = 128;
const MAX_MEMORY_TREES = 32;
const memoryBlobs = new Map();
const memoryTrees = new Map();

export function defaultSubmitLaunchCacheDirectory() {
  const user = typeof process.getuid === "function" ? String(process.getuid()) : "local";
  return path.join(os.tmpdir(), `programmable-hookbuilder-${user}`, "submit-launch-contract-v1");
}

export function createSubmitLaunchVerifiedCache({ directory = defaultSubmitLaunchCacheDirectory() } = {}) {
  const normalizedDirectory = directory === false || directory === null
    ? null
    : normalizeDirectory(directory);
  const metrics = { hits: 0, misses: 0, writes: 0, diskEnabled: normalizedDirectory !== null };
  return Object.freeze({
    async read(gitBlobOid, maximumBytes) {
      validateReadArguments(gitBlobOid, maximumBytes);
      const inMemory = memoryBlobs.get(gitBlobOid);
      if (inMemory !== undefined && validBytes(inMemory, gitBlobOid, maximumBytes)) {
        metrics.hits += 1;
        return Buffer.from(inMemory);
      }
      if (normalizedDirectory !== null) {
        const cached = await readDiskBlob(normalizedDirectory, gitBlobOid, maximumBytes);
        if (cached !== null) {
          remember(memoryBlobs, gitBlobOid, cached, MAX_MEMORY_BLOBS);
          metrics.hits += 1;
          return cached;
        }
      }
      metrics.misses += 1;
      return null;
    },
    async write(gitBlobOid, bytes) {
      validateReadArguments(gitBlobOid, Math.max(2, bytes?.length ?? 0));
      const copy = Buffer.from(bytes);
      if (!validBytes(copy, gitBlobOid, copy.length)) return false;
      remember(memoryBlobs, gitBlobOid, copy, MAX_MEMORY_BLOBS);
      if (normalizedDirectory !== null && await writeDiskBlob(normalizedDirectory, gitBlobOid, copy)) {
        metrics.writes += 1;
      }
      return true;
    },
    async readTree(gitTreeOid, maximumBytes) {
      validateReadArguments(gitTreeOid, maximumBytes);
      const inMemory = memoryTrees.get(gitTreeOid);
      if (inMemory !== undefined && inMemory.length >= 2 && inMemory.length <= maximumBytes) {
        metrics.hits += 1;
        return Buffer.from(inMemory);
      }
      if (normalizedDirectory !== null) {
        const cached = await readOpaqueDiskObject(
          normalizedDirectory,
          "git-trees-v1",
          gitTreeOid,
          maximumBytes
        );
        if (cached !== null) {
          remember(memoryTrees, gitTreeOid, cached, MAX_MEMORY_TREES);
          metrics.hits += 1;
          return cached;
        }
      }
      metrics.misses += 1;
      return null;
    },
    async writeTree(gitTreeOid, bytes) {
      validateReadArguments(gitTreeOid, Math.max(2, bytes?.length ?? 0));
      const copy = Buffer.from(bytes);
      if (copy.length < 2 || copy.length > 16 * 1024 * 1024) return false;
      remember(memoryTrees, gitTreeOid, copy, MAX_MEMORY_TREES);
      if (
        normalizedDirectory !== null
        && await writeOpaqueDiskObject(normalizedDirectory, "git-trees-v1", gitTreeOid, copy)
      ) metrics.writes += 1;
      return true;
    },
    rejectHit() {
      if (metrics.hits > 0) metrics.hits -= 1;
      metrics.misses += 1;
    },
    receipt() {
      const cacheStatus = metrics.hits === 0
        ? (metrics.diskEnabled ? "MISS" : "MEMORY_MISS")
        : metrics.misses === 0
          ? "HIT"
          : "PARTIAL_HIT";
      return Object.freeze({
        cacheStatus,
        cacheHits: metrics.hits,
        cacheMisses: metrics.misses,
        cacheWrites: metrics.writes
      });
    }
  });
}

async function readDiskBlob(directory, gitBlobOid, maximumBytes) {
  const bytes = await readOpaqueDiskObject(directory, "git-blobs-v1", gitBlobOid, maximumBytes);
  return bytes !== null && validBytes(bytes, gitBlobOid, maximumBytes) ? bytes : null;
}

async function readOpaqueDiskObject(directory, namespace, objectId, maximumBytes) {
  try {
    const root = await ensureDirectory(directory);
    if (!root) return null;
    const objects = path.join(directory, namespace);
    if (!await ensureDirectory(objects)) return null;
    const shard = path.join(objects, objectId.slice(0, 2));
    if (!await ensureDirectory(shard)) return null;
    const target = path.join(shard, objectId.slice(2));
    const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0);
    const handle = await open(target, flags);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.nlink < 1 || stat.size < 2 || stat.size > maximumBytes) return null;
      return handle.readFile();
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

async function writeDiskBlob(directory, gitBlobOid, bytes) {
  const existing = await readDiskBlob(directory, gitBlobOid, bytes.length);
  if (existing !== null) return true;
  return writeOpaqueDiskObject(directory, "git-blobs-v1", gitBlobOid, bytes);
}

async function writeOpaqueDiskObject(directory, namespace, objectId, bytes) {
  let temporary = null;
  try {
    if (!await ensureDirectory(directory)) return false;
    const objects = path.join(directory, namespace);
    if (!await ensureDirectory(objects)) return false;
    const shard = path.join(objects, objectId.slice(0, 2));
    if (!await ensureDirectory(shard)) return false;
    const target = path.join(shard, objectId.slice(2));
    temporary = path.join(shard, `.tmp-${process.pid}-${crypto.randomBytes(12).toString("hex")}`);
    const flags = fs.constants.O_WRONLY
      | fs.constants.O_CREAT
      | fs.constants.O_EXCL
      | (fs.constants.O_NOFOLLOW ?? 0);
    const handle = await open(temporary, flags, 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await link(temporary, target);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const winner = await readOpaqueDiskObject(directory, namespace, objectId, bytes.length);
      if (winner === null || winner.length !== bytes.length || !crypto.timingSafeEqual(winner, bytes)) return false;
    }
    return true;
  } catch {
    return false;
  } finally {
    if (temporary !== null) await unlink(temporary).catch(() => {});
  }
}

async function ensureDirectory(directory) {
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const stat = await lstat(directory);
    return stat.isDirectory() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

function normalizeDirectory(value) {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > 4096
    || value.includes("\0")
    || !path.isAbsolute(value)
  ) {
    throw Object.assign(new TypeError("Submit Launch cache directory must be one absolute path."), {
      code: "SUBMIT_LAUNCH_CONTRACT_OPTIONS_INVALID"
    });
  }
  return path.normalize(value);
}

function validateReadArguments(gitBlobOid, maximumBytes) {
  if (
    !OBJECT_ID.test(gitBlobOid ?? "")
    || !Number.isSafeInteger(maximumBytes)
    || maximumBytes < 2
    || maximumBytes > 16 * 1024 * 1024
  ) {
    throw Object.assign(new TypeError("Submit Launch cache lookup is invalid."), {
      code: "SUBMIT_LAUNCH_CONTRACT_OPTIONS_INVALID"
    });
  }
}

function validBytes(bytes, gitBlobOid, maximumBytes) {
  return Buffer.isBuffer(bytes)
    && bytes.length >= 2
    && bytes.length <= maximumBytes
    && gitBlob(bytes) === gitBlobOid;
}

function gitBlob(bytes) {
  return crypto.createHash("sha1").update(`blob ${bytes.length}\0`, "utf8").update(bytes).digest("hex");
}

function remember(cache, key, bytes, maximumEntries) {
  cache.delete(key);
  cache.set(key, Buffer.from(bytes));
  while (cache.size > maximumEntries) cache.delete(cache.keys().next().value);
}
