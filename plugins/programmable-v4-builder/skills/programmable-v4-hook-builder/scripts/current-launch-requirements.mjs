#!/usr/bin/env node

import process from "node:process";

import { CliFailure, emitFailure, emitSuccess } from "./cli-runtime.mjs";
import { resolveCurrentSubmitLaunchContract } from "./submit-launch-policy-github.mjs";

const usage = `Usage: current-launch-requirements.mjs [--full]

Read the exact 0xprogrammable/submit-launch:main contract and return the compact build-stage plan.
--full also returns the bound manifest, Compatibility V2, policy, and schema data snapshot.
This command is read-only. It grants no review, approval, deployment, routing, funds, or launch authority.`;

const args = process.argv.slice(2);
if (args.length === 1 && new Set(["--help", "-h"]).has(args[0])) {
  process.stdout.write(`${usage}\n`);
} else if (args.length > 1 || (args.length === 1 && args[0] !== "--full")) {
  process.exitCode = emitFailure("policy", new CliFailure(
    "USAGE_ERROR",
    "policy accepts only --full; its repository, branch, paths, stage, and authority are fixed"
  ));
} else {
  try {
    const resolved = await resolveCurrentSubmitLaunchContract({
      stage: "build",
      routeState: "unresolved",
      includeFullSnapshot: args[0] === "--full"
    });
    emitSuccess("policy", {
      schemaVersion: "programmable.current-launch-requirements.v3",
      snapshotBinding: resolved.snapshotBinding,
      currentness: resolved.currentness,
      applicationContract: resolved.applicationContract,
      projectStage: resolved.projectStage,
      refreshRequiredBefore: [
        "architecture-commitment",
        "applicant-draft-plan",
        "launch-readiness",
        "production-promotion"
      ],
      networkAccessed: true,
      source: "exact-submit-launch-main-contract",
      authority: resolved.authority,
      ...(resolved.fullSnapshot === undefined ? {} : { fullSnapshot: resolved.fullSnapshot })
    });
  } catch (error) {
    const code = typeof error?.code === "string" ? error.code : "CURRENT_POLICY_UNAVAILABLE";
    const message = typeof error?.message === "string"
      ? error.message
      : "the exact protected Submit Launch policy is unavailable";
    process.exitCode = emitFailure("policy", new CliFailure(code, message, { exitCode: 1 }));
  }
}
