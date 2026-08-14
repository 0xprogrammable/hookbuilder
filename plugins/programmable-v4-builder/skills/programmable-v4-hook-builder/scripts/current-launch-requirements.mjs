#!/usr/bin/env node

import process from "node:process";

import { CliFailure, emitFailure, emitSuccess } from "./cli-runtime.mjs";
import {
  currentSubmitLaunchBuildRequirements,
  normalizeSubmitLaunchBuildPolicyBinding
} from "./submit-launch-policy-contract.mjs";
import { resolveCurrentSubmitLaunchPolicy } from "./submit-launch-policy-github.mjs";

const usage = `Usage: current-launch-requirements.mjs

Read the exact protected 0xprogrammable/submit-launch:main policy and return its current build requirements.
This command is read-only. It grants no review, approval, deployment, routing, funds, or launch authority.`;

const args = process.argv.slice(2);
if (args.length === 1 && new Set(["--help", "-h"]).has(args[0])) {
  process.stdout.write(`${usage}\n`);
} else if (args.length !== 0) {
  process.exitCode = emitFailure("policy", new CliFailure(
    "USAGE_ERROR",
    "policy accepts no options; its repository, branch, paths, and build profile are fixed"
  ));
} else {
  try {
    const resolved = await resolveCurrentSubmitLaunchPolicy();
    const policyBinding = normalizeSubmitLaunchBuildPolicyBinding(resolved.buildPolicyBinding);
    const requirements = currentSubmitLaunchBuildRequirements(resolved);
    emitSuccess("policy", {
      schemaVersion: "programmable.current-launch-requirements.v1",
      policyBinding,
      policySchemaBinding: resolved.policySchemaBinding,
      requirements,
      networkAccessed: true,
      source: "exact-protected-submit-launch-main",
      authority: {
        checkerOnly: true,
        independentAudit: false,
        launchAuthorized: false,
        publicRoutingAuthorized: false,
        realFundsAuthorized: false
      }
    });
  } catch (error) {
    const code = typeof error?.code === "string" ? error.code : "CURRENT_POLICY_UNAVAILABLE";
    const message = typeof error?.message === "string"
      ? error.message
      : "the exact protected Submit Launch policy is unavailable";
    process.exitCode = emitFailure("policy", new CliFailure(code, message, { exitCode: 1 }));
  }
}
