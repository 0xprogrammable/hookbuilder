import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  evaluateSizeBudget,
  loadSizeBudget
} from "../scripts/quality/size-budget.mjs";
import {
  buildReleaseSpdx,
  createLogRecord,
  inventorySolidityTests,
  RELEASE_KERNEL_CHECKS,
  RELEASE_KERNEL_EVIDENCE_KIND,
  RELEASE_KERNEL_EVIDENCE_SCHEMA_VERSION,
  RELEASE_KERNEL_EVIDENCE_STATUS,
  RELEASE_KERNELS,
  RELEASE_TOOL_VERSIONS,
  sha256,
  validateReleaseKernelEvidence
} from "../scripts/release-evidence-core.mjs";
import {
  BUNDLED_BUILDER_CHANNEL,
  BUNDLED_BUILDER_PUBLICATION_STATE,
  BUNDLED_BUILDER_VERSION
} from "../skills/programmable-v4-hook-builder/scripts/builder-lifecycle-shared.mjs";

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

function readText(relativePath) {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function sha256Text(value) {
  assert.equal(typeof value, "string");
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function markdownFiles(root) {
  const found = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if ([".git", "node_modules"].includes(entry.name)) continue;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolutePath);
      else if (entry.isFile() && entry.name.endsWith(".md")) found.push(absolutePath);
    }
  };
  visit(root);
  return found.sort();
}

function continuedCommands(source, prefix) {
  const lines = source.split("\n");
  const commands = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].includes(prefix)) continue;
    let command = lines[index];
    while (command.trimEnd().endsWith("\\") && index + 1 < lines.length) {
      index += 1;
      command += `\n${lines[index]}`;
    }
    commands.push(command);
  }
  return commands;
}

test("active Markdown installs resolve only the immutable v0.8.0 release package", () => {
  const documents = markdownFiles(repositoryRoot).map((absolutePath) => ({
    path: path.relative(repositoryRoot, absolutePath),
    source: fs.readFileSync(absolutePath, "utf8")
  }));
  const activeDocuments = documents.filter(({ path: documentPath }) => ![
    "docs/releases/v0.5.1.md",
    "docs/releases/v0.6.0.md",
    "docs/releases/v0.7.0.md"
  ].includes(documentPath)).filter(({ path: documentPath }) => ![
    "CHANGELOG.md",
    "docs/UNISWAP_MASTER_SKILL_ADOPTION.md"
  ].includes(documentPath));
  const installs = activeDocuments.flatMap((document) => continuedCommands(
    document.source,
    "gh skill install 0xprogrammable/hookbuilder"
  ).map((command) => ({ ...document, command })));
  const previews = activeDocuments.flatMap((document) => continuedCommands(
    document.source,
    "gh skill preview 0xprogrammable/hookbuilder"
  ).map((command) => ({ ...document, command })));

  assert.ok(installs.length > 0);
  assert.ok(previews.length > 0);
  for (const { path: documentPath, source, command } of installs) {
    assert.match(command, /(?:@v0\.8\.0\b|--pin\s+v0\.8\.0\b)/u, documentPath);
    assert.match(source, /(?:confirm|verify)[\s\S]{0,200}(?:public tag|GitHub exposes|GitHub release|tag and release)/iu, documentPath);
  }
  for (const { path: documentPath, command } of previews) {
    assert.match(command, /@v0\.8\.0\b/u, documentPath);
  }

  const forbiddenActiveClaims = [
    /\bv(?!0\.8\.0\b)\d+\.\d+(?:\.\d+)?\b[^\n]{0,96}\b(?:is|remains)\s+(?:the\s+)?(?:current|latest|stable|live|published)\b/iu,
    /\b(?:current|latest|stable|published)\s+(?:public\s+)?(?:release|version|identity|guidance)?[^\n]{0,80}\bv(?!0\.8\.0\b)\d+\.\d+(?:\.\d+)?\b/iu,
    /\bv(?!0\.8\.0\b)\d+\.\d+(?:\.\d+)?\b[^\n]{0,96}\badds?\s+(?:a\s+)?live\b/iu
  ];
  const changelog = documents.find(({ path: documentPath }) => documentPath === "CHANGELOG.md")?.source ?? "";
  const currentChangelogSection = changelog.match(/^## 0\.8\.0[^\n]*\n[\s\S]*?(?=^## 0\.7\.0)/mu)?.[0];
  assert.ok(currentChangelogSection);
  const claimDocuments = [
    ...activeDocuments,
    { path: "CHANGELOG.md#0.8.0", source: currentChangelogSection }
  ];
  for (const { path: documentPath, source } of claimDocuments) {
    for (const line of source.split("\n")) {
      if (/\b(?:historical|unreleased|not released|not published|predecessor|compatibility)\b/iu.test(line)) continue;
      for (const pattern of forbiddenActiveClaims) assert.doesNotMatch(line, pattern, documentPath);
    }
  }
});

test("stable v0.5.1 through v0.7.0 history is immutable and v0.8.0 is the release package", () => {
  const versionAuthority = readJson("config/plugin.json");
  const packageDocument = readJson("package.json");
  const packageLock = readJson("package-lock.json");
  const candidate = readJson("skills/programmable-v4-hook-builder/assets/templates/release-candidate.example.json");
  const readme = readText("README.md");
  const changelog = readText("CHANGELOG.md");
  const releasing = readText("docs/RELEASING.md");
  const candidateNotes = readText("docs/releases/v0.8.0.md");
  const releasedNotes = readText("docs/releases/v0.7.0.md");
  const previousNotes = readText("docs/releases/v0.6.0.md");
  const stableNotes = readText("docs/releases/v0.5.1.md");
  const artifactGenerator = readText("scripts/generate-release-artifacts.mjs");
  const rehearsal = readText("scripts/prepare-release-candidate.mjs");
  const stableSection = changelog.match(/^## 0\.5\.1[^\n]*\n[\s\S]*?(?=^## 0\.5\.0)/mu)?.[0];
  const previousSection = changelog.match(/^## 0\.6\.0[^\n]*\n[\s\S]*?(?=^## 0\.5\.1)/mu)?.[0];
  const releasedSection = changelog.match(/^## 0\.7\.0[^\n]*\n[\s\S]*?(?=^## 0\.6\.0)/mu)?.[0];

  assert.equal(versionAuthority.version, "0.8.0");
  assert.equal(packageDocument.version, versionAuthority.version);
  assert.equal(packageLock.version, versionAuthority.version);
  assert.equal(packageLock.packages[""].version, versionAuthority.version);
  assert.equal(BUNDLED_BUILDER_VERSION, versionAuthority.version);
  assert.equal(BUNDLED_BUILDER_CHANNEL, "stable");
  assert.equal(BUNDLED_BUILDER_PUBLICATION_STATE, "release-package");
  assert.equal(candidate.releaseVersion, versionAuthority.version);
  assert.equal(candidate.channel, "canary");
  assert.equal(candidate.publicState, "not-published");
  assert.equal(candidate.changeSetComplete, true);
  assert.deepEqual(candidate.unbundledChangeIds, []);
  assert.deepEqual(candidate.plannedRelease.builder, {
    fromVersion: "0.7.0",
    toVersion: "0.8.0",
    semanticClassification: "minor"
  });

  assert.equal(sha256Text(stableNotes), "e141136b2f5da9a4140912361c618883342e013c465f567930014a7e5a9415db");
  assert.equal(sha256Text(stableSection), "240e28d7a04e4e55bc81648c30d6ff4bcd78fc393eec16d516804be5224bfbf2");
  assert.equal(sha256Text(previousNotes), "ee25a4258d2d9d4147e1d6d23bba60f2ae79b9d59752c10830efafe77b94dfac");
  assert.equal(sha256Text(previousSection), "4d7c66de2e04a926814422a89940df4590033efeb2a308bf60650f3d82158deb");
  assert.equal(sha256Text(releasedNotes), "c7e6c94a3defdb4dca13b60c684aa8879896119cc7b08ad3e05b4ed1e089882e");
  assert.equal(sha256Text(releasedSection), "2ca3ad2da19559ae09e18aadc632afbe81a579c0dc5bb4b32b032f24a5488299");
  assert.match(readme, /Release package `v0\.8\.0`/u);
  assert.match(readme, /`publicationStateVerified: false`/u);
  assert.match(readme, /--pin v0\.8\.0/u);
  assert.match(changelog, /^## 0\.8\.0 - 2026-08-15$/mu);
  assert.match(changelog, /^## 0\.7\.0 - 2026-08-14$/mu);
  assert.match(changelog, /^## 0\.6\.0 - 2026-08-13$/mu);
  assert.match(candidateNotes, /^# Programmable v4 Builder v0\.8\.0$/mu);
  assert.match(candidateNotes, /complete Programmable requirement\s+set/u);
  assert.match(candidateNotes, /`publicationStateVerified: false`/u);
  assert.match(releasing, /Current release-package and installation identity: `v0\.8\.0`/u);
  assert.match(releasing, /`publicationStateVerified: false`/u);
  assert.match(releasing, /Prior immutable releases: `v0\.7\.0`, `v0\.6\.0`, and `v0\.5\.1`/u);
  assert.match(releasing, /Canonical version authority: `config\/plugin\.json`/u);
  assert.doesNotMatch(releasing, /git tag -a "?v0\.5\.1/u);
  assert.doesNotMatch(releasing, /gh release create "?v0\.5\.1/u);
  for (const releaseSource of [artifactGenerator, rehearsal]) {
    assert.match(releaseSource, /config\/plugin\.json/u);
    assert.match(releaseSource, /package\.json version must match canonical config\/plugin\.json version/u);
    assert.doesNotMatch(releaseSource, /v0\.5\.1/u);
  }
});

test("v0.8.0 release preparation binds the exact live Submit a Launch policy 1.2 dependency", () => {
  const candidateNotes = readText("docs/releases/v0.8.0.md");
  const runtimeSources = [
    "skills/programmable-v4-hook-builder/scripts/cli-central-base.mjs",
    "skills/programmable-v4-hook-builder/scripts/cli-central-canary-base.mjs",
    "skills/programmable-v4-hook-builder/scripts/submit-launch-policy-github.mjs",
    "skills/programmable-v4-hook-builder/scripts/workflow-canary-application-client.mjs"
  ].map(readText).join("\n");
  assert.match(candidateNotes, /policy version: `1\.2\.0`/u);
  assert.match(candidateNotes, /`2f4f57c8b450489dcd2de29672e31d63ca87ed35`/u);
  assert.match(candidateNotes, /`33dcc1457e80229fba2236c8a43f29d6ce38317b`/u);
  assert.match(candidateNotes, /`sha256:868c7a647238461f5bbc6afd15bd974d78a1a77f9a13aa1b81044d0e1ffe01dc`/u);
  for (const sourcePath of [
    "policy/launch-policy.v1.json",
    "policy/schemas/launch-policy.v1.schema.json",
  ]) assert.ok(candidateNotes.includes(`\`${sourcePath}\``), sourcePath);
  assert.match(candidateNotes, /not a permanent runtime pin/u);
  assert.match(candidateNotes, /resolve current protected `main`/u);
  assert.doesNotMatch(runtimeSources, /2f4f57c8b450489dcd2de29672e31d63ca87ed35/u);
  assert.doesNotMatch(runtimeSources, /33dcc1457e80229fba2236c8a43f29d6ce38317b/u);
});

test("current product docs keep central policy authority above the optional legacy fee kernel", () => {
  const currentDocuments = [
    "docs/AGENT_SKILL.md",
    "docs/ARCHITECTURE.md",
    "docs/KNOWLEDGE_SYSTEM.md",
    "docs/PLATFORM_INTEGRATION.md",
    "docs/SECURITY_AND_REVIEW.md",
    "docs/SECURITY_AUDIT_READINESS.md"
  ].map((documentPath) => ({ documentPath, source: readText(documentPath) }));
  for (const { documentPath, source } of currentDocuments) {
    assert.match(source, /current[\s\S]{0,160}exact central Submit Launch policy/iu, documentPath);
    assert.match(source, /preserved intent[\s\S]{0,180}(?:current|central-policy)\s+Rule/iu, documentPath);
  }
  assert.doesNotMatch(
    readText("docs/AGENT_SKILL.md"),
    /enforce the Programmable 10 bps volume-fee invariant on every Programmable execution scope/iu
  );
  assert.doesNotMatch(
    readText("docs/KNOWLEDGE_SYSTEM.md"),
    /mandatory inclusive 10 bps policy/iu
  );
});

test("candidate quantitative docs match generator-backed source inventories", () => {
  const maturity = readText("docs/CODE_MATURITY.md");
  const readiness = readText("docs/SECURITY_AUDIT_READINESS.md");
  const candidateNotes = readText("docs/releases/v0.8.0.md");
  const registry = readJson("skills/programmable-v4-hook-builder/references/contract-registry-v1.json");
  const sizeReport = evaluateSizeBudget({ repositoryRoot, budget: loadSizeBudget(repositoryRoot) });
  const v2Inventory = inventorySolidityTests(path.join(
    repositoryRoot,
    RELEASE_KERNELS.find(({ id }) => id === "v2").sourcePath,
    "test"
  ));
  const evalTestCount = fs.readdirSync(path.join(repositoryRoot, "evals", "tests"))
    .filter((name) => name.endsWith(".test.mjs"))
    .length;
  const productionModuleCount = sizeReport.discovery.discoveredFiles;

  assert.equal(sizeReport.status, "SIZE_BUDGET_PASSED");
  assert.equal(productionModuleCount, 327);
  assert.deepEqual(v2Inventory, { unit: 54, fuzz: 1, invariant: 3, invariantPolicy: "required-and-present" });
  assert.equal(registry.inventory.contractCount, 50);
  assert.equal(registry.inventory.validatorClosureCount, 25);
  assert.equal(registry.inventory.validatorClosureModuleBindingCount, 1034);
  assert.equal(registry.inventory.validatorClosureDistinctModuleCount, 176);
  assert.equal(evalTestCount, 9);

  for (const document of [maturity, candidateNotes]) {
    assert.match(document, new RegExp(`${productionModuleCount} production`, "u"));
    assert.match(document, new RegExp(`${registry.inventory.contractCount} (?:portable\\s+contracts|schema\\s+contracts)`, "u"));
    assert.match(document, new RegExp(`${registry.inventory.validatorClosureCount} validator closures`, "u"));
    assert.match(document, /1,034 transitive\s+(?:module\s+)?bindings/u);
    assert.match(document, new RegExp(`${registry.inventory.validatorClosureDistinctModuleCount} distinct modules`, "u"));
  }
  for (const document of [maturity, readiness, candidateNotes]) {
    assert.match(document, /54 unit, one fuzz and three invariant/u);
    assert.match(document, new RegExp(
      `${evalTestCount}\\s+(?:local test files|local test source files|\\x60evals/tests/\\*\\.test\\.mjs\\x60 files)`,
      "u"
    ));
  }
});

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

  for (const unsupportedVersion of ["v20.19.5", "v22.23.1", "v23.11.1"]) {
    const unsupportedNode = structuredClone(evidence);
    unsupportedNode.tools.find(({ id }) => id === "node").version = unsupportedVersion;
    assert.throws(
      () => validateReleaseKernelEvidence(unsupportedNode, expected),
      /node version evidence did not pass/u,
      unsupportedVersion
    );
  }
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
