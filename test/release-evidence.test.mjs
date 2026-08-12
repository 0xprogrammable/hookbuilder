import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildReleaseSpdx,
  createLogRecord,
  RELEASE_KERNEL_CHECKS,
  RELEASE_KERNEL_EVIDENCE_KIND,
  RELEASE_KERNEL_EVIDENCE_SCHEMA_VERSION,
  RELEASE_KERNEL_EVIDENCE_STATUS,
  RELEASE_KERNELS,
  RELEASE_TOOL_VERSIONS,
  sha256,
  validateReleaseKernelEvidence
} from "../scripts/release-evidence-core.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, "..");
const source = {
  commit: "0123456789abcdef0123456789abcdef01234567",
  tree: "123456789abcdef0123456789abcdef012345678",
  skillTree: "23456789abcdef0123456789abcdef0123456789"
};
const kernelLocks = RELEASE_KERNELS.map((specification) => {
  const lockPath = `${specification.sourcePath}/package-lock.json`;
  const bytes = fs.readFileSync(path.join(repositoryRoot, lockPath));
  return { id: specification.id, path: lockPath, bytes, lock: JSON.parse(bytes.toString("utf8")) };
});
const expected = {
  ...source,
  createdFromCommitTime: "2026-08-03T00:00:00.000Z",
  lockfiles: Object.fromEntries(kernelLocks.map(({ id, path: lockPath, bytes }) => [id, { path: lockPath, bytes }]))
};

test("release campaign makes high-confidence fuzz and invariant settings explicit", () => {
  const fuzz = RELEASE_KERNEL_CHECKS.find(({ id }) => id === "fuzz");
  const invariant = RELEASE_KERNEL_CHECKS.find(({ id }) => id === "invariant");
  const unit = RELEASE_KERNEL_CHECKS.find(({ id }) => id === "unit");
  const gas = RELEASE_KERNEL_CHECKS.find(({ id }) => id === "gas");
  assert.deepEqual(fuzz.command.slice(-2), ["--fuzz-runs", "10000"]);
  assert.deepEqual(unit.command.slice(-2), ["--no-match-test", "^(testFuzz|invariant)"]);
  assert.deepEqual(invariant.command.slice(-2), ["--match-test", "^invariant"]);
  assert.deepEqual(invariant.environment, {
    CI: "1",
    FOUNDRY_COLOR: "never",
    FOUNDRY_FFI: "false",
    FOUNDRY_PROFILE: "default",
    FOUNDRY_INVARIANT_DEPTH: "256",
    FOUNDRY_INVARIANT_RUNS: "1000",
    NO_COLOR: "1"
  });
  assert.ok(Number(invariant.environment.FOUNDRY_INVARIANT_RUNS) > 64);
  assert.ok(Number(invariant.environment.FOUNDRY_INVARIANT_DEPTH) > 32);
  assert.deepEqual(gas.command.slice(-2), ["--no-match-test", "^(testFuzz|invariant)"]);
  const v1Tests = fs.readFileSync(path.join(
    repositoryRoot,
    "skills/programmable-v4-hook-builder/assets/reference-kernels/programmable-volume-fee-v1/test/ProgrammableVolumeFeeHookV1.t.sol"
  ), "utf8");
  assert.match(v1Tests, /function invariantEveryAcceptedNonzeroSwapHasPlatformLiability\(/u);
});

test("release evidence validator accepts only a complete clean V1 and V2 campaign", () => {
  const evidence = validEvidence();
  const summary = validateReleaseKernelEvidence(evidence, expected);
  assert.equal(summary.status, RELEASE_KERNEL_EVIDENCE_STATUS);
  assert.deepEqual(Object.keys(summary.tools).sort(), ["forge", "node", "npm", "slither"]);
  assert.deepEqual(summary.kernels.map(({ id }) => id), ["v1", "v2"]);

  const focused = structuredClone(evidence);
  focused.releaseEligible = false;
  focused.status = "KERNEL_FOCUSED_EVIDENCE_COMPLETED";
  focused.selection.mode = "focused";
  assert.throws(() => validateReleaseKernelEvidence(focused, expected), /not a verified release record/u);

  const dirty = structuredClone(evidence);
  dirty.source.worktreeClean = false;
  dirty.source.worktreeStatusSha256 = sha256(" M kernel.sol\n");
  assert.throws(() => validateReleaseKernelEvidence(dirty, expected), /not collected from a clean worktree/u);

  const weakenedFuzz = structuredClone(evidence);
  weakenedFuzz.kernels[1].checks.find(({ id }) => id === "fuzz").command = [
    "forge", "test", "-vvv", "--match-test", "^testFuzz", "--fuzz-runs", "256"
  ];
  assert.throws(() => validateReleaseKernelEvidence(weakenedFuzz, expected), /kernel check fuzz command/u);

  const weakenedInvariant = structuredClone(evidence);
  weakenedInvariant.kernels[1].checks.find(({ id }) => id === "invariant").environment.FOUNDRY_INVARIANT_RUNS = "64";
  assert.throws(() => validateReleaseKernelEvidence(weakenedInvariant, expected), /kernel check invariant environment/u);

  const wrongLock = structuredClone(evidence);
  wrongLock.kernels[0].lockfile.sha256 = "0".repeat(64);
  assert.throws(() => validateReleaseKernelEvidence(wrongLock, expected), /lockfile evidence does not match/u);

  const missingCheck = structuredClone(evidence);
  missingCheck.kernels[0].checks.pop();
  assert.throws(() => validateReleaseKernelEvidence(missingCheck, expected), /check evidence is incomplete/u);

  const wrongForge = structuredClone(evidence);
  wrongForge.tools.find(({ id }) => id === "forge").version = "forge Version: 1.7.2";
  assert.throws(() => validateReleaseKernelEvidence(wrongForge, expected), /forge version evidence did not pass/u);

  const endOfLifeNode = structuredClone(evidence);
  endOfLifeNode.tools.find(({ id }) => id === "node").version = "v20.19.5";
  assert.throws(() => validateReleaseKernelEvidence(endOfLifeNode, expected), /node version evidence did not pass/u);
});

test("release SPDX aggregates both lockfiles with explicit kernel provenance", () => {
  const spdx = buildReleaseSpdx(kernelLocks, {
    commit: source.commit,
    created: "2026-08-03T00:00:00.000Z",
    version: "0.5.0"
  });
  assert.deepEqual(
    buildReleaseSpdx([...kernelLocks].reverse(), {
      commit: source.commit,
      created: "2026-08-03T00:00:00.000Z",
      version: "0.5.0"
    }),
    spdx
  );
  const packageIds = new Set(spdx.packages.map(({ SPDXID }) => SPDXID));
  assert.ok(packageIds.has("SPDXRef-Kernel-V1"));
  assert.ok(packageIds.has("SPDXRef-Kernel-V2"));
  for (const kernel of RELEASE_KERNELS) {
    const packageRecord = spdx.packages.find(({ SPDXID }) => SPDXID === `SPDXRef-Kernel-${kernel.id.toUpperCase()}`);
    const lock = kernelLocks.find(({ id }) => id === kernel.id);
    const lockRecord = spdx.files.find(({ SPDXID }) => SPDXID === `SPDXRef-Lockfile-${kernel.id.toUpperCase()}`);
    assert.equal(lockRecord.fileName, `./${lock.path}`);
    assert.equal(lockRecord.checksums[0].checksumValue, sha256(lock.bytes).toUpperCase());
    assert.match(packageRecord.comment, new RegExp(lock.path.replaceAll("/", "\\/"), "u"));
    assert.ok(spdx.relationships.some((relationship) => (
      relationship.spdxElementId === "SPDXRef-Package-Builder"
      && relationship.relationshipType === "CONTAINS"
      && relationship.relatedSpdxElement === packageRecord.SPDXID
    )));
    assert.ok(spdx.relationships.some((relationship) => (
      relationship.spdxElementId === lockRecord.SPDXID
      && relationship.relationshipType === "DEPENDENCY_MANIFEST_OF"
      && relationship.relatedSpdxElement === packageRecord.SPDXID
    )));
    assert.ok(spdx.relationships.some((relationship) => (
      relationship.spdxElementId === packageRecord.SPDXID
      && relationship.relationshipType === "DEPENDS_ON"
      && relationship.relatedSpdxElement.startsWith("SPDXRef-Dependency-")
    )));
  }
  assert.ok(spdx.packages.some(({ externalRefs = [] }) => externalRefs.some(({ referenceLocator }) => (
    referenceLocator.startsWith("pkg:npm/%40openzeppelin/")
  ))));
  assert.throws(
    () => buildReleaseSpdx([kernelLocks[0]], { commit: source.commit, created: "2026-08-03T00:00:00.000Z", version: "0.5.0" }),
    /requires both reference-kernel lockfiles/u
  );
});

function validEvidence() {
  return {
    schemaVersion: RELEASE_KERNEL_EVIDENCE_SCHEMA_VERSION,
    kind: RELEASE_KERNEL_EVIDENCE_KIND,
    status: RELEASE_KERNEL_EVIDENCE_STATUS,
    releaseEligible: true,
    source: {
      ...source,
      worktreeClean: true,
      worktreeStatusSha256: sha256("")
    },
    createdFromCommitTime: "2026-08-03T00:00:00.000Z",
    verifiedAt: "2026-08-03T01:00:00.000Z",
    selection: {
      mode: "release",
      kernels: RELEASE_KERNELS.map(({ id }) => id),
      checks: RELEASE_KERNEL_CHECKS.map(({ id }) => id)
    },
    tools: RELEASE_TOOL_VERSIONS.map((specification) => {
      const version = {
        node: "v24.14.0",
        npm: "11.16.0",
        forge: "forge Version: 1.7.1\nCommit SHA: example",
        slither: "0.11.5"
      }[specification.id];
      return {
        id: specification.id,
        command: [...specification.command],
        policy: specification.policy,
        version,
        accepted: true,
        timeoutMs: 1_200_000,
        durationMs: 1,
        exitCode: 0,
        stdout: createLogRecord(`${version}\n`),
        stderr: createLogRecord("")
      };
    }),
    kernels: RELEASE_KERNELS.map((specification) => {
      const lock = kernelLocks.find(({ id }) => id === specification.id);
      return {
        id: specification.id,
        sourcePath: specification.sourcePath,
        historicalFrozen: specification.historicalFrozen,
        lockfile: { path: lock.path, bytes: lock.bytes.length, sha256: sha256(lock.bytes) },
        testInventory: { unit: 1, fuzz: 1, invariant: 1, invariantPolicy: "required-and-present" },
        checks: RELEASE_KERNEL_CHECKS.map((check) => ({
          id: check.id,
          command: [...check.command],
          environment: { ...check.environment },
          workingDirectory: specification.sourcePath,
          executionMode: "isolated-temporary-copy",
          timeoutMs: 1_200_000,
          durationMs: 1,
          exitCode: 0,
          result: "PASS",
          stdout: createLogRecord("ok\n"),
          stderr: createLogRecord("")
        }))
      };
    }),
    externalActionsPerformed: []
  };
}
