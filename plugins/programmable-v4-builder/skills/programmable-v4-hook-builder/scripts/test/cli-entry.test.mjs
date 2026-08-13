import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseCli } from "../cli-args.mjs";
import { materializeExample } from "../example-materializer-core.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(testDirectory, "..", "..");
const cli = path.join(skillRoot, "scripts", "cli.mjs");

test("CLI argument parser preserves repeated companion manifests in caller order", () => {
  const parsed = parseCli({
    command: "cli.mjs",
    options: [{
      name: "--companion-manifest",
      key: "companionManifests",
      type: "value",
      repeatable: true
    }],
    positionals: { min: 0, max: 0 }
  }, ["--companion-manifest", "a.json", "--companion-manifest=b.json"]);
  assert.deepEqual(parsed.options.companionManifests, ["a.json", "b.json"]);
});

test("doctor defaults to a concise readiness result and preserves full JSON on request", () => {
  const fixture = createRepository();
  try {
    const summary = runCli(["doctor", "--repository-root", fixture.repository]);
    assert.equal(summary.status, 0, summary.stdout || summary.stderr);
    assert.ok(Buffer.byteLength(summary.stdout) < 900);
    const summaryOutput = JSON.parse(summary.stdout);
    assert.equal(summaryOutput.result.status, "LOCAL_REPOSITORY_READY");
    assert.equal(summaryOutput.result.ready.repositoryWork, true);
    assert.equal(summaryOutput.result.ready.publicBeta, false);
    assert.equal(Object.hasOwn(summaryOutput.result, "tools"), false);

    const result = runCli(["doctor", "--json", "--repository-root", fixture.repository]);
    assert.equal(result.status, 0, result.stdout || result.stderr);
    assert.equal(result.stderr, "");
    const output = JSON.parse(result.stdout);
    assert.equal(output.schemaVersion, "1.0.0");
    assert.equal(output.command, "doctor");
    assert.equal(output.ok, true);
    assert.equal(output.result.repositoryRoot, fixture.repository);
    assert.equal(output.result.readyForDeterministicPreflight, true);
    assert.equal(
      output.result.readyForApplicationV3Preparation,
      output.result.readyForRepositoryWork
        && output.result.runtimeCompatibility.applicationV3.platformSupported
        && output.result.runtimeCompatibility.applicationV3.exactObjectGit.status === "ready"
    );
    assert.equal(
      output.result.applicationV3SubmissionToolchainAvailable,
      output.result.readyForApplicationV3Preparation && output.result.githubCli.available
    );
    assert.equal(output.result.readyForApplicationV3Submission, false);
    assert.equal(output.result.readyForPublicBeta, false);
    assert.equal(output.result.githubCli.requiredForPublicBetaApplication, true);
    assert.equal(output.result.githubCli.authenticationChecked, false);
    assert.equal(output.result.readyForGitHubApplicationClient, output.result.githubCli.available);
    assert.ok(output.result.publicBetaBlockers.includes("GITHUB_AUTHENTICATION_NOT_CHECKED"));
    assert.ok(output.result.publicBetaBlockers.includes("PUBLIC_GIT_REACHABILITY_NOT_CHECKED"));
    assert.ok(output.result.publicBetaBlockers.includes("EXTERNAL_ACCEPTANCE_NOT_CHECKED"));
    assert.equal(output.result.publicBetaGit.publicReachability.status, "notChecked");
    assert.equal(output.result.publicBetaGit.readyForPreparePrLocal, false);
  } finally {
    fixture.cleanup();
  }
});

test("CLI blocks every non-doctor command below Node 24 without blocking doctor dispatch", () => {
  const bootstrap = (args) => [
    'Object.defineProperty(process.versions, "node", { value: "22.23.1" });',
    `process.argv = [process.execPath, ${JSON.stringify(cli)}, ...${JSON.stringify(args)}];`,
    `await import(${JSON.stringify(pathToFileURL(cli).href)});`
  ].join("\n");
  const blocked = childProcess.spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", bootstrap(["context", "--help"])],
    { cwd: skillRoot, encoding: "utf8", shell: false }
  );
  assert.equal(blocked.status, 2, blocked.stdout || blocked.stderr);
  assert.equal(blocked.stderr, "");
  assert.equal(JSON.parse(blocked.stdout).error.code, "NODE_24_OR_NEWER_REQUIRED");

  const fixture = createRepository();
  try {
    const doctor = childProcess.spawnSync(
      process.execPath,
      ["--input-type=module", "--eval", bootstrap(["doctor", "--repository-root", fixture.repository])],
      { cwd: skillRoot, encoding: "utf8", shell: false }
    );
    assert.equal(doctor.status, 0, doctor.stdout || doctor.stderr);
    const report = JSON.parse(doctor.stdout);
    assert.equal(report.command, "doctor");
    assert.equal(report.ok, true);
  } finally {
    fixture.cleanup();
  }
});

test("doctor defaults to the installed plugin root when the host cwd is not a Git worktree", (t) => {
  const cacheRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "programmable-installed-plugin-")));
  t.after(() => fs.rmSync(cacheRoot, { recursive: true, force: true }));
  const pluginRoot = path.join(cacheRoot, "cache", "programmable-v4-builder");
  const installedSkillRoot = path.join(pluginRoot, "skills", "programmable-v4-hook-builder");
  const hostCwd = path.join(cacheRoot, "host-cwd");
  const transientDirectories = new Set(["broadcast", "cache", "coverage", "node_modules", "out"]);
  fs.mkdirSync(path.join(pluginRoot, ".codex-plugin"), { recursive: true });
  fs.mkdirSync(hostCwd, { recursive: true });
  fs.cpSync(skillRoot, installedSkillRoot, {
    recursive: true,
    filter: (source) => !transientDirectories.has(path.basename(source))
  });
  const repositoryRoot = path.resolve(skillRoot, "..", "..");
  const manifestCandidates = [
    path.join(repositoryRoot, ".codex-plugin", "plugin.json"),
    path.join(repositoryRoot, "plugins", "marketplace", "plugins", "programmable", ".codex-plugin", "plugin.json")
  ];
  const sourceManifest = manifestCandidates.find((candidate) => fs.existsSync(candidate));
  assert.ok(sourceManifest, "the repository must expose a generated Codex plugin manifest");
  fs.copyFileSync(sourceManifest, path.join(pluginRoot, ".codex-plugin", "plugin.json"));

  const result = childProcess.spawnSync(
    process.execPath,
    [path.join(installedSkillRoot, "scripts", "cli.mjs"), "doctor", "--json"],
    { cwd: hostCwd, encoding: "utf8", shell: false }
  );
  assert.equal(result.status, 0, result.stdout || result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  assert.equal(output.result.installedPackageRoot, fs.realpathSync(pluginRoot));
  assert.equal(output.result.repositoryRoot, fs.realpathSync(pluginRoot));
  assert.equal(output.result.repositoryRootSource, "installed-package");
  assert.deepEqual(output.result.gitWorktreeChecks, {
    status: "unavailable-not-a-worktree",
    available: false,
    discoveredRoot: null,
    reason: "the selected directory is not a Git worktree; Git-only preparation checks are unavailable"
  });
  assert.equal(output.result.readyForRepositoryWork, false);
  assert.equal(output.result.readyForApplicationV3Preparation, false);
  assert.equal(output.result.readyForApplicationV3Submission, false);
  assert.equal(output.result.publicBetaGit.gitRepository.status, "missing");
});

test("scaffold and check route through the canonical scripts with concise default diagnostics", () => {
  const fixture = createRepository();
  try {
    const scaffold = runCli([
      "scaffold",
      "entry-model",
      "--name",
      "Entry Model",
      "--repository-root",
      fixture.repository
    ]);
    assert.equal(scaffold.status, 0, scaffold.stdout || scaffold.stderr);
    assert.equal(scaffold.stderr, "");
    const scaffoldOutput = JSON.parse(scaffold.stdout);
    assert.equal(scaffoldOutput.command, "scaffold");
    assert.equal(scaffoldOutput.ok, true);
    assert.equal(scaffoldOutput.result.package, "submissions/entry-model");

    const submission = path.join(fixture.repository, "submissions", "entry-model", "submission.json");
    const report = path.join(fixture.repository, "submissions", "entry-model", "compatibility-report.json");
    const check = runCli(["check", submission, "--repository-root", fixture.repository]);
    assert.equal(check.status, 0, check.stdout || check.stderr);
    assert.ok(Buffer.byteLength(check.stdout) < 2_500, `concise V1 check emitted ${Buffer.byteLength(check.stdout)} bytes`);
    const checkOutput = JSON.parse(check.stdout);
    assert.equal(checkOutput.command, "check");
    assert.equal(checkOutput.ok, true);
    assert.equal(checkOutput.result.gatePassed, false);
    assert.equal(checkOutput.result.status, "REDESIGN_REQUIRED");
    assert.equal(checkOutput.result.submissionFormat, "v1");
    assert.deepEqual(checkOutput.result.commandOutcome, {
      blockingFindingsPresent: true,
      designReady: false,
      enforcedGate: "none",
      intakeReady: false,
      readinessFlags: ["--require-design-ready", "--require-intake-ready", "--require-prototype-validated"],
      reportGenerated: true,
      selectedGatePassed: null,
      zeroExitMeaning: "REPORT_GENERATED_ONLY_NOT_READINESS"
    });
    const persistedReport = JSON.parse(fs.readFileSync(report, "utf8"));
    assert.equal(checkOutput.result.submissionHash, persistedReport.submissionHash);
    assert.equal(checkOutput.result.diagnostics.counts.total, persistedReport.findings.length);
    assert.equal(
      Object.values(checkOutput.result.diagnostics.counts.bySeverity).reduce((total, count) => total + count, 0),
      persistedReport.findings.length
    );
    assert.equal(checkOutput.result.diagnostics.counts.displayedRootCauses, 3);
    assert.equal(checkOutput.result.diagnostics.primary.length, 3);
    assert.equal(new Set(checkOutput.result.diagnostics.primary.map(({ code }) => code)).size, 3);
    assert.equal(checkOutput.result.diagnostics.primary[0].code, "CAPABILITY_USAGE_UNRESOLVED");
    assert.equal(checkOutput.result.diagnostics.primary[0].occurrences, 9);
    assert.equal(checkOutput.result.diagnostics.primary[0].additionalLocations, 8);
    assert.equal(Object.hasOwn(checkOutput.result, "findings"), false);
    assert.deepEqual(checkOutput.result.reportWritten, {
      path: "submissions/entry-model/compatibility-report.json",
      submissionHash: persistedReport.submissionHash
    });
    assert.deepEqual(checkOutput.result.exhaustiveReport, {
      available: true,
      option: "--json",
      path: "submissions/entry-model/compatibility-report.json",
      source: "artifact-and-cli-opt-in",
      submissionHash: persistedReport.submissionHash
    });
    assert.match(checkOutput.result.next, /compatibility-report\.json/u);

    const complete = runCli(["check", submission, "--no-write", "--json", "--repository-root", fixture.repository]);
    assert.equal(complete.status, 0, complete.stdout || complete.stderr);
    const completeOutput = JSON.parse(complete.stdout);
    assert.equal(completeOutput.result.findings.length, persistedReport.findings.length);
    assert.equal(completeOutput.result.submissionHash, persistedReport.submissionHash);
    assert.equal(Object.hasOwn(completeOutput.result, "diagnostics"), false);

    const required = runCli([
      "check",
      submission,
      "--require-design-ready",
      "--repository-root",
      fixture.repository
    ]);
    assert.equal(required.status, 1, required.stdout || required.stderr);
    const requiredOutput = JSON.parse(required.stdout);
    assert.equal(requiredOutput.error.code, "CHECK_DESIGN_NOT_READY");
    assert.ok(requiredOutput.error.details.diagnostics.primary.length <= 3);
    assert.equal(Object.hasOwn(requiredOutput.error.details, "findings"), false);
    assert.equal(requiredOutput.error.details.commandOutcome.enforcedGate, "design-ready");
    assert.equal(requiredOutput.error.details.commandOutcome.selectedGatePassed, false);
    assert.equal(
      requiredOutput.error.details.commandOutcome.zeroExitMeaning,
      "SELECTED_READINESS_GATE_PASSED"
    );
  } finally {
    fixture.cleanup();
  }
});

test("check can diagnose without writing and rejects conflicting report options", () => {
  const fixture = createRepository();
  try {
    const scaffold = runCli(["scaffold", "read-only-check", "--repository-root", fixture.repository]);
    assert.equal(scaffold.status, 0, scaffold.stdout || scaffold.stderr);
    const submission = path.join(fixture.repository, "submissions", "read-only-check", "submission.json");
    const report = path.join(fixture.repository, "submissions", "read-only-check", "compatibility-report.json");
    const check = runCli(["check", submission, "--no-write", "--repository-root", fixture.repository]);
    assert.equal(check.status, 0, check.stdout || check.stderr);
    assert.equal(fs.existsSync(report), false);
    assert.equal(JSON.parse(check.stdout).result.reportWritten, null);

    const conflicting = runCli([
      "check",
      submission,
      "--no-write",
      "--write-report",
      report,
      "--repository-root",
      fixture.repository
    ]);
    assert.equal(conflicting.status, 2, conflicting.stdout || conflicting.stderr);
    assert.equal(JSON.parse(conflicting.stdout).error.code, "USAGE_ERROR");
  } finally {
    fixture.cleanup();
  }
});

test("check detects an open-world v2 submission and routes the complete package to the v2 validator", () => {
  const fixture = createRepository();
  try {
    const packageRoot = path.join(fixture.repository, "open-world-v2");
    fs.cpSync(path.join(skillRoot, "assets", "templates", "open-world-v2", "new-idea"), packageRoot, {
      recursive: true
    });
    const submission = path.join(packageRoot, "submission.v2.json");
    const result = runCli(["check", submission, "--no-write", "--repository-root", fixture.repository]);
    assert.equal(result.status, 0, result.stdout || result.stderr);
    assert.ok(Buffer.byteLength(result.stdout) < 2_200, `concise V2 check emitted ${Buffer.byteLength(result.stdout)} bytes`);
    assert.equal(result.stderr, "");
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.result.submissionFormat, "open-world-v2");
    assert.equal(output.result.package, "open-world-v2");
    assert.equal(output.result.valid, true);
    assert.equal(output.result.reportWritten, null);
    assert.equal(output.result.commandOutcome.zeroExitMeaning, "OPEN_WORLD_V2_PACKAGE_VALIDATED_NOT_APPROVAL");
    assert.equal(output.result.diagnostics.counts.total, 4);
    assert.equal(output.result.diagnostics.counts.distinctRootCauses, 4);
    assert.equal(output.result.diagnostics.counts.displayedRootCauses, 3);
    assert.equal(output.result.diagnostics.counts.omittedRootCauses, 1);
    assert.equal(output.result.diagnostics.primary.length, 3);
    assert.equal(new Set(output.result.diagnostics.primary.map(({ code }) => code)).size, 3);
    assert.equal(Object.hasOwn(output.result, "report"), false);
    assert.deepEqual(output.result.exhaustiveReport, {
      available: true,
      option: "--json",
      source: "cli-opt-in"
    });

    const complete = runCli(["check", submission, "--no-write", "--json", "--repository-root", fixture.repository]);
    assert.equal(complete.status, 0, complete.stdout || complete.stderr);
    const completeOutput = JSON.parse(complete.stdout);
    assert.equal(completeOutput.result.validatorCommand, "open-world validate");
    assert.equal(completeOutput.result.report.findings.length, output.result.diagnostics.counts.total);
  } finally {
    fixture.cleanup();
  }
});

test("check returns one recovery response when a v2 file is not a canonical package entry", () => {
  const fixture = createRepository();
  try {
    const source = path.join(skillRoot, "assets", "templates", "open-world-v2", "new-idea", "submission.v2.json");
    const renamed = path.join(fixture.repository, "submission.json");
    fs.copyFileSync(source, renamed);
    const result = runCli(["check", renamed, "--no-write", "--repository-root", fixture.repository]);
    assert.equal(result.status, 2, result.stdout || result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.error.code, "CHECK_V2_PACKAGE_REQUIRED");
    assert.match(output.error.message, /name this file submission\.v2\.json/u);
    assert.equal(output.error.details, undefined);
  } finally {
    fixture.cleanup();
  }
});

test("fresh scaffold, check and package reaches content gates without a hidden report flag", () => {
  const fixture = createRepository();
  try {
    const scaffold = runCli(["scaffold", "fresh-model", "--repository-root", fixture.repository]);
    assert.equal(scaffold.status, 0, scaffold.stdout || scaffold.stderr);
    const submission = path.join(fixture.repository, "submissions", "fresh-model", "submission.json");
    const report = path.join(fixture.repository, "submissions", "fresh-model", "compatibility-report.json");
    const check = runCli(["check", submission, "--repository-root", fixture.repository]);
    assert.equal(check.status, 0, check.stdout || check.stderr);
    assert.equal(fs.existsSync(report), true);

    const packaged = runCli([
      "package",
      path.dirname(submission),
      "--repository-root",
      fixture.repository
    ]);
    assert.equal(packaged.status, 1, packaged.stdout || packaged.stderr);
    const output = JSON.parse(packaged.stdout);
    assert.equal(output.error.code, "PACKAGE_INVALID");
    assert.ok(output.error.details.errors.some((entry) => entry.includes("builder.github")));
    assert.ok(output.error.details.errors.every((entry) => !entry.includes("compatibility-report.json is missing")));
  } finally {
    fixture.cleanup();
  }
});

test("package reports a Git LFS source mutation as tooling blocked after a valid committed check", () => {
  const fixture = createRepository();
  try {
    let result = runCli([
      "scaffold",
      "lfs-model",
      "--repository-root",
      fixture.repository
    ]);
    assert.equal(result.status, 0, result.stdout || result.stderr);
    const packageRoot = path.join(fixture.repository, "submissions", "lfs-model");
    const sourcePath = "submissions/lfs-model/app/main.ts";
    fs.mkdirSync(path.dirname(path.join(fixture.repository, sourcePath)), { recursive: true });
    fs.writeFileSync(path.join(fixture.repository, sourcePath), "export const ready = true;\n");

    const submissionPath = path.join(packageRoot, "submission.json");
    const submission = JSON.parse(fs.readFileSync(submissionPath, "utf8"));
    submission.builder.github = "lfs-builder";
    submission.builder.contact = "@lfs-builder";
    submission.builder.licenseDeclaration = "I own this proposal and submit it under MIT.";
    submission.implementation.sourcePaths = [sourcePath];
    fs.writeFileSync(submissionPath, `${JSON.stringify(submission, null, 2)}\n`);

    result = runCli(["check", submissionPath, "--repository-root", fixture.repository]);
    assert.equal(result.status, 0, result.stdout || result.stderr);
    runGit(fixture.repository, ["add", "."]);
    runGit(fixture.repository, ["commit", "--quiet", "-m", "valid checked proposal"]);

    fs.writeFileSync(path.join(fixture.repository, sourcePath), [
      "version https://git-lfs.github.com/spec/v1",
      `oid sha256:${"a".repeat(64)}`,
      "size 12345",
      ""
    ].join("\n"));
    result = runCli(["package", packageRoot, "--repository-root", fixture.repository]);
    assert.equal(result.status, 1, result.stdout || result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.error.code, "TOOLING_BLOCKED");
    assert.ok(output.error.details.errors.some((entry) => /Git LFS pointer is not materialized/u.test(entry)));
  } finally {
    fixture.cleanup();
  }
});

test("check rejects paths outside the selected repository and symbolic aliases", () => {
  const fixture = createRepository();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-cli-outside-"));
  try {
    const outsideSubmission = path.join(outside, "submission.json");
    fs.writeFileSync(outsideSubmission, "{}\n");
    const escaped = runCli([
      "check",
      outsideSubmission,
      "--repository-root",
      fixture.repository
    ]);
    assert.equal(escaped.status, 2);
    assert.equal(JSON.parse(escaped.stdout).error.code, "INVALID_PATH");

    const alias = path.join(fixture.repository, "submission-alias.json");
    fs.symlinkSync(outsideSubmission, alias);
    const linked = runCli([
      "check",
      alias,
      "--repository-root",
      fixture.repository
    ]);
    assert.equal(linked.status, 2);
    assert.equal(JSON.parse(linked.stdout).error.code, "INVALID_PATH");
  } finally {
    fixture.cleanup();
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test("package delegates to the existing package verifier", () => {
  const fixture = createReadyProposalRepository();
  try {
    const result = runCli([
      "package",
      fixture.packageRoot,
      "--repository-root",
      fixture.repository
    ]);
    assert.equal(result.status, 0, result.stdout || result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.command, "package");
    assert.equal(output.ok, true);
    assert.equal(output.result.intakeValidated, true);
    assert.equal(output.result.intake.state, "READY");
    assert.equal(output.result.intake.assurance, "static-structure-and-builder-declared-evidence-only");
    assert.equal(output.result.sandboxVerification.state, "NOT_RUN");
    assert.equal(output.result.deprecatedBooleanProjections.state, "DEPRECATED_COMPATIBILITY_ONLY");
    assert.equal(output.result.externalAuthority.acceptance, "NOT_CHECKED");
    assert.match(output.result.submissionHash, /^sha256:[0-9a-f]{64}$/);
  } finally {
    fixture.cleanup();
  }
});

test("companion command validates v2 structure and atomically writes canonical JSON without network", () => {
  const fixture = createRepository();
  const manifestPath = path.join(fixture.repository, "companion.json");
  try {
    const example = JSON.parse(fs.readFileSync(
      path.join(skillRoot, "assets", "templates", "companion-manifest-v2.example.json"),
      "utf8"
    ));
    fs.writeFileSync(manifestPath, `${JSON.stringify(example, null, 2)}\n`);
    let result = runCli([
      "companion",
      manifestPath,
      "--write-canonical",
      "--repository-root",
      fixture.repository
    ]);
    assert.equal(result.status, 0, result.stdout || result.stderr);
    let output = JSON.parse(result.stdout);
    assert.equal(output.result.schemaVersion, "2.0.0");
    assert.equal(output.result.closureStatus, "declared");
    assert.equal(output.result.rewritten, true);
    assert.equal(output.result.networkAccessed, false);
    assert.equal(output.result.prototypeClosureVerified, false);
    const canonical = fs.readFileSync(manifestPath, "utf8");
    assert.equal(canonical.split("\n").length, 2);

    result = runCli(["companion", manifestPath, "--repository-root", fixture.repository]);
    assert.equal(result.status, 0, result.stdout || result.stderr);
    output = JSON.parse(result.stdout);
    assert.equal(output.result.canonical, true);
    assert.equal(output.result.rewritten, false);
  } finally {
    fixture.cleanup();
  }
});

test("check exposes structural intake and fails closed for independent prototype validation", () => {
  const fixture = createReadyProposalRepository();
  try {
    const sourcePath = "submissions/ready-model/app/entry.ts";
    const sourceFile = path.join(fixture.repository, sourcePath);
    fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
    fs.writeFileSync(sourceFile, 'import value from "@/game/value"; export { value };\n');
    const submissionPath = path.join(fixture.packageRoot, "submission.json");
    const reportPath = path.join(fixture.packageRoot, "compatibility-report.json");
    const submission = JSON.parse(fs.readFileSync(submissionPath, "utf8"));
    submission.stage = "proposal";
    submission.implementation.sourcePaths.push(sourcePath);
    fs.writeFileSync(submissionPath, `${JSON.stringify(submission, null, 2)}\n`);

    let result = runCli(["check", submissionPath, "--repository-root", fixture.repository]);
    assert.equal(result.status, 0, result.stdout || result.stderr);
    let report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    assert.equal(report.closure.status, "incomplete");
    assert.ok(report.closure.diagnostics.some(({ code }) => code === "JAVASCRIPT_ALIAS_RESOLUTION_UNPROVEN"));

    submission.stage = "prototype";
    submission.launchPlan.callDataSourcePaths = [sourcePath];
    submission.launchPlan.hookConfigurationSourcePaths = [sourcePath];
    submission.launchPlan.liquiditySourcePaths = [sourcePath];
    submission.launchPlan.testPaths = [sourcePath];
    fs.writeFileSync(submissionPath, `${JSON.stringify(submission, null, 2)}\n`);
    result = runCli([
      "check",
      submissionPath,
      "--require-intake-ready",
      "--json",
      "--repository-root",
      fixture.repository
    ]);
    assert.equal(result.status, 1, result.stdout || result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.error.code, "CHECK_INTAKE_NOT_READY");
    assert.equal(output.error.details.closure.status, "incomplete");
    assert.ok(output.error.details.findings.some(({ code }) => code === "JAVASCRIPT_ALIAS_RESOLUTION_UNPROVEN"));
    report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    assert.equal(report.closure.status, "incomplete");

    result = runCli([
      "check",
      submissionPath,
      "--require-ready",
      "--repository-root",
      fixture.repository
    ]);
    assert.equal(result.status, 1, result.stdout || result.stderr);
    const deprecatedAlias = JSON.parse(result.stdout);
    assert.equal(deprecatedAlias.error.code, "CHECK_INTAKE_NOT_READY");

    result = runCli([
      "check",
      submissionPath,
      "--require-prototype-validated",
      "--require-design-ready",
      "--json",
      "--repository-root",
      fixture.repository
    ]);
    assert.equal(result.status, 1, result.stdout || result.stderr);
    const independent = JSON.parse(result.stdout);
    assert.equal(independent.error.code, "INDEPENDENT_VERIFICATION_REQUIRED");
    assert.equal(independent.error.details.sandboxVerification.state, "NOT_RUN");
  } finally {
    fixture.cleanup();
  }
});

test("prepare-pr entry fails closed with canonical JSON before external work", () => {
  const fixture = createReadyProposalRepository();
  try {
    const result = runCli([
      "prepare-pr",
      fixture.packageRoot,
      "--repository-root",
      fixture.repository
    ]);
    assert.equal(result.status, 1, result.stdout || result.stderr);
    assert.equal(result.stderr, "");
    const output = JSON.parse(result.stdout);
    assert.equal(output.command, "prepare-pr");
    assert.equal(output.ok, false);
    assert.equal(output.error.code, "WORKTREE_DIRTY");
  } finally {
    fixture.cleanup();
  }
});

test("child failures stay machine-readable and do not leak control characters", () => {
  const fixture = createRepository();
  try {
    const malicious = `missing-${String.fromCharCode(27)}[31m-path`;
    const result = runCli([
      "package",
      malicious,
      "--repository-root",
      fixture.repository
    ]);
    assert.equal(result.status, 2);
    assert.equal(result.stderr, "");
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, false);
    assert.equal(output.error.code, "INVALID_PATH");
    assert.doesNotMatch(output.error.message, /\u001b|\[31m/);
  } finally {
    fixture.cleanup();
  }
});

function runCli(args, cwd = skillRoot) {
  return childProcess.spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: "utf8",
    shell: false
  });
}

function createReadyProposalRepository() {
  const fixture = createRepository();
  const scaffold = childProcess.spawnSync(
    process.execPath,
    [path.join(skillRoot, "scripts", "scaffold-submission.mjs"), "ready-model", "--repository-root", fixture.repository],
    { cwd: fixture.repository, encoding: "utf8", shell: false }
  );
  assert.equal(scaffold.status, 0, scaffold.stderr);
  const packageRoot = path.join(fixture.repository, "submissions", "ready-model");
  const submissionPath = path.join(packageRoot, "submission.json");
  const submission = materializeExample({
    skillRoot,
    exampleId: "transparent-pool-scoped-fee",
    stepId: "fully-specified"
  });
  submission.model.id = "ready-model";
  submission.model.name = "Ready Model";
  submission.builder.github = "example-builder";
  submission.builder.contact = "@example-builder";
  submission.builder.licenseDeclaration = "I own this work and submit it under MIT.";
  fs.writeFileSync(submissionPath, `${JSON.stringify(submission, null, 2)}\n`);
  writeConcreteProposalDocuments(packageRoot, submission.model.name);
  const validation = childProcess.spawnSync(
    process.execPath,
    [
      path.join(skillRoot, "scripts", "validate-submission.mjs"),
      submissionPath,
      "--repository-root",
      fixture.repository,
      "--write-report",
      path.join(packageRoot, "compatibility-report.json")
    ],
    { cwd: fixture.repository, encoding: "utf8", shell: false }
  );
  assert.equal(validation.status, 0, validation.stderr);
  return { ...fixture, packageRoot };
}

function writeConcreteProposalDocuments(packageRoot, modelName) {
  const documents = {
    "PROPOSAL.md": `# ${modelName}\n\nThe project launches one token and uses one immutable pool-scoped hook to collect a visible fixed fee for an immutable beneficiary. The exact PoolManager settlement, beneficiary liability, claim path and failure behavior are recorded in submission.json. The hook has no administrator, proxy, pause, rescue or redirect authority.\n`,
    "THREAT_MODEL.md": `# ${modelName} threat model\n\nThe reviewed assets are both pool currencies and each PoolId-scoped beneficiary liability. PoolManager authentication, exact PoolId admission, token transfers, recipient claims and indexer reconstruction are separate trust boundaries. Every settlement or transfer failure reverts without borrowing another pool's balance.\n`,
    "TEST_PLAN.md": `# ${modelName} test plan\n\nPlanned checks cover permission bits, PoolManager authentication, all swap quadrants, exact fee rounding, zero final deltas, PoolId liability isolation, hostile token behavior, failed claims, event reconstruction and standard liquidity exits.\n`,
    "EVIDENCE.md": `# ${modelName} evidence\n\nThe deterministic compatibility report is recorded for this proposal. Contract, fuzz, invariant, static-analysis, deployment, routing and availability evidence remains planned and is not reported as completed.\n`
  };
  for (const [fileName, contents] of Object.entries(documents)) {
    fs.writeFileSync(path.join(packageRoot, fileName), contents);
  }
}

function createRepository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-cli-entry-"));
  runGit(root, ["init", "--quiet", "--initial-branch=main"]);
  runGit(root, ["config", "user.name", "CLI Test"]);
  runGit(root, ["config", "user.email", "cli@example.invalid"]);
  fs.writeFileSync(path.join(root, "foundry.toml"), "[profile.default]\n");
  fs.writeFileSync(path.join(root, "remappings.txt"), "");
  const repository = fs.realpathSync(root);
  return {
    repository,
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
}

function runGit(cwd, args) {
  const result = childProcess.spawnSync("git", args, { cwd, encoding: "utf8", shell: false });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
