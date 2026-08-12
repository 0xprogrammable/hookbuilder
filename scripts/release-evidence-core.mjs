import crypto from "node:crypto";

export const RELEASE_KERNEL_EVIDENCE_SCHEMA_VERSION = "1.0.0";
export const RELEASE_KERNEL_EVIDENCE_KIND = "programmable-reference-kernel-release-evidence";
export const RELEASE_KERNEL_EVIDENCE_STATUS = "KERNEL_RELEASE_EVIDENCE_VERIFIED";
export const MAX_RELEASE_EVIDENCE_BYTES = 32 * 1024 * 1024;

export const RELEASE_KERNELS = Object.freeze([
  Object.freeze({
    id: "v1",
    sourcePath: "skills/programmable-v4-hook-builder/assets/reference-kernels/programmable-volume-fee-v1",
    historicalFrozen: true
  }),
  Object.freeze({
    id: "v2",
    sourcePath: "skills/programmable-v4-hook-builder/assets/reference-kernels/programmable-volume-fee-v2",
    historicalFrozen: false
  })
]);

const releaseKernelEnvironment = (additional = {}) => Object.freeze({
  CI: "1",
  FOUNDRY_COLOR: "never",
  FOUNDRY_FFI: "false",
  FOUNDRY_PROFILE: "default",
  NO_COLOR: "1",
  ...additional
});

export const RELEASE_KERNEL_CHECKS = Object.freeze([
  Object.freeze({ id: "dependencies", command: Object.freeze(["npm", "ci", "--ignore-scripts"]), environment: releaseKernelEnvironment() }),
  Object.freeze({ id: "format", command: Object.freeze(["forge", "fmt", "--check"]), environment: releaseKernelEnvironment() }),
  Object.freeze({ id: "build", command: Object.freeze(["forge", "build"]), environment: releaseKernelEnvironment() }),
  Object.freeze({
    id: "unit",
    command: Object.freeze(["forge", "test", "-vvv", "--no-match-test", "^(testFuzz|invariant)"]),
    environment: releaseKernelEnvironment()
  }),
  Object.freeze({
    id: "fuzz",
    command: Object.freeze(["forge", "test", "-vvv", "--match-test", "^testFuzz", "--fuzz-runs", "10000"]),
    environment: releaseKernelEnvironment()
  }),
  Object.freeze({
    id: "invariant",
    command: Object.freeze(["forge", "test", "-vvv", "--match-test", "^invariant"]),
    environment: releaseKernelEnvironment({
      FOUNDRY_INVARIANT_DEPTH: "256",
      FOUNDRY_INVARIANT_RUNS: "1000"
    })
  }),
  Object.freeze({
    id: "gas",
    command: Object.freeze(["forge", "test", "-vvv", "--gas-report", "--no-match-test", "^(testFuzz|invariant)"]),
    environment: releaseKernelEnvironment()
  }),
  Object.freeze({
    id: "slither",
    command: Object.freeze(["slither", ".", "--exclude-dependencies", "--filter-paths", "node_modules|test"]),
    environment: releaseKernelEnvironment()
  })
]);

export const RELEASE_TOOL_VERSIONS = Object.freeze([
  Object.freeze({ id: "node", command: Object.freeze(["node", "--version"]), policy: "node-major-at-least-22" }),
  Object.freeze({ id: "npm", command: Object.freeze(["npm", "--version"]), policy: "recorded" }),
  Object.freeze({ id: "forge", command: Object.freeze(["forge", "--version"]), policy: "exact-forge-1.7.1" }),
  Object.freeze({ id: "slither", command: Object.freeze(["slither", "--version"]), policy: "exact-slither-0.11.5" })
]);

export function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function createLogRecord(value) {
  const text = String(value ?? "");
  return Object.freeze({
    bytes: Buffer.byteLength(text, "utf8"),
    sha256: sha256(Buffer.from(text, "utf8"))
  });
}

export function toolVersionAccepted(toolId, version) {
  if (typeof version !== "string" || version.length === 0) return false;
  if (toolId === "node") {
    const match = version.match(/^v([0-9]+)(?:\.|$)/u);
    return match !== null && Number(match[1]) >= 22;
  }
  if (toolId === "forge") return /^forge Version: 1\.7\.1(?:\n|$)/u.test(version);
  if (toolId === "slither") return version.trim() === "0.11.5";
  if (toolId === "npm") return /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?$/u.test(version.trim());
  return false;
}

export function validateReleaseKernelEvidence(value, expected) {
  assertObject(value, "kernel evidence");
  assertExactKeys(value, [
    "schemaVersion",
    "kind",
    "status",
    "releaseEligible",
    "source",
    "createdFromCommitTime",
    "verifiedAt",
    "selection",
    "tools",
    "kernels",
    "externalActionsPerformed"
  ], "kernel evidence");
  if (value.schemaVersion !== RELEASE_KERNEL_EVIDENCE_SCHEMA_VERSION) {
    throw new Error("kernel evidence schemaVersion is unsupported");
  }
  if (value.kind !== RELEASE_KERNEL_EVIDENCE_KIND || value.status !== RELEASE_KERNEL_EVIDENCE_STATUS) {
    throw new Error("kernel evidence is not a verified release record");
  }
  if (value.releaseEligible !== true) throw new Error("focused or failed kernel evidence is not release eligible");
  if (!Array.isArray(value.externalActionsPerformed) || value.externalActionsPerformed.length !== 0) {
    throw new Error("kernel evidence must record zero external actions");
  }
  if (!validIsoDate(value.createdFromCommitTime) || !validIsoDate(value.verifiedAt)) {
    throw new Error("kernel evidence timestamps are invalid");
  }
  if (value.createdFromCommitTime !== expected.createdFromCommitTime) {
    throw new Error("kernel evidence commit timestamp does not match the release source");
  }

  assertObject(value.source, "kernel evidence source");
  assertExactKeys(value.source, [
    "commit", "tree", "skillTree", "worktreeClean", "worktreeStatusSha256"
  ], "kernel evidence source");
  for (const field of ["commit", "tree", "skillTree"]) {
    if (value.source[field] !== expected[field]) {
      throw new Error(`kernel evidence ${field} does not match the release source`);
    }
  }
  if (value.source.worktreeClean !== true || value.source.worktreeStatusSha256 !== sha256("")) {
    throw new Error("kernel evidence was not collected from a clean worktree");
  }

  assertObject(value.selection, "kernel evidence selection");
  assertExactKeys(value.selection, ["mode", "kernels", "checks"], "kernel evidence selection");
  if (value.selection.mode !== "release") throw new Error("kernel evidence selection is not the mandatory release gate");
  assertStringArrayEqual(value.selection.kernels, RELEASE_KERNELS.map(({ id }) => id), "kernel evidence kernels");
  assertStringArrayEqual(value.selection.checks, RELEASE_KERNEL_CHECKS.map(({ id }) => id), "kernel evidence checks");

  if (!Array.isArray(value.tools) || value.tools.length !== RELEASE_TOOL_VERSIONS.length) {
    throw new Error("kernel evidence tool-version records are incomplete");
  }
  assertStringArrayEqual(value.tools.map((record) => record?.id), RELEASE_TOOL_VERSIONS.map(({ id }) => id), "kernel evidence tools");
  const tools = new Map(value.tools.map((record) => [record?.id, record]));
  for (const specification of RELEASE_TOOL_VERSIONS) {
    const record = tools.get(specification.id);
    validateToolRecord(record, specification);
  }

  if (!Array.isArray(value.kernels) || value.kernels.length !== RELEASE_KERNELS.length) {
    throw new Error("kernel evidence must cover both reference kernels");
  }
  assertStringArrayEqual(value.kernels.map((record) => record?.id), RELEASE_KERNELS.map(({ id }) => id), "kernel evidence kernel records");
  const kernels = new Map(value.kernels.map((record) => [record?.id, record]));
  const summaries = [];
  for (const specification of RELEASE_KERNELS) {
    const record = kernels.get(specification.id);
    summaries.push(validateKernelRecord(record, specification, expected.lockfiles?.[specification.id]));
  }

  return Object.freeze({
    status: value.status,
    verifiedAt: value.verifiedAt,
    tools: Object.freeze(Object.fromEntries(value.tools.map(({ id, version }) => [id, version]))),
    kernels: Object.freeze(summaries)
  });
}

export function buildReleaseSpdx(kernelLocks, release) {
  if (!Array.isArray(kernelLocks) || kernelLocks.length !== RELEASE_KERNELS.length) {
    throw new Error("SPDX generation requires both reference-kernel lockfiles");
  }
  const lockById = new Map(kernelLocks.map((record) => [record.id, record]));
  const skillPackage = {
    SPDXID: "SPDXRef-Package-Builder",
    name: "programmable-v4-hook-builder",
    versionInfo: release.version,
    downloadLocation: `https://github.com/0xprogrammable/hookbuilder/tree/${release.commit}/skills/programmable-v4-hook-builder`,
    filesAnalyzed: false,
    licenseConcluded: "MIT",
    licenseDeclared: "MIT",
    copyrightText: "Copyright (c) 2026 Programmable",
    externalRefs: [{
      referenceCategory: "PACKAGE-MANAGER",
      referenceType: "purl",
      referenceLocator: `pkg:github/0xprogrammable/hookbuilder@${release.commit}`
    }]
  };

  const dependencyRecords = new Map();
  const kernelPackages = [];
  const lockFiles = [];
  const kernelDependencyKeys = new Map();
  for (const specification of RELEASE_KERNELS) {
    const input = lockById.get(specification.id);
    if (!input || input.path !== `${specification.sourcePath}/package-lock.json`) {
      throw new Error(`SPDX lockfile provenance is missing for kernel ${specification.id}`);
    }
    const lock = input.lock;
    assertObject(lock, `kernel ${specification.id} lockfile`);
    assertObject(lock.packages, `kernel ${specification.id} lockfile packages`);
    const root = lock.packages[""];
    assertObject(root, `kernel ${specification.id} lockfile root package`);
    const kernelSpdxId = `SPDXRef-Kernel-${specification.id.toUpperCase()}`;
    const lockSpdxId = `SPDXRef-Lockfile-${specification.id.toUpperCase()}`;
    lockFiles.push({
      SPDXID: lockSpdxId,
      fileName: `./${input.path}`,
      checksums: [{ algorithm: "SHA256", checksumValue: sha256(input.bytes).toUpperCase() }],
      licenseConcluded: "NOASSERTION",
      copyrightText: "NOASSERTION"
    });
    kernelPackages.push({
      SPDXID: kernelSpdxId,
      name: root.name,
      versionInfo: root.version,
      downloadLocation: `https://github.com/0xprogrammable/hookbuilder/tree/${release.commit}/${specification.sourcePath}`,
      filesAnalyzed: false,
      licenseConcluded: "MIT",
      licenseDeclared: "MIT",
      copyrightText: "Copyright (c) 2026 Programmable",
      comment: `Dependency provenance is the exact ${input.path} lockfile recorded as ${lockSpdxId}.`,
      externalRefs: [{
        referenceCategory: "PACKAGE-MANAGER",
        referenceType: "purl",
        referenceLocator: `pkg:github/0xprogrammable/hookbuilder@${release.commit}#${specification.sourcePath}`
      }]
    });

    const keys = [];
    for (const [packagePath, metadata] of Object.entries(lock.packages)) {
      if (!packagePath.startsWith("node_modules/")) continue;
      const name = packagePath.slice("node_modules/".length);
      if (typeof metadata?.version !== "string" || metadata.version.length === 0) {
        throw new Error(`kernel ${specification.id} dependency ${name} has no version`);
      }
      const key = `${name}\0${metadata.version}\0${metadata.integrity ?? ""}\0${metadata.resolved ?? ""}`;
      if (!dependencyRecords.has(key)) dependencyRecords.set(key, { name, metadata });
      keys.push(key);
    }
    kernelDependencyKeys.set(kernelSpdxId, keys.sort(compareCodeUnits));
  }

  const sortedDependencies = [...dependencyRecords.entries()]
    .sort(([left], [right]) => compareCodeUnits(left, right))
    .map(([key, { name, metadata }], index) => {
      const checksum = integrityChecksum(metadata.integrity);
      return {
        key,
        package: {
          SPDXID: `SPDXRef-Dependency-${index + 1}`,
          name,
          versionInfo: metadata.version,
          downloadLocation: metadata.resolved ?? "NOASSERTION",
          filesAnalyzed: false,
          licenseConcluded: "NOASSERTION",
          licenseDeclared: metadata.license ?? "NOASSERTION",
          copyrightText: "NOASSERTION",
          checksums: checksum ? [checksum] : [],
          externalRefs: [{
            referenceCategory: "PACKAGE-MANAGER",
            referenceType: "purl",
            referenceLocator: `pkg:npm/${encodePurlName(name)}@${metadata.version}`
          }]
        }
      };
    });
  const dependencySpdxIds = new Map(sortedDependencies.map(({ key, package: dependency }) => [key, dependency.SPDXID]));

  return {
    spdxVersion: "SPDX-2.3",
    dataLicense: "CC0-1.0",
    SPDXID: "SPDXRef-DOCUMENT",
    name: `programmable-v4-hook-builder-${release.version}`,
    documentNamespace: `https://github.com/0xprogrammable/hookbuilder/releases/download/v${release.version}/spdx-${release.commit}`,
    creationInfo: {
      created: release.created,
      creators: ["Organization: Programmable", "Tool: programmable-v4-builder-release-artifacts-2.0.0"]
    },
    packages: [skillPackage, ...kernelPackages, ...sortedDependencies.map(({ package: dependency }) => dependency)],
    files: lockFiles,
    relationships: [
      { spdxElementId: "SPDXRef-DOCUMENT", relationshipType: "DESCRIBES", relatedSpdxElement: skillPackage.SPDXID },
      ...kernelPackages.map((kernelPackage) => ({
        spdxElementId: skillPackage.SPDXID,
        relationshipType: "CONTAINS",
        relatedSpdxElement: kernelPackage.SPDXID
      })),
      ...kernelPackages.map((kernelPackage) => ({
        spdxElementId: `SPDXRef-Lockfile-${kernelPackage.SPDXID.slice("SPDXRef-Kernel-".length)}`,
        relationshipType: "DEPENDENCY_MANIFEST_OF",
        relatedSpdxElement: kernelPackage.SPDXID
      })),
      ...kernelPackages.flatMap((kernelPackage) => (
        kernelDependencyKeys.get(kernelPackage.SPDXID).map((key) => ({
          spdxElementId: kernelPackage.SPDXID,
          relationshipType: "DEPENDS_ON",
          relatedSpdxElement: dependencySpdxIds.get(key)
        }))
      ))
    ]
  };
}

function validateToolRecord(record, specification) {
  assertObject(record, `tool ${specification.id}`);
  assertExactKeys(record, [
    "id", "command", "policy", "version", "accepted", "timeoutMs", "durationMs", "exitCode", "stdout", "stderr"
  ], `tool ${specification.id}`);
  if (record.id !== specification.id || record.policy !== specification.policy) {
    throw new Error(`tool ${specification.id} identity or version policy is invalid`);
  }
  assertStringArrayEqual(record.command, specification.command, `tool ${specification.id} command`);
  if (record.exitCode !== 0 || record.accepted !== true || !toolVersionAccepted(record.id, record.version)) {
    throw new Error(`tool ${specification.id} version evidence did not pass`);
  }
  validateTimeout(record.timeoutMs, `tool ${specification.id}`);
  validateDuration(record.durationMs, `tool ${specification.id}`);
  validateLogRecord(record.stdout, `tool ${specification.id} stdout`);
  validateLogRecord(record.stderr, `tool ${specification.id} stderr`);
}

function validateKernelRecord(record, specification, expectedLockfile) {
  assertObject(record, `kernel ${specification.id}`);
  assertExactKeys(record, [
    "id", "sourcePath", "historicalFrozen", "lockfile", "testInventory", "checks"
  ], `kernel ${specification.id}`);
  if (
    record.id !== specification.id
    || record.sourcePath !== specification.sourcePath
    || record.historicalFrozen !== specification.historicalFrozen
  ) {
    throw new Error(`kernel ${specification.id} provenance is invalid`);
  }
  assertObject(expectedLockfile, `expected kernel ${specification.id} lockfile`);
  assertObject(record.lockfile, `kernel ${specification.id} lockfile`);
  assertExactKeys(record.lockfile, ["path", "bytes", "sha256"], `kernel ${specification.id} lockfile`);
  if (
    record.lockfile.path !== expectedLockfile.path
    || record.lockfile.bytes !== expectedLockfile.bytes.length
    || record.lockfile.sha256 !== sha256(expectedLockfile.bytes)
  ) {
    throw new Error(`kernel ${specification.id} lockfile evidence does not match the release source`);
  }

  assertObject(record.testInventory, `kernel ${specification.id} test inventory`);
  assertExactKeys(record.testInventory, ["unit", "fuzz", "invariant", "invariantPolicy"], `kernel ${specification.id} test inventory`);
  for (const field of ["unit", "fuzz", "invariant"]) {
    if (!Number.isSafeInteger(record.testInventory[field]) || record.testInventory[field] < 0) {
      throw new Error(`kernel ${specification.id} ${field} test inventory is invalid`);
    }
  }
  if (record.testInventory.unit < 1 || record.testInventory.fuzz < 1) {
    throw new Error(`kernel ${specification.id} lacks unit or fuzz tests`);
  }
  if (record.testInventory.invariant < 1 || record.testInventory.invariantPolicy !== "required-and-present") {
    throw new Error(`kernel ${specification.id} invariant evidence is missing`);
  }

  if (!Array.isArray(record.checks) || record.checks.length !== RELEASE_KERNEL_CHECKS.length) {
    throw new Error(`kernel ${specification.id} check evidence is incomplete`);
  }
  assertStringArrayEqual(
    record.checks.map((check) => check?.id),
    RELEASE_KERNEL_CHECKS.map(({ id }) => id),
    `kernel ${specification.id} check order`
  );
  const checks = new Map(record.checks.map((check) => [check?.id, check]));
  for (const checkSpecification of RELEASE_KERNEL_CHECKS) {
    const check = checks.get(checkSpecification.id);
    validateKernelCheck(check, checkSpecification, specification.sourcePath);
  }
  return Object.freeze({
    id: specification.id,
    lockfileSha256: record.lockfile.sha256,
    testInventory: Object.freeze({ ...record.testInventory }),
    checks: Object.freeze(Object.fromEntries(record.checks.map(({ id, stdout, stderr }) => [id, Object.freeze({
      stdoutSha256: stdout.sha256,
      stderrSha256: stderr.sha256
    })])))
  });
}

function validateKernelCheck(record, specification, sourcePath) {
  assertObject(record, `kernel check ${specification.id}`);
  assertExactKeys(record, [
    "id", "command", "environment", "workingDirectory", "executionMode", "timeoutMs", "durationMs", "exitCode", "result", "stdout", "stderr"
  ], `kernel check ${specification.id}`);
  if (
    record.id !== specification.id
    || record.workingDirectory !== sourcePath
    || record.executionMode !== "isolated-temporary-copy"
  ) {
    throw new Error(`kernel check ${specification.id} identity is invalid`);
  }
  assertStringArrayEqual(record.command, specification.command, `kernel check ${specification.id} command`);
  assertStringMapEqual(record.environment, specification.environment, `kernel check ${specification.id} environment`);
  if (record.exitCode !== 0 || record.result !== "PASS") {
    throw new Error(`kernel check ${specification.id} did not pass`);
  }
  validateTimeout(record.timeoutMs, `kernel check ${specification.id}`);
  validateDuration(record.durationMs, `kernel check ${specification.id}`);
  validateLogRecord(record.stdout, `kernel check ${specification.id} stdout`);
  validateLogRecord(record.stderr, `kernel check ${specification.id} stderr`);
}

function validateLogRecord(record, label) {
  assertObject(record, label);
  assertExactKeys(record, ["bytes", "sha256"], label);
  if (!Number.isSafeInteger(record.bytes) || record.bytes < 0) throw new Error(`${label} byte count is invalid`);
  if (!/^[0-9a-f]{64}$/u.test(record.sha256)) throw new Error(`${label} digest is invalid`);
}

function validateDuration(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} duration is invalid`);
}

function validateTimeout(value, label) {
  if (!Number.isSafeInteger(value) || value < 1_000 || value > 60 * 60 * 1000) {
    throw new Error(`${label} timeout is invalid`);
  }
}

function validIsoDate(value) {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
}

function assertExactKeys(value, keys, label) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label} keys are invalid`);
}

function assertStringArrayEqual(actual, expected, label) {
  if (!Array.isArray(actual) || actual.some((value) => typeof value !== "string")) {
    throw new Error(`${label} must be a string array`);
  }
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label} is incomplete or out of order`);
}

function assertStringMapEqual(actual, expected, label) {
  assertObject(actual, label);
  if (
    Object.entries(actual).some(([key, value]) => typeof key !== "string" || typeof value !== "string")
    || JSON.stringify(Object.fromEntries(Object.entries(actual).sort()))
      !== JSON.stringify(Object.fromEntries(Object.entries(expected).sort()))
  ) throw new Error(`${label} is incomplete or invalid`);
}

function integrityChecksum(integrity) {
  if (typeof integrity !== "string") return null;
  const match = integrity.match(/^sha512-(.+)$/u);
  if (!match) return null;
  return { algorithm: "SHA512", checksumValue: Buffer.from(match[1], "base64").toString("hex").toUpperCase() };
}

function encodePurlName(name) {
  if (!name.startsWith("@")) return encodeURIComponent(name);
  const separator = name.indexOf("/");
  if (separator < 2 || separator === name.length - 1) throw new Error(`invalid scoped npm package name: ${name}`);
  return `%40${encodeURIComponent(name.slice(1, separator))}/${encodeURIComponent(name.slice(separator + 1))}`;
}

function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
