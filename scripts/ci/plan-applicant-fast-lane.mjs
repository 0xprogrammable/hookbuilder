#!/usr/bin/env node

import childProcess from "node:child_process";
import fs from "node:fs";
import process from "node:process";

import {
  ApplicantFastLaneError,
  classifyChangedPaths,
  classifyPlatformChecks
} from "./applicant-fast-lane-core.mjs";
import { RELEASE_KERNELS } from "../release-evidence-core.mjs";
import { classifyHookbuilderApplicantPullRequest } from "../../skills/programmable-v4-hook-builder/scripts/registry-intake-contract.mjs";

const GIT_OBJECT_ID = /^[0-9a-f]{40}$/u;
const ZERO_COMMIT = "0".repeat(40);

try {
  const options = parseArgs(process.argv.slice(2), process.env);
  const entries = options.event === "pull_request" || (options.event === "push" && options.base !== ZERO_COMMIT)
    ? readChangedPaths(options.base, options.head)
    : [{ status: "M", path: ".github/workflows/ci.yml" }];
  const classification = classifyChangedPaths(entries);
  const applicantIntake = classifyHookbuilderApplicantPullRequest({
    event: options.event,
    pullRequest: options.pullRequest,
    requestPaths: classification.requestPaths,
    baseRef: options.ref
  });
  if (applicantIntake === "hookbuilder-base-invalid") {
    throw new ApplicantFastLaneError(
      "HOOKBUILDER_APPLICANT_BASE_INVALID",
      "legacy Hookbuilder Applicant updates must target main; new applications belong in 0xprogrammable/submit-launch"
    );
  }
  if (applicantIntake === "submit-launch-required") {
    throw new ApplicantFastLaneError(
      "HOOKBUILDER_APPLICANT_INTAKE_CLOSED",
      "new applications belong in 0xprogrammable/submit-launch; Hookbuilder accepts updates only on the frozen legacy pull-request list"
    );
  }
  const routing = classifyPlatformChecks({
    event: options.event,
    ref: options.ref,
    mode: classification.mode,
    paths: classification.paths
  });
  const plan = {
    ...classification,
    routing,
    event: options.event,
    ref: options.ref,
    pullRequest: options.pullRequest,
    base: options.base,
    head: options.head
  };
  if (options.output !== null) writeNewJson(options.output, plan);
  if (options.githubOutput !== null) {
    fs.appendFileSync(options.githubOutput, [
      `mode=${plan.mode}`,
      `reason=${plan.reason}`,
      `request_paths=${JSON.stringify(plan.requestPaths)}`,
      `change_plan_sha256=${plan.changePlanSha256}`,
      `head_sha=${plan.head}`,
      `repository_nodes=${JSON.stringify(plan.routing.repositoryNodes)}`,
      `reference_kernel_matrix=${JSON.stringify(referenceKernelMatrix(plan.routing.referenceKernels))}`,
      `reference_kernel_required=${String(plan.routing.referenceKernels.length > 0)}`,
      `codeql_required=${String(plan.routing.codeqlRequired)}`,
      `platform_lane_required=${String(plan.routing.platformLaneRequired)}`,
      `routing_plan_sha256=${plan.routing.routingPlanSha256}`
    ].join("\n") + "\n");
  }
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
} catch (error) {
  const code = error instanceof ApplicantFastLaneError ? error.code : "FAST_LANE_PLAN_FAILED";
  process.stderr.write(`plan-applicant-fast-lane: ${code}: ${error.message}\n`);
  process.exitCode = 1;
}

function parseArgs(args, environment) {
  const environmentRef = environment.CI_ROUTING_REF ?? null;
  const values = { event: null, ref: environmentRef, base: null, head: null, pullRequest: null, output: null, githubOutput: null };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--event") values.event = take(args, ++index, argument);
    else if (argument === "--ref") {
      const argumentRef = take(args, ++index, argument);
      if (environmentRef !== null && environmentRef !== argumentRef) {
        throw new Error("--ref does not match CI_ROUTING_REF");
      }
      values.ref = argumentRef;
    }
    else if (argument === "--base") values.base = take(args, ++index, argument);
    else if (argument === "--head") values.head = take(args, ++index, argument);
    else if (argument === "--pull-request") values.pullRequest = parsePullRequest(take(args, ++index, argument));
    else if (argument === "--output") values.output = take(args, ++index, argument);
    else if (argument === "--github-output") values.githubOutput = take(args, ++index, argument);
    else throw new Error(`unknown argument: ${argument}`);
  }
  if (!new Set(["pull_request", "push", "workflow_dispatch"]).has(values.event)) {
    throw new Error("--event must be pull_request, push, or workflow_dispatch");
  }
  if (values.ref === null) throw new Error("--ref is required");
  if (!GIT_OBJECT_ID.test(values.head ?? "")) throw new Error("--head must be an exact lowercase commit");
  if ((values.event === "pull_request" || values.event === "push") && !GIT_OBJECT_ID.test(values.base ?? "")) {
    throw new Error("--base must be an exact lowercase commit for pull requests and pushes");
  }
  if (values.event === "pull_request" && values.pullRequest === 0) {
    throw new Error("--pull-request must be a positive integer for pull requests");
  }
  if (values.event !== "pull_request" && values.pullRequest !== null && values.pullRequest !== 0) {
    throw new Error("--pull-request must be 0 or omitted outside pull requests");
  }
  if (values.event !== "pull_request" && values.pullRequest === 0) values.pullRequest = null;
  if (values.base === null) values.base = values.head;
  return values;
}

function referenceKernelMatrix(kernels) {
  const specifications = Object.fromEntries(RELEASE_KERNELS.map(({ id, sourcePath }) => [id, {
    kernel: id,
    workdir: sourcePath,
    lockfile: `${sourcePath}/package-lock.json`
  }]));
  return {
    include: kernels.length === 0
      ? [{ kernel: "not-routed", workdir: ".", lockfile: "package-lock.json" }]
      : kernels.map((kernel) => specifications[kernel])
  };
}

function parsePullRequest(value) {
  if (value === "0") return 0;
  if (!/^[1-9][0-9]*$/u.test(value)) {
    throw new Error("--pull-request must be a canonical positive integer or 0");
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error("--pull-request is outside the safe integer range");
  return number;
}

function readChangedPaths(base, head) {
  assertCommit(base);
  assertCommit(head);
  const mergeBase = resolveMergeBase(base, head);
  const result = childProcess.spawnSync(
    "git",
    ["diff", "--name-status", "-z", "--no-renames", mergeBase, head, "--"],
    { encoding: null, shell: false, stdio: ["ignore", "pipe", "pipe"] }
  );
  if (result.status !== 0) {
    throw new Error(`git diff failed: ${String(result.stderr).trim()}`);
  }
  const fields = result.stdout.toString("utf8").split("\0");
  if (fields.at(-1) === "") fields.pop();
  if (fields.length % 2 !== 0) throw new Error("git diff returned malformed name-status output");
  const entries = [];
  for (let index = 0; index < fields.length; index += 2) {
    entries.push({ status: fields[index], path: fields[index + 1] });
  }
  return entries;
}

function resolveMergeBase(base, head) {
  const result = childProcess.spawnSync("git", ["merge-base", base, head], {
    encoding: "utf8",
    shell: false,
    stdio: ["ignore", "pipe", "pipe"]
  });
  const mergeBase = result.status === 0 ? result.stdout.trim() : "";
  if (!GIT_OBJECT_ID.test(mergeBase)) throw new Error(`git merge-base failed: ${String(result.stderr).trim()}`);
  return mergeBase;
}

function assertCommit(revision) {
  const result = childProcess.spawnSync("git", ["cat-file", "-e", `${revision}^{commit}`], {
    encoding: "utf8",
    shell: false,
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.status !== 0) throw new Error(`git commit is unavailable: ${revision}`);
}

function take(args, index, flag) {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} needs a value`);
  return value;
}

function writeNewJson(output, value) {
  if (fs.existsSync(output)) throw new Error("--output must identify a new file");
  fs.writeFileSync(output, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
}
