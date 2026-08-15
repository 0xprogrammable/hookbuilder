#!/usr/bin/env node

import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../..");
const sourceSkillRoot = path.join(repositoryRoot, "skills/programmable-v4-hook-builder");
const maximumOutputBytes = 64 * 1024 * 1024;
const testTimeoutMs = 120_000;
const baselineTests = Object.freeze([
  "test/portable-skill/canonical-json-core.test.mjs",
  "test/portable-skill/strict-json-core.test.mjs",
  "test/portable-skill/public-claims.test.mjs",
  "test/portable-skill/github-application.test.mjs",
  "test/portable-skill/trade-capability-manifest.test.mjs"
]);
const mutations = Object.freeze([
  Object.freeze({
    id: "canonical-digest-algorithm",
    target: "scripts/canonical-json-core.mjs",
    test: "test/portable-skill/canonical-json-core.test.mjs",
    operator: "replace-sha256-with-sha512",
    search: 'crypto.createHash("sha256").update(canonicalJsonBytesV2(value, options))',
    replacement: 'crypto.createHash("sha512").update(canonicalJsonBytesV2(value, options))',
    failureProbe: "canonical JSON v2 matches the portable JSON vector corpus"
  }),
  Object.freeze({
    id: "strict-json-duplicate-key-bypass",
    target: "scripts/strict-json-core.mjs",
    test: "test/portable-skill/strict-json-core.test.mjs",
    operator: "disable-duplicate-key-branch",
    search: "if (keys.has(key)) {",
    replacement: "if (false && keys.has(key)) {",
    failureProbe: "strict JSON rejects same, conflicting, nested, and escaped-equivalent duplicate keys"
  }),
  Object.freeze({
    id: "application-prelaunch-bypass",
    target: "scripts/github-application-flow-core.mjs",
    test: "test/portable-skill/github-application.test.mjs",
    operator: "disable-prelaunch-intake-stop",
    search: 'if (state === "prelaunch") fail("INTAKE_PRELAUNCH"',
    replacement: 'if (false && state === "prelaunch") fail("INTAKE_PRELAUNCH"',
    failureProbe: "prelaunch, paused-new, and paused-all stop a new draft before writes"
  }),
  Object.freeze({
    id: "unsupported-public-claims-bypass",
    target: "scripts/public-claims-rules.mjs",
    test: "test/portable-skill/public-claims.test.mjs",
    operator: "disable-forbidden-claim-match",
    search: "if (forbiddenPatterns.some((pattern) => pattern.test(remainder)) && !findings.includes(rule.label))",
    replacement: "if (false && forbiddenPatterns.some((pattern) => pattern.test(remainder)) && !findings.includes(rule.label))",
    failureProbe: "unrelated negation does not hide an unsupported provider claim"
  }),
  Object.freeze({
    id: "standard-erc20-permit2-bypass",
    target: "scripts/v4-hook-semantic-contract-core.mjs",
    test: "test/portable-skill/trade-capability-manifest.test.mjs",
    operator: "allow-adapter-defined-funding-on-standard-erc20-route",
    search: '["permit2-allowance-transfer", "permit2-signature-transfer"].includes(funding.type) ? funding.type : "invalid"',
    replacement: '["permit2-allowance-transfer", "permit2-signature-transfer", "adapter-defined"].includes(funding.type) ? funding.type : "invalid"',
    failureProbe: "route endpoints, canonical entrypoints, funding tuples, slippage, and adapter conformance fail closed"
  }),
  Object.freeze({
    id: "nested-adapter-permit2-spender-bypass",
    target: "scripts/v4-hook-semantic-contract-core.mjs",
    test: "test/portable-skill/trade-capability-manifest.test.mjs",
    operator: "ignore-nested-universal-router-as-permit2-spender",
    search: 'return route.type === "standard-uniswap-v4" || route.transport !== null ? route.router.address : route.adapter.address;',
    replacement: 'return route.type === "standard-uniswap-v4" ? route.router.address : route.adapter.address;',
    failureProbe: "canonical adapter results build an envelope and execute its returned target, including nested Universal Router transport"
  })
]);

try {
  assertNoArguments(process.argv.slice(2));
  const report = runMutationGate();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.status !== "TARGETED_MUTATIONS_KILLED") process.exitCode = 1;
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

function runMutationGate() {
  const temporaryParent = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-mutation-gate-"));
  const temporarySkillRoot = path.join(temporaryParent, "skills", "programmable-v4-hook-builder");
  try {
    copyMutationFixture(temporaryParent, temporarySkillRoot);
    const baseline = runTests(temporaryParent, baselineTests);
    if (baseline.status !== 0 || baseline.error !== undefined || baseline.signal !== null) {
      throw new Error(`mutation baseline tests must pass before applying mutants:\n${diagnostic(baseline)}`);
    }

    const results = [];
    for (const mutation of mutations) {
      const sourcePath = path.join(sourceSkillRoot, mutation.target);
      const targetPath = path.join(temporarySkillRoot, mutation.target);
      const original = readBoundedText(sourcePath, 2 * 1024 * 1024, mutation.target);
      const mutant = replaceExactlyOnce(original, mutation.search, mutation.replacement, mutation.id);
      const sourceSha256 = sha256Text(original);
      const mutantSha256 = sha256Text(mutant);
      const testSourceSha256 = sha256Text(readBoundedText(
        path.join(repositoryRoot, mutation.test),
        2 * 1024 * 1024,
        mutation.test
      ));
      fs.writeFileSync(targetPath, mutant, "utf8");
      const result = runTests(temporaryParent, [mutation.test]);
      fs.writeFileSync(targetPath, original, "utf8");

      const output = diagnostic(result);
      if (result.error !== undefined || result.signal !== null) {
        throw new Error(`${mutation.id} did not complete as a test assertion failure:\n${output}`);
      }
      if (result.status === 0) {
        results.push(publicMutationResult(mutation, "SURVIVED", sourceSha256, mutantSha256, testSourceSha256, 0));
        continue;
      }
      if (!output.includes(mutation.failureProbe)) {
        throw new Error(`${mutation.id} failed for an unrelated reason; expected failing assertion ${JSON.stringify(mutation.failureProbe)}:\n${output}`);
      }
      results.push(publicMutationResult(
        mutation,
        "KILLED",
        sourceSha256,
        mutantSha256,
        testSourceSha256,
        result.status
      ));
    }

    const allKilled = results.every(({ status }) => status === "KILLED");
    return {
      schemaVersion: "1.1.0",
      kind: "programmable-targeted-mutation-evidence",
      status: allKilled ? "TARGETED_MUTATIONS_KILLED" : "TARGETED_MUTATION_SURVIVED",
      mutationScoreClaimed: false,
      scope: "six-reviewed-critical-assertion-mutations",
      baselineTestsPassed: true,
      mutations: results
    };
  } finally {
    removeOwnedTemporaryDirectory(temporaryParent, "programmable-mutation-gate-");
  }
}

function copyMutationFixture(temporaryRepositoryRoot, targetRoot) {
  fs.mkdirSync(targetRoot, { recursive: true });
  fs.cpSync(path.join(sourceSkillRoot, "scripts"), path.join(targetRoot, "scripts"), {
    recursive: true,
    errorOnExist: true,
    force: false,
    filter: portableCopyFilter
  });
  fs.mkdirSync(path.join(targetRoot, "assets"), { recursive: false });
  fs.cpSync(
    path.join(sourceSkillRoot, "assets/test-vectors"),
    path.join(targetRoot, "assets/test-vectors"),
    { recursive: true, errorOnExist: true, force: false, filter: portableCopyFilter }
  );
  fs.cpSync(path.join(sourceSkillRoot, "references"), path.join(targetRoot, "references"), {
    recursive: true,
    errorOnExist: true,
    force: false,
    filter: portableCopyFilter
  });
  fs.mkdirSync(path.join(temporaryRepositoryRoot, "test"), { recursive: true });
  fs.cpSync(
    path.join(repositoryRoot, "test", "portable-skill"),
    path.join(temporaryRepositoryRoot, "test", "portable-skill"),
    { recursive: true, errorOnExist: true, force: false, filter: portableCopyFilter }
  );
}

function portableCopyFilter(source) {
  const segment = path.basename(source);
  return !new Set([".git", "broadcast", "cache", "coverage", "node_modules", "out"]).has(segment);
}

function runTests(repositoryFixtureRoot, testPaths) {
  return childProcess.spawnSync(process.execPath, ["--test", ...testPaths], {
    cwd: repositoryFixtureRoot,
    encoding: "utf8",
    env: testChildEnvironment(),
    maxBuffer: maximumOutputBytes,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: testTimeoutMs
  });
}

function replaceExactlyOnce(source, search, replacement, id) {
  let count = 0;
  let cursor = 0;
  while ((cursor = source.indexOf(search, cursor)) !== -1) {
    count += 1;
    cursor += search.length;
  }
  if (count !== 1) throw new Error(`${id} mutation anchor must occur exactly once, observed ${count}`);
  return source.replace(search, replacement);
}

function publicMutationResult(mutation, status, sourceSha256, mutantSha256, testSourceSha256, testExitCode) {
  return {
    id: mutation.id,
    target: mutation.target,
    test: mutation.test,
    operator: mutation.operator,
    sourceSha256,
    mutantSha256,
    testSourceSha256,
    testFailureProbe: mutation.failureProbe,
    testExitCode,
    status
  };
}

function sha256Text(source) {
  return `sha256:${crypto.createHash("sha256").update(source, "utf8").digest("hex")}`;
}

function readBoundedText(filePath, maximumBytes, label) {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink file`);
  if (stat.size > maximumBytes) throw new Error(`${label} exceeds its ${maximumBytes}-byte limit`);
  return fs.readFileSync(filePath, "utf8");
}

function diagnostic(result) {
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}\n${result.error?.message ?? ""}`.trim();
}

function removeOwnedTemporaryDirectory(directory, prefix) {
  const realParent = fs.realpathSync(path.dirname(directory));
  const realTemporaryRoot = fs.realpathSync(os.tmpdir());
  if (realParent !== realTemporaryRoot || !path.basename(directory).startsWith(prefix)) {
    throw new Error("refusing to remove an unowned mutation temporary directory");
  }
  fs.rmSync(directory, { recursive: true, force: false });
}

function assertNoArguments(args) {
  if (args.length !== 0) throw new Error("usage: mutation-gate.mjs");
}

function testChildEnvironment() {
  const { NODE_TEST_CONTEXT: _nodeTestContext, ...environment } = process.env;
  return { ...environment, CI: "1", NO_COLOR: "1" };
}
