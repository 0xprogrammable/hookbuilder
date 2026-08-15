import crypto from "node:crypto";
import path from "node:path";

import { ProjectSandboxHostError } from "./project-sandbox-host-contract.mjs";
import { spawnSafeRawGitSync } from "./repository-root.mjs";

const TAR_BLOCK_BYTES = 512;
const TAR_END_BYTES = TAR_BLOCK_BYTES * 2;
export const PROJECT_SANDBOX_SOURCE_ARCHIVE_MAXIMUM_BYTES = 64 * 1024 * 1024;
export const PROJECT_SANDBOX_SOURCE_UNIQUE_BLOB_MAXIMUM_BYTES = 48 * 1024 * 1024;
const MAXIMUM_TREE_LISTING_BYTES = 16 * 1024 * 1024;
const MAXIMUM_TREE_ENTRIES = 200_000;
const MAXIMUM_PATH_BYTES = 4_096;
const MAXIMUM_BATCH_OVERHEAD_BYTES = 16 * 1024 * 1024;
const SUPPORTED_BLOB_MODES = new Set(["100644", "100755"]);
const ZERO_TAR_BLOCK = Buffer.alloc(TAR_BLOCK_BYTES);

/**
 * Materialize the exact regular-file bytes and executable bits in one committed
 * Git tree. This intentionally uses raw object plumbing instead of `git archive`:
 * candidate-controlled export-ignore/export-subst attributes are data here, not
 * instructions to the host archive builder.
 */
export function exactGitTreeTarBytesV1({
  repositoryRoot,
  headCommit,
  maximumTreeEntries = MAXIMUM_TREE_ENTRIES,
  maximumArchiveBytes = PROJECT_SANDBOX_SOURCE_ARCHIVE_MAXIMUM_BYTES,
  maximumUniqueBlobBytes = PROJECT_SANDBOX_SOURCE_UNIQUE_BLOB_MAXIMUM_BYTES
}) {
  return materializeExactGitTreeTarV1({
    repositoryRoot,
    headCommit,
    maximumTreeEntries,
    maximumArchiveBytes,
    maximumUniqueBlobBytes
  }, "bytes");
}

export function exactGitTreeTarIdentityV1({
  repositoryRoot,
  headCommit,
  maximumTreeEntries = MAXIMUM_TREE_ENTRIES,
  maximumArchiveBytes = PROJECT_SANDBOX_SOURCE_ARCHIVE_MAXIMUM_BYTES,
  maximumUniqueBlobBytes = PROJECT_SANDBOX_SOURCE_UNIQUE_BLOB_MAXIMUM_BYTES
}) {
  return materializeExactGitTreeTarV1({
    repositoryRoot,
    headCommit,
    maximumTreeEntries,
    maximumArchiveBytes,
    maximumUniqueBlobBytes
  }, "identity");
}

function materializeExactGitTreeTarV1({
  repositoryRoot,
  headCommit,
  maximumTreeEntries,
  maximumArchiveBytes,
  maximumUniqueBlobBytes
}, outputKind) {
  if (typeof repositoryRoot !== "string" || repositoryRoot.length === 0 || repositoryRoot.includes("\0")) {
    fail("PROJECT_SANDBOX_SOURCE_ARCHIVE_FAILED", "repository root is invalid");
  }
  if (!/^[0-9a-f]{40}$/u.test(headCommit)) {
    fail("PROJECT_SANDBOX_SOURCE_ARCHIVE_FAILED", "source commit must be one exact SHA-1 object id");
  }
  if (
    !Number.isSafeInteger(maximumTreeEntries)
    || maximumTreeEntries < 1
    || maximumTreeEntries > MAXIMUM_TREE_ENTRIES
  ) {
    fail("PROJECT_SANDBOX_SOURCE_TREE_LIMIT_INVALID", "source tree entry limit must be a positive bounded integer", {
      maximumAllowedEntries: MAXIMUM_TREE_ENTRIES
    });
  }
  assertByteLimit(
    maximumArchiveBytes,
    PROJECT_SANDBOX_SOURCE_ARCHIVE_MAXIMUM_BYTES,
    "maximumArchiveBytes",
    TAR_END_BYTES
  );
  assertByteLimit(
    maximumUniqueBlobBytes,
    PROJECT_SANDBOX_SOURCE_UNIQUE_BLOB_MAXIMUM_BYTES,
    "maximumUniqueBlobBytes",
    0
  );
  const listing = readTreeListing(repositoryRoot, headCommit);
  const files = parseTreeListing(listing, maximumTreeEntries);
  const entries = planTreeEntries(files, maximumTreeEntries);
  const blobs = readExactBlobs(repositoryRoot, files, maximumUniqueBlobBytes);
  return encodeTreeAsTar(entries, blobs, maximumArchiveBytes, outputKind);
}

function assertByteLimit(value, maximum, label, minimum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail("PROJECT_SANDBOX_SOURCE_TREE_LIMIT_INVALID", `${label} must be a bounded integer`, {
      minimumAllowedBytes: minimum,
      maximumAllowedBytes: maximum
    });
  }
}

function readTreeListing(repositoryRoot, headCommit) {
  const result = spawnSafeRawGitSync(
    ["-C", repositoryRoot, "ls-tree", "-r", "-z", "--full-tree", headCommit, "--", "."],
    { encoding: null, timeout: 120_000, maxBuffer: MAXIMUM_TREE_LISTING_BYTES }
  );
  if (result.status !== 0 || !Buffer.isBuffer(result.stdout)) {
    fail("PROJECT_SANDBOX_SOURCE_ARCHIVE_FAILED", "exact Git tree inventory could not be read", gitFailureDetails(result));
  }
  if (result.stdout.length > MAXIMUM_TREE_LISTING_BYTES) {
    fail("PROJECT_SANDBOX_SOURCE_TREE_LIMIT_EXCEEDED", "Git tree inventory exceeds its byte limit");
  }
  return result.stdout;
}

function parseTreeListing(listing, maximumTreeEntries) {
  const files = [];
  let offset = 0;
  while (offset < listing.length) {
    const terminator = listing.indexOf(0, offset);
    if (terminator === -1) fail("PROJECT_SANDBOX_SOURCE_TREE_INVALID", "Git tree inventory is not NUL terminated");
    const record = listing.subarray(offset, terminator);
    offset = terminator + 1;
    if (record.length === 0) fail("PROJECT_SANDBOX_SOURCE_TREE_INVALID", "Git tree inventory contains an empty record");
    if (files.length >= maximumTreeEntries) {
      fail("PROJECT_SANDBOX_SOURCE_TREE_LIMIT_EXCEEDED", "Git tree exceeds its entry-count limit", {
        maximumEntries: maximumTreeEntries,
        retainedEntries: files.length,
        attemptedEntryKind: "file"
      });
    }
    const tab = record.indexOf(0x09);
    if (tab <= 0 || tab === record.length - 1) {
      fail("PROJECT_SANDBOX_SOURCE_TREE_INVALID", "Git tree inventory record is malformed");
    }
    const identity = record.subarray(0, tab).toString("ascii");
    const match = /^(\d{6}) (blob|commit|tree) ([0-9a-f]{40})$/u.exec(identity);
    if (!match) fail("PROJECT_SANDBOX_SOURCE_TREE_INVALID", "Git tree inventory identity is malformed");
    const [, mode, type, objectId] = match;
    const pathBytes = Buffer.from(record.subarray(tab + 1));
    const repositoryPath = validateRepositoryPath(pathBytes);
    if (!SUPPORTED_BLOB_MODES.has(mode) || type !== "blob") {
      fail(
        "PROJECT_SANDBOX_SOURCE_TREE_ENTRY_UNSUPPORTED",
        "sandbox source archives support only regular committed files and executable regular committed files",
        { path: repositoryPath, mode, type }
      );
    }
    files.push({ mode, objectId, path: repositoryPath, pathBytes });
  }
  files.sort((left, right) => Buffer.compare(left.pathBytes, right.pathBytes));
  for (let index = 1; index < files.length; index += 1) {
    if (files[index - 1].pathBytes.equals(files[index].pathBytes)) {
      fail("PROJECT_SANDBOX_SOURCE_TREE_INVALID", "Git tree inventory contains a duplicate path", { path: files[index].path });
    }
  }
  return files;
}

function validateRepositoryPath(pathBytes) {
  if (pathBytes.length === 0 || pathBytes.length > MAXIMUM_PATH_BYTES) {
    fail("PROJECT_SANDBOX_SOURCE_TREE_PATH_INVALID", "Git tree path is empty or exceeds its byte limit", {
      maximumPathBytes: MAXIMUM_PATH_BYTES,
      observedPathBytes: pathBytes.length
    });
  }
  const repositoryPath = pathBytes.toString("utf8");
  if (!Buffer.from(repositoryPath, "utf8").equals(pathBytes)) {
    fail("PROJECT_SANDBOX_SOURCE_TREE_PATH_INVALID", "Git tree path must be canonical UTF-8");
  }
  const segments = repositoryPath.split("/");
  if (
    path.posix.isAbsolute(repositoryPath)
    || segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")
    || /[\u0000-\u001f\u007f]/u.test(repositoryPath)
  ) {
    fail("PROJECT_SANDBOX_SOURCE_TREE_PATH_INVALID", "Git tree path is unsafe for portable tar materialization", {
      path: repositoryPath
    });
  }
  return repositoryPath;
}

function readExactBlobs(repositoryRoot, files, maximumUniqueBlobBytes) {
  const objectIds = [...new Set(files.map(({ objectId }) => objectId))];
  if (objectIds.length === 0) return new Map();
  const result = spawnSafeRawGitSync(["-C", repositoryRoot, "cat-file", "--batch"], {
    encoding: null,
    input: Buffer.from(`${objectIds.join("\n")}\n`, "ascii"),
    timeout: 120_000,
    maxBuffer: PROJECT_SANDBOX_SOURCE_UNIQUE_BLOB_MAXIMUM_BYTES + MAXIMUM_BATCH_OVERHEAD_BYTES
  });
  if (result.status !== 0 || !Buffer.isBuffer(result.stdout)) {
    fail("PROJECT_SANDBOX_SOURCE_ARCHIVE_FAILED", "exact Git blob bytes could not be read", gitFailureDetails(result));
  }
  const blobs = new Map();
  let retainedBytes = 0;
  let offset = 0;
  for (const requestedObjectId of objectIds) {
    const newline = result.stdout.indexOf(0x0a, offset);
    if (newline === -1) fail("PROJECT_SANDBOX_SOURCE_TREE_INVALID", "Git blob batch response is truncated");
    const header = result.stdout.subarray(offset, newline).toString("ascii");
    const match = /^([0-9a-f]{40}) blob (0|[1-9]\d*)$/u.exec(header);
    if (!match || match[1] !== requestedObjectId) {
      fail("PROJECT_SANDBOX_SOURCE_TREE_INVALID", "Git blob batch response does not match the requested object", {
        objectId: requestedObjectId
      });
    }
    const byteLength = Number(match[2]);
    if (!Number.isSafeInteger(byteLength)) {
      fail("PROJECT_SANDBOX_SOURCE_TREE_INVALID", "Git blob batch response has an invalid byte length", {
        objectId: requestedObjectId
      });
    }
    if (byteLength > maximumUniqueBlobBytes - retainedBytes) {
      fail("PROJECT_SANDBOX_SOURCE_TREE_LIMIT_EXCEEDED", "unique Git blob bytes exceed the source-archive byte limit", {
        objectId: requestedObjectId,
        maximumBytes: maximumUniqueBlobBytes,
        retainedBytes,
        attemptedBytes: byteLength
      });
    }
    const bodyStart = newline + 1;
    const bodyEnd = bodyStart + byteLength;
    if (bodyEnd >= result.stdout.length || result.stdout[bodyEnd] !== 0x0a) {
      fail("PROJECT_SANDBOX_SOURCE_TREE_INVALID", "Git blob batch body is truncated", { objectId: requestedObjectId });
    }
    blobs.set(requestedObjectId, result.stdout.subarray(bodyStart, bodyEnd));
    retainedBytes += byteLength;
    offset = bodyEnd + 1;
  }
  if (offset !== result.stdout.length) {
    fail("PROJECT_SANDBOX_SOURCE_TREE_INVALID", "Git blob batch response contains trailing bytes");
  }
  return blobs;
}

function planTreeEntries(files, maximumTreeEntries) {
  const entries = [];
  const emittedDirectories = new Set();
  const retain = (entry, attemptedEntryKind) => {
    if (entries.length >= maximumTreeEntries) {
      fail("PROJECT_SANDBOX_SOURCE_TREE_LIMIT_EXCEEDED", "Git tree plus inferred directories exceeds its entry-count limit", {
        maximumEntries: maximumTreeEntries,
        retainedEntries: entries.length,
        attemptedEntryKind,
        attemptedPath: entry.path
      });
    }
    entries.push(entry);
  };
  for (const file of files) {
    const segments = file.path.split("/");
    for (let depth = 1; depth < segments.length; depth += 1) {
      const directory = segments.slice(0, depth).join("/");
      if (!emittedDirectories.has(directory)) {
        const entry = { path: `${directory}/`, mode: 0o755, type: "5", objectId: null };
        retain(entry, "directory");
        emittedDirectories.add(directory);
      }
    }
    retain({
      path: file.path,
      mode: file.mode === "100755" ? 0o755 : 0o644,
      type: "0",
      objectId: file.objectId
    }, "file");
  }
  return entries;
}

function encodeTreeAsTar(entries, blobs, maximumArchiveBytes, outputKind) {
  let archiveBytes = 0;
  entries.forEach((entry) => {
    const bytes = entryBytes(entry, blobs);
    archiveBytes = addArchiveBytes(
      archiveBytes,
      tarEntryByteLength(entry, bytes),
      maximumArchiveBytes
    );
  });
  archiveBytes = addArchiveBytes(archiveBytes, TAR_END_BYTES, maximumArchiveBytes);

  const output = outputKind === "bytes" ? Buffer.alloc(archiveBytes) : null;
  const hash = outputKind === "identity" ? crypto.createHash("sha256") : null;
  let offset = 0;
  const sink = {
    write(bytes) {
      if (output !== null) bytes.copy(output, offset);
      else hash.update(bytes);
      offset += bytes.length;
    },
    zeros(byteLength) {
      if (output === null) {
        let remaining = byteLength;
        while (remaining > 0) {
          const length = Math.min(remaining, ZERO_TAR_BLOCK.length);
          hash.update(ZERO_TAR_BLOCK.subarray(0, length));
          remaining -= length;
        }
      }
      offset += byteLength;
    }
  };
  entries.forEach((entry, index) => writeTarEntry(sink, entry, entryBytes(entry, blobs), index));
  sink.zeros(TAR_END_BYTES);
  if (offset !== archiveBytes) {
    fail("PROJECT_SANDBOX_SOURCE_TREE_INVALID", "deterministic tar byte accounting drifted", {
      expectedBytes: archiveBytes,
      observedBytes: offset
    });
  }
  if (output !== null) return output;
  return Object.freeze({ sha256: `sha256:${hash.digest("hex")}`, byteLength: archiveBytes });
}

function entryBytes(entry, blobs) {
  if (entry.type === "5") return ZERO_TAR_BLOCK.subarray(0, 0);
  const bytes = blobs.get(entry.objectId);
  if (!bytes) fail("PROJECT_SANDBOX_SOURCE_TREE_INVALID", "Git tree references an unreadable blob", { objectId: entry.objectId });
  return bytes;
}

function addArchiveBytes(retainedBytes, attemptedBytes, maximumArchiveBytes) {
  if (attemptedBytes > maximumArchiveBytes - retainedBytes) {
    const requiredBytes = retainedBytes + attemptedBytes;
    fail("PROJECT_SANDBOX_SOURCE_TREE_LIMIT_EXCEEDED", "deterministic source archive exceeds its byte limit", {
      maximumBytes: maximumArchiveBytes,
      retainedBytes,
      attemptedBytes,
      requiredBytes
    });
  }
  return retainedBytes + attemptedBytes;
}

function tarEntryByteLength(entry, bytes) {
  const pathBytes = Buffer.from(entry.path, "utf8");
  const fields = splitUstarPath(pathBytes);
  let byteLength = TAR_BLOCK_BYTES + paddedTarByteLength(bytes.length);
  if (fields === null) {
    const paxBytes = paxPathRecord(entry.path);
    byteLength += TAR_BLOCK_BYTES + paddedTarByteLength(paxBytes.length);
  }
  return byteLength;
}

function writeTarEntry(sink, entry, bytes, index) {
  const pathBytes = Buffer.from(entry.path, "utf8");
  let fields = splitUstarPath(pathBytes);
  if (fields === null) {
    const paxBytes = paxPathRecord(entry.path);
    const ordinal = String(index + 1).padStart(10, "0");
    sink.write(tarHeader({ pathBytes: Buffer.from(`PaxHeaders/${ordinal}`, "ascii"), mode: 0o644, type: "x", size: paxBytes.length }));
    sink.write(paxBytes);
    sink.zeros(paddedTarByteLength(paxBytes.length) - paxBytes.length);
    fields = splitUstarPath(Buffer.from(`PaxPayload/${ordinal}`, "ascii"));
  }
  sink.write(tarHeader({ ...fields, mode: entry.mode, type: entry.type, size: bytes.length }));
  sink.write(bytes);
  sink.zeros(paddedTarByteLength(bytes.length) - bytes.length);
}

function paddedTarByteLength(byteLength) {
  if (byteLength === 0) return 0;
  return Math.ceil(byteLength / TAR_BLOCK_BYTES) * TAR_BLOCK_BYTES;
}

function splitUstarPath(pathBytes) {
  if (pathBytes.length <= 100) return { pathBytes, prefixBytes: Buffer.alloc(0) };
  for (let index = pathBytes.length - 1; index > 0; index -= 1) {
    if (pathBytes[index] !== 0x2f) continue;
    const prefixBytes = pathBytes.subarray(0, index);
    const nameBytes = pathBytes.subarray(index + 1);
    if (prefixBytes.length <= 155 && nameBytes.length > 0 && nameBytes.length <= 100) {
      return { pathBytes: nameBytes, prefixBytes };
    }
  }
  return null;
}

function paxPathRecord(repositoryPath) {
  const payloadBytes = Buffer.byteLength(`path=${repositoryPath}\n`, "utf8");
  let digits = 1;
  let recordLength = payloadBytes + digits + 1;
  while (String(recordLength).length !== digits) {
    digits = String(recordLength).length;
    recordLength = payloadBytes + digits + 1;
  }
  return Buffer.from(`${recordLength} path=${repositoryPath}\n`, "utf8");
}

function tarHeader({ pathBytes, prefixBytes = Buffer.alloc(0), mode, type, size }) {
  if (pathBytes.length === 0 || pathBytes.length > 100 || prefixBytes.length > 155) {
    fail("PROJECT_SANDBOX_SOURCE_TREE_PATH_INVALID", "tar header path fields exceed the USTAR limits");
  }
  const header = Buffer.alloc(TAR_BLOCK_BYTES);
  pathBytes.copy(header, 0);
  writeOctal(header, 100, 8, mode);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header[156] = type.charCodeAt(0);
  Buffer.from("ustar\0", "ascii").copy(header, 257);
  Buffer.from("00", "ascii").copy(header, 263);
  prefixBytes.copy(header, 345);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  const checksumBytes = Buffer.from(checksum.toString(8).padStart(6, "0"), "ascii");
  checksumBytes.copy(header, 148);
  header[154] = 0;
  header[155] = 0x20;
  return header;
}

function writeOctal(buffer, offset, width, value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail("PROJECT_SANDBOX_SOURCE_TREE_INVALID", "tar metadata integer is invalid");
  }
  const digits = value.toString(8);
  if (digits.length > width - 1) {
    fail("PROJECT_SANDBOX_SOURCE_TREE_LIMIT_EXCEEDED", "tar metadata integer exceeds its field width");
  }
  Buffer.from(digits.padStart(width - 1, "0"), "ascii").copy(buffer, offset);
  buffer[offset + width - 1] = 0;
}

function gitFailureDetails(result) {
  const stderr = Buffer.isBuffer(result?.stderr)
    ? result.stderr.toString("utf8").trim()
    : String(result?.stderr ?? result?.error?.message ?? "").trim();
  return stderr.length === 0 ? {} : { error: stderr.slice(0, 4_096) };
}

function fail(code, message, details = {}) {
  throw new ProjectSandboxHostError(code, message, details);
}
