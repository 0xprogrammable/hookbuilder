#!/usr/bin/env node
import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseCli, renderHelp } from "./cli-args.mjs";
import { normalizeCompanionManifest } from "./companion-manifest-contract.mjs";
import { inspectLocalGitReadiness, preparePullRequest } from "./cli-prepare-pr.mjs";
import { runLaunchBundleV2Cli } from "./launch-bundle-v2.mjs";
import { assertInsideRepository, resolveInstalledPackageRoot, resolveRepositoryRoot } from "./repository-root.mjs";
import { CliFailure, emitFailure, emitSuccess, requireJsonResult, runBundledCommand } from "./cli-runtime.mjs";
import { canonicalJson } from "./submission-core.mjs";
import { parseBoundedStrictJsonBytes } from "./strict-json-core.mjs";
import { SUBMIT_LAUNCH_INTAKE_CONTRACT as INTAKE } from "./registry-intake-contract.mjs";
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const launchTarget = INTAKE.repository;
const MAX_CHECK_INPUT_BYTES = 32 * 1024 * 1024;
const delegatedCommands = new Map([
  ["open-world", { script: "open-world.mjs", prefix: [] }],
  ["application-recheck", { script: "application-recheck.mjs", prefix: [] }],
  ["context", { script: "knowledge-router.mjs", prefix: [] }],
  ["templates", { script: "template-catalog.mjs", prefix: [] }],
  ["discover", { script: "registry-discovery.mjs", prefix: [] }],
  ["resolve-contract", { script: "resolve-contract.mjs", prefix: [] }],
  ["start", { script: "template-catalog.mjs", prefix: ["materialize"] }],
  ["profile", { script: "build-profile.mjs", prefix: [] }], ["project", { script: "project-compiler.mjs", prefix: [] }],
  ["fee", { script: "fee-conformance.mjs", prefix: [] }],
  ["launch-bundle", { script: "launch-bundle.mjs", prefix: [] }],
  ["launch-plan-graph", { script: "launch-plan-graph.mjs", prefix: [] }],
  ["submit", { script: "github-application.mjs", prefix: ["submit"] }],
  ["status", { script: "github-application.mjs", prefix: ["status"] }],
  ["update", { script: "github-application.mjs", prefix: ["update"] }],
  ["version", { script: "builder-lifecycle.mjs", prefix: ["version"] }],
  ["update-check", { script: "builder-lifecycle.mjs", prefix: ["update-check"] }],
  ["migrate", { script: "builder-lifecycle.mjs", prefix: ["migrate"] }],
  ["plan-release", { script: "builder-lifecycle.mjs", prefix: ["plan-release"] }]
]);
const commandSpecs = new Map([
  ["doctor", {
    usage: "cli.mjs doctor [--json] [--repository-root <path>]",
    summary: "Inspect local readiness; --json adds complete diagnostics.",
    options: [repositoryOption(), { name: "--json", key: "fullJson", type: "boolean", description: "Include complete diagnostics." }],
    positionals: { min: 0, max: 0 }
  }],
  ["scaffold", {
    usage: "cli.mjs scaffold <model-id> [--name <display-name>] [--destination <path>] [--template-plan <programmable-template.json>] [--repository-root <path>]",
    summary: "Create one isolated proposal package through the canonical scaffolder.",
    options: [
      repositoryOption(),
      { name: "--name", key: "modelName", type: "value", valueName: "display-name", description: "Set the model display name." },
      { name: "--destination", key: "destination", type: "value", valueName: "path", description: "Create below this repository directory." },
      { name: "--template-plan", key: "templatePlan", type: "value", valueName: "programmable-template.json", description: "Bind one exact materialized starter and capability selection into the new submission." }
    ],
    positionals: { min: 1, max: 1, names: ["model-id"] }
  }],
  ["check", {
    usage: "cli.mjs check <submission.json> [--write-report <path> | --no-write] [--require-design-ready | --require-intake-ready | --require-ready | --require-prototype-validated] [--repository-root <path>]",
    summary: "Generate the canonical compatibility report. Without a --require-* gate, exit 0 means report generation only, not readiness.",
    options: [
      repositoryOption(),
      { name: "--write-report", key: "reportPath", type: "value", valueName: "path", description: "Write to this in-repository path; by default compatibility-report.json is written beside the submission." },
      { name: "--no-write", key: "noWrite", type: "boolean", description: "Return the diagnostic report without changing files." },
      { name: "--require-design-ready", key: "requireDesignReady", type: "boolean", description: "Fail unless the design axis is DESIGN_READY." },
      { name: "--require-intake-ready", key: "requireIntakeReady", type: "boolean", description: "Fail unless implementation is STRUCTURALLY_COMPLETE and repository closure is complete." },
      { name: "--require-ready", key: "requireReady", type: "boolean", description: "Deprecated alias for --require-intake-ready." },
      { name: "--require-prototype-validated", key: "requirePrototypeValidated", type: "boolean", description: "Always fail closed because this local command does not perform independent verification." }
    ],
    positionals: { min: 1, max: 1, names: ["submission.json"] }
  }],
  ["package", {
    usage: "cli.mjs package <submission-directory> [--require-intake-ready | --require-ready] [--repository-root <path>]",
    summary: "Validate the released V1 package; never execute project code.",
    options: [
      repositoryOption(),
      { name: "--require-intake-ready", key: "requireIntakeReady", type: "boolean", description: "Fail unless static package intake is READY." },
      { name: "--require-ready", key: "requireReady", type: "boolean", description: "Deprecated alias for --require-intake-ready." }
    ],
    positionals: { min: 1, max: 1, names: ["submission-directory"] }
  }],
  ["companion", {
    usage: "cli.mjs companion <manifest.json> [--write-canonical] [--repository-root <path>]",
    summary: "Validate a companion manifest and optionally rewrite canonical JSON without network access.",
    options: [
      repositoryOption(),
      { name: "--write-canonical", key: "writeCanonical", type: "boolean", description: "Atomically rewrite the manifest as canonical JSON with one trailing newline." }
    ],
    positionals: { min: 1, max: 1, names: ["manifest.json"] }
  }],
  ["prepare-pr", {
    usage: "cli.mjs prepare-pr <submission-directory> [--base main] [--companion-manifest <path>]... [--output-dir <path>] [--replace-existing | --replace-draft] [--repository-root <path>]",
    summary: "Prepare Submit a Launch PR metadata without a GitHub write.",
    options: [
      repositoryOption(),
      { name: "--base", key: "baseBranch", type: "value", valueName: "main", description: `Fixed target: ${launchTarget.slug}:${launchTarget.defaultBranch}.` },
      {
        name: "--companion-manifest",
        key: "companionManifests",
        type: "value",
        repeatable: true,
        valueName: "path",
        description: "Bind one canonical v1 or v2 companion manifest committed in primary HEAD. Repeat up to eight times."
      },
      { name: "--output-dir", key: "outputDirectory", type: "value", valueName: "path", description: "Materialize the frozen six-file package below an existing real parent directory outside the project repository." },
      { name: "--replace-existing", key: "replaceExisting", type: "boolean", description: "Create the first next-revision draft by replacing only an exact package from immutable main." },
      { name: "--replace-draft", key: "replaceDraft", type: "boolean", description: "Replace one self-consistent local draft while keeping the revision authorized by immutable main." }
    ],
    positionals: { min: 1, max: 1, names: ["submission-directory"] }
  }]
]);
const argv = process.argv.slice(2);
if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
  const helpRenderer = new Map([[false, globalHelp], [true, globalHelpJson]]).get(argv.includes("--json"));
  process.stdout.write(`${helpRenderer()}\n`);
  process.exit(0);
}
const command = argv[0];
const nodeMajor = Number.parseInt(process.versions.node.split(".", 1)[0], 10);
const nodeRuntimeSupported = Number.isInteger(nodeMajor) && nodeMajor >= 24;
if (command !== "doctor" && !nodeRuntimeSupported) {
  process.exitCode = emitFailure(command, new CliFailure(
    "NODE_24_OR_NEWER_REQUIRED",
    "Programmable v4 Builder requires Node.js 24 or newer"
  ));
} else if (command === "start" && (argv.slice(1).includes("--help") || argv.slice(1).includes("-h"))) {
  process.stdout.write(`${startHelp()}\n`);
} else if (command === "launch-bundle-v2") {
  const launchArgs = argv.slice(1);
  const directArgs = launchArgs.length === 1 && new Set(["--help", "-h", "--version"]).has(launchArgs[0]);
  process.exitCode = runLaunchBundleV2Cli({
    argv: directArgs ? launchArgs : ["prepare", ...launchArgs],
    cwd: process.cwd(),
    stdout: process.stdout
  });
} else if (delegatedCommands.has(command)) {
  process.exitCode = runDelegatedCommand(command, argv.slice(1));
} else if (!commandSpecs.has(command)) {
  process.exitCode = emitFailure(command, new CliFailure("UNKNOWN_COMMAND", `unknown command ${command}`));
} else if (argv.slice(1).includes("--help") || argv.slice(1).includes("-h")) {
  process.stdout.write(`${renderHelp({ command: "cli.mjs", ...commandSpecs.get(command) })}\n`);
} else {
  try {
    const { options, positionals } = parseCommand(command, argv.slice(1));
    const result = await execute(command, options, positionals);
    emitSuccess(command, result);
  } catch (error) {
    process.exitCode = emitFailure(command, error);
  }
}
async function execute(command, options, positionals) {
  if (command === "prepare-pr" && options.baseBranch !== null && options.baseBranch !== launchTarget.defaultBranch) {
    throw new CliFailure(
      "USAGE_ERROR",
      `the fixed target is ${launchTarget.slug}:${launchTarget.defaultBranch}`
    );
  }
  if (command === "prepare-pr" && options.replaceExisting && options.replaceDraft) {
    throw new CliFailure("USAGE_ERROR", "--replace-existing and --replace-draft are mutually exclusive");
  }
  if (
    command === "prepare-pr"
    && (options.replaceExisting || options.replaceDraft)
    && options.outputDirectory === null
  ) {
    throw new CliFailure("USAGE_ERROR", "replacement requires --output-dir");
  }
  if (
    command === "check"
    && options.requireDesignReady
    && (options.requireIntakeReady || options.requireReady)
  ) {
    throw new CliFailure(
      "USAGE_ERROR",
      "--require-design-ready cannot be combined with another readiness requirement"
    );
  }
  if (command === "check" && options.noWrite && options.reportPath !== null) {
    throw new CliFailure("USAGE_ERROR", "--no-write and --write-report are mutually exclusive");
  }
  const repositoryRoot = command === "doctor"
    ? resolveDoctorRoot(options.repositoryRoot)
    : resolveRoot(options.repositoryRoot);
  if (command === "doctor") {
    const doctorArguments = ["--json"];
    if (options.repositoryRoot !== null) doctorArguments.push("--repository-root", repositoryRoot);
    const tooling = requireJsonResult(
      runBundledCommand(
        "doctor.mjs",
        doctorArguments,
        { cwd: repositoryRoot, failureCode: "DOCTOR_FAILED" }
      ),
      "doctor.mjs"
    );
    const publicBetaGit = inspectLocalGitReadiness(repositoryRoot);
    const report = {
      ...tooling,
      publicBetaGit,
      readyForPublicBeta: false,
      publicBetaNote: publicBetaGit.readyForPreparePrLocal
        ? "Local Git gates are ready; public GitHub repository, commit and tree reachability remain notChecked until prepare-pr."
        : "One or more local Git gates block prepare-pr; public reachability remains notChecked."
    };
    const blockers = report.publicBetaBlockers.slice(0, 3);
    return new Map([[false, {
      status: ["LOCAL_TOOLING_BLOCKED", "IDEA_WORK_READY", "LOCAL_REPOSITORY_READY"][Number(report.readyForDeterministicPreflight) + Number(report.readyForRepositoryWork)],
      ready: { ideaWork: report.readyForIdeaWork, deterministicPreflight: report.readyForDeterministicPreflight, repositoryWork: report.readyForRepositoryWork, publicBeta: false },
      repository: { root: report.repositoryRoot, cleanWorktree: report.cleanWorktree, preparePrLocal: publicBetaGit.readyForPreparePrLocal },
      node: report.runtimeCompatibility.node,
      blockers,
      omittedBlockers: report.publicBetaBlockers.length - blockers.length,
      next: "If repositoryWork is true, run context --mode autopilot; otherwise rerun doctor --json."
    }], [true, report]]).get(options.fullJson);
  }
  if (command === "scaffold") {
    const [modelId] = positionals;
    const args = [modelId, "--repository-root", repositoryRoot];
    if (options.modelName !== null) args.push("--name", options.modelName);
    if (options.destination !== null) args.push("--destination", options.destination);
    if (options.templatePlan !== null) {
      args.push("--template-plan", resolveRegularFile(repositoryRoot, options.templatePlan));
    }
    const result = runBundledCommand("scaffold-submission.mjs", args, {
      cwd: repositoryRoot,
      failureCode: "SCAFFOLD_FAILED"
    });
    const destinationRoot = path.resolve(repositoryRoot, options.destination ?? "submissions");
    const packageRoot = resolveInside(repositoryRoot, path.join(destinationRoot, modelId));
    return {
      package: relative(repositoryRoot, packageRoot),
      filesCreated: fs.readdirSync(packageRoot).sort(),
      message: result.stdout
    };
  }
  if (command === "check") {
    const submission = resolveRegularFile(repositoryRoot, positionals[0]);
    if (detectSubmissionFormat(submission) === "open-world-v2") {
      return executeOpenWorldV2Check({ submission, repositoryRoot, options });
    }
    const args = [submission, "--repository-root", repositoryRoot];
    const result = requireJsonResult(
      runBundledCommand("validate-submission.mjs", args, {
        cwd: repositoryRoot,
        failureCode: "CHECK_FAILED"
      }),
      "validate-submission.mjs"
    );
    const reportPath = options.noWrite
      ? null
      : options.reportPath === null
        ? path.join(path.dirname(submission), "compatibility-report.json")
        : resolveWritablePath(repositoryRoot, options.reportPath);
    if (reportPath !== null) writeJsonAtomically(reportPath, result);
    const gatePassed = result.readiness?.design === "DESIGN_READY"
      && result.readiness?.implementation === "STRUCTURALLY_COMPLETE"
      && result.closure?.status === "complete";
    const completed = {
      ...result,
      gatePassed,
      commandOutcome: checkCommandOutcome(result, options),
      reportWritten: reportPath === null
        ? null
        : {
            path: relative(repositoryRoot, reportPath),
            submissionHash: result.submissionHash
          }
    };
    if (options.requirePrototypeValidated) {
      throw new CliFailure(
        "INDEPENDENT_VERIFICATION_REQUIRED",
        "prototype validation requires independent verification that this local command does not perform",
        { exitCode: 1, details: completed }
      );
    }
    if (options.requireDesignReady && result.readiness?.design !== "DESIGN_READY") {
      throw new CliFailure(
        "CHECK_DESIGN_NOT_READY",
        "the exact design has not reached DESIGN_READY",
        { exitCode: 1, details: completed }
      );
    }
    if (
      (options.requireIntakeReady || options.requireReady)
      && (
        result.readiness?.implementation !== "STRUCTURALLY_COMPLETE"
        || result.closure?.status !== "complete"
      )
    ) {
      throw new CliFailure(
        "CHECK_INTAKE_NOT_READY",
        "the exact implementation has not reached STRUCTURALLY_COMPLETE with complete repository closure",
        { exitCode: 1, details: completed }
      );
    }
    return completed;
  }
  if (command === "package") {
    const packageRoot = resolveDirectory(repositoryRoot, positionals[0]);
    const args = ["--repository-root", repositoryRoot];
    if (options.requireIntakeReady) args.push("--require-intake-ready");
    if (options.requireReady) args.push("--require-ready");
    args.push(packageRoot);
    try {
      return requireJsonResult(
        runBundledCommand(
          "verify-package.mjs",
          args,
          { cwd: repositoryRoot, failureCode: "PACKAGE_INVALID" }
        ),
        "verify-package.mjs"
      );
    } catch (error) {
      if (error instanceof CliFailure && error.details?.validationState === "TOOLING_BLOCKED") {
        throw new CliFailure(
          "TOOLING_BLOCKED",
          "declared source/test content requires materialization or supported tooling before packaging",
          { exitCode: 1, details: error.details }
        );
      }
      throw error;
    }
  }
  if (command === "companion") {
    const manifestPath = resolveRegularFile(repositoryRoot, positionals[0]);
    const bytes = fs.readFileSync(manifestPath);
    if (bytes.length < 2 || bytes.length > 65_536) {
      throw new CliFailure("COMPANION_MANIFEST_INVALID", "companion manifest exceeds the bounded byte limit");
    }
    let value;
    try {
      value = parseBoundedStrictJsonBytes(bytes, {
        maxSourceBytes: 65_536,
        maxDepth: 128,
        maxNodes: 20_000,
        maxNumberCharacters: 65_536
      });
    } catch {
      throw new CliFailure("COMPANION_MANIFEST_INVALID", "companion manifest must be duplicate-free UTF-8 JSON");
    }
    let normalized;
    try {
      normalized = normalizeCompanionManifest(value);
    } catch (error) {
      throw new CliFailure("COMPANION_MANIFEST_INVALID", error?.message ?? "companion manifest is invalid");
    }
    const canonicalBytes = Buffer.from(`${canonicalJson(value)}\n`, "utf8");
    const wasCanonical = bytes.equals(canonicalBytes);
    if (options.writeCanonical && !wasCanonical) writeCanonicalAtomically(manifestPath, canonicalBytes);
    return {
      path: relative(repositoryRoot, manifestPath),
      schemaVersion: normalized.schemaVersion,
      closureStatus: normalized.closureStatus,
      canonical: wasCanonical || options.writeCanonical,
      rewritten: options.writeCanonical && !wasCanonical,
      networkAccessed: false,
      prototypeClosureVerified: false,
      note: normalized.schemaVersion === "2.0.0"
        ? "Manifest structure is valid; prepare-pr still verifies exact public Git objects, npm closure and successful CI."
        : "Manifest v1 remains proposal-compatible and closure-incomplete."
    };
  }
  return preparePullRequest({
    repositoryRoot,
    packageInput: positionals[0],
    baseBranch: options.baseBranch ?? "main",
    companionManifestInputs: options.companionManifests,
    outputDirectory: options.outputDirectory,
    replaceExisting: options.replaceExisting,
    replaceDraft: options.replaceDraft
  });
}
function parseCommand(command, args) {
  try {
    return parseCli({ command: "cli.mjs", ...commandSpecs.get(command) }, args);
  } catch (error) {
    throw new CliFailure("USAGE_ERROR", error.message);
  }
}
function resolveRoot(input) {
  try {
    return resolveRepositoryRoot(input);
  } catch (error) {
    throw new CliFailure("REPOSITORY_REQUIRED", error.message);
  }
}
function resolveDoctorRoot(input) {
  if (input !== null) return resolveRoot(input);
  try {
    return resolveInstalledPackageRoot(scriptDirectory);
  } catch (error) {
    throw new CliFailure("PACKAGE_ROOT_UNAVAILABLE", error.message);
  }
}
function resolveInside(repositoryRoot, target, { allowMissing = false } = {}) {
  try {
    return assertInsideRepository(repositoryRoot, target, { allowMissing });
  } catch (error) {
    throw new CliFailure("INVALID_PATH", error.message);
  }
}
function resolveRegularFile(repositoryRoot, input) {
  if (unsafePathInput(input)) throw new CliFailure("INVALID_PATH", "path contains unsafe characters");
  const target = resolveInside(repositoryRoot, path.resolve(repositoryRoot, input));
  if (!fs.statSync(target).isFile()) throw new CliFailure("INVALID_PATH", "path is not a regular file");
  return target;
}
function resolveDirectory(repositoryRoot, input) {
  if (unsafePathInput(input)) throw new CliFailure("INVALID_PATH", "path contains unsafe characters");
  const target = resolveInside(repositoryRoot, path.resolve(repositoryRoot, input));
  if (!fs.statSync(target).isDirectory()) throw new CliFailure("INVALID_PATH", "path is not a directory");
  return target;
}
function resolveWritablePath(repositoryRoot, input) {
  if (unsafePathInput(input)) throw new CliFailure("INVALID_PATH", "path contains unsafe characters");
  return resolveInside(repositoryRoot, path.resolve(repositoryRoot, input), { allowMissing: true });
}
function unsafePathInput(value) {
  return typeof value !== "string"
    || value.length === 0
    || /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u.test(value);
}
function relative(repositoryRoot, target) {
  return path.relative(repositoryRoot, target).split(path.sep).join("/");
}
function writeJsonAtomically(target, value) {
  const directory = path.dirname(target);
  fs.mkdirSync(directory, { recursive: true });
  const temporaryDirectory = fs.mkdtempSync(path.join(directory, ".programmable-check-"));
  const temporaryPath = path.join(temporaryDirectory, "compatibility-report.json");
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
    fs.renameSync(temporaryPath, target);
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}
function writeCanonicalAtomically(target, bytes) {
  const directory = path.dirname(target);
  const temporaryDirectory = fs.mkdtempSync(path.join(directory, ".programmable-companion-"));
  const temporaryPath = path.join(temporaryDirectory, "manifest.json");
  try {
    fs.writeFileSync(temporaryPath, bytes, { flag: "wx", mode: 0o600 });
    fs.renameSync(temporaryPath, target);
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}
function repositoryOption() {
  return {
    name: "--repository-root",
    key: "repositoryRoot",
    type: "value",
    valueName: "path",
    description: "Use this Git worktree instead of the current directory."
  };
}
function globalHelp() {
  return [
    "Usage: cli.mjs <command> [options]",
    "",
    "Programmable v4 Builder. Local checks are not approval.",
    "",
    "Golden path:",
    "  doctor        Check local readiness.",
    "  context       Route the confirmed task.",
    "  project       Materialize and verify output.",
    "  prepare-pr    Prepare read-only PR metadata.",
    "",
    "Start: cli.mjs doctor -> cli.mjs context --mode autopilot -> cli.mjs project --help",
    "Optional templates: cli.mjs templates list",
    "All commands: cli.mjs --help --json"
  ].join("\n");
}
function globalHelpJson() {
  const commands = [...new Set(["launch-bundle-v2", ...delegatedCommands.keys(), ...commandSpecs.keys()])]
    .sort().map((id) => ({ id, help: `cli.mjs ${id} --help` }));
  return canonicalJson({ schemaVersion: "1.0.0", ok: true, command: "help", result: { goldenPath: ["doctor", "context", "project", "prepare-pr"], commands } });
}
function startHelp() {
  return [
    "Usage: cli.mjs start --starter <id> --target <new-directory>",
    "       [--pack <id>]... [--capability <known-id>]... [--custom-capability <id>=<visible-label>]...",
    "       [--chainlink-product ccip|cre|data-feeds|data-streams|vrf-v2-5]...",
    "       [--local-tag <slug>]...",
    "",
    "Create one deterministic planning directory from a starter and capability packs.",
    "--target names the new directory itself; its parent must already exist.",
    "Keep the plan inside the project repository when it will later be passed to cli.mjs scaffold.",
    "Dependencies and mandatory packs are included automatically.",
    "Chainlink requires --chainlink-product with one exact product; --pack chainlink-provider is intentionally incomplete.",
    "Known --capability selections are exact Legos and never expand sibling capabilities from a pack.",
    "Unknown capabilities stay eligible and route to architecture review.",
    "No Git, network, submission, deployment or publication action occurs."
  ].join("\n");
}
function checkCommandOutcome(result, options) {
  const enforcedGate = options.requirePrototypeValidated
    ? "independent-prototype-validation"
    : options.requireDesignReady
      ? "design-ready"
      : options.requireIntakeReady || options.requireReady
        ? "intake-ready"
        : "none";
  const blockingFindingsPresent = (result.findings ?? [])
    .some(({ severity }) => severity === "hard" || severity === "blocker");
  const designReady = result.readiness?.design === "DESIGN_READY";
  const intakeReady = result.readiness?.implementation === "STRUCTURALLY_COMPLETE"
    && result.closure?.status === "complete";
  const selectedGatePassed = enforcedGate === "design-ready"
    ? designReady
    : enforcedGate === "intake-ready"
      ? intakeReady
      : enforcedGate === "independent-prototype-validation"
        ? false
        : null;
  return {
    reportGenerated: true,
    enforcedGate,
    selectedGatePassed,
    blockingFindingsPresent,
    designReady,
    intakeReady,
    zeroExitMeaning: enforcedGate === "none"
      ? "REPORT_GENERATED_ONLY_NOT_READINESS"
      : "SELECTED_READINESS_GATE_PASSED",
    readinessFlags: ["--require-design-ready", "--require-intake-ready", "--require-prototype-validated"]
  };
}

function detectSubmissionFormat(submissionPath) {
  let value;
  try {
    value = parseBoundedStrictJsonBytes(fs.readFileSync(submissionPath), {
      maxSourceBytes: MAX_CHECK_INPUT_BYTES
    });
  } catch {
    return "v1-or-unknown";
  }
  if (
    value?.$schema === "urn:programmable:v4-hook-submission:2.0.0"
    || (value?.schemaVersion === 2 && value?.standardVersion === "2.0.0")
  ) return "open-world-v2";
  return "v1-or-unknown";
}

function executeOpenWorldV2Check({ submission, repositoryRoot, options }) {
  if (path.basename(submission) !== "submission.v2.json") {
    throw new CliFailure(
      "CHECK_V2_PACKAGE_REQUIRED",
      "open-world v2 uses a package: name this file submission.v2.json, keep its bound companion records beside it, then rerun check"
    );
  }
  if (options.reportPath !== null) {
    throw new CliFailure(
      "CHECK_V2_REPORT_PATH_UNSUPPORTED",
      "open-world v2 validation is read-only and does not write a V1 compatibility report; remove --write-report and rerun check"
    );
  }
  if (
    options.requireDesignReady
    || options.requireIntakeReady
    || options.requireReady
    || options.requirePrototypeValidated
  ) {
    throw new CliFailure(
      "CHECK_V2_GATE_UNSUPPORTED",
      "open-world v2 has its own package validity and review states; remove the V1 --require-* flag and rerun check"
    );
  }
  const packageRoot = path.dirname(submission);
  let delegated;
  try {
    delegated = requireJsonResult(
      runBundledCommand(
        "open-world.mjs",
        ["validate", packageRoot, "--repository-root", repositoryRoot],
        { cwd: repositoryRoot, failureCode: "OPEN_WORLD_V2_PACKAGE_INVALID" }
      ),
      "open-world.mjs"
    );
  } catch (error) {
    if (error instanceof CliFailure && error.code === "OPEN_WORLD_V2_PACKAGE_INVALID") {
      throw new CliFailure(
        "OPEN_WORLD_V2_PACKAGE_INVALID",
        "the detected open-world v2 submission must be checked with its complete bound package",
        {
          exitCode: error.exitCode,
          details: {
            submissionFormat: "open-world-v2",
            package: relative(repositoryRoot, packageRoot),
            recoveryCommand: `node $SKILL_ROOT/scripts/cli.mjs open-world validate ${relative(repositoryRoot, packageRoot)} --repository-root $REPOSITORY_ROOT`,
            validatorResult: error.details
          }
        }
      );
    }
    throw error;
  }
  return {
    ...delegated.result,
    submissionFormat: "open-world-v2",
    validatorCommand: "open-world validate",
    reportWritten: null,
    commandOutcome: {
      reportGenerated: true,
      enforcedGate: "open-world-v2-package-valid",
      selectedGatePassed: delegated.result?.valid === true,
      zeroExitMeaning: "OPEN_WORLD_V2_PACKAGE_VALIDATED_NOT_APPROVAL"
    }
  };
}
function runDelegatedCommand(command, args) {
  const delegated = delegatedCommands.get(command);
  const scriptPath = path.join(scriptDirectory, delegated.script);
  const result = childProcess.spawnSync(process.execPath, [scriptPath, ...delegated.prefix, ...args], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: process.env,
      maxBuffer: 32_000_000,
      shell: false,
      timeout:120_000+2_580_000*+(command+args[0]+args.includes("--write")==="projectmaterializetrue")
    });
  if (result.error) {
    return emitFailure(
      command,
      new CliFailure("DELEGATED_COMMAND_FAILED", `${command} could not complete: ${result.error.message}`)
    );
  }
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return Number.isInteger(result.status) ? result.status : 1;
}
