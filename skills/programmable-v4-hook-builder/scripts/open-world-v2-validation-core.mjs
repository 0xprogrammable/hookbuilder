import fs from "node:fs";
import path from "node:path";
import { CliFailure, requireJsonResult, runBundledCommand } from "./cli-runtime.mjs";
import { parseBoundedStrictJsonBytes } from "./strict-json-core.mjs";
import { validateOpenWorldPackageFromDisk } from "./open-world-v2-package-io.mjs";
import {
  OPEN_WORLD_V2_ARTIFACTS,
  OPEN_WORLD_V2_OPTIONAL_SUPPORTING_ARTIFACTS,
  OPEN_WORLD_V2_REVIEW_PACKAGE_IO_LIMITS,
  OPEN_WORLD_V2_SUBMISSION_FILE,
  OPEN_WORLD_V2_SUPPORTING_ARTIFACTS
} from "./open-world-v2-contracts.mjs";
import { createOpenWorldV2ValidationRuntime } from "./open-world-v2-validation-runtime.mjs";
import { validateOpenWorldV2Intake } from "./open-world-v2-validation-intake.mjs";
import { validateOpenWorldV2Intent } from "./open-world-v2-validation-intent.mjs";
import { validateOpenWorldV2Graph } from "./open-world-v2-validation-graph.mjs";
import { validateOpenWorldV2Fee } from "./open-world-v2-validation-fee.mjs";
import { finalizeOpenWorldV2Validation } from "./open-world-v2-validation-report.mjs";

const MAX_CHECK_INPUT_BYTES = 32 * 1024 * 1024;

export function detectOpenWorldV2Submission(submissionPath) {
  let value;
  try {
    value = parseBoundedStrictJsonBytes(fs.readFileSync(submissionPath), {
      maxSourceBytes: MAX_CHECK_INPUT_BYTES
    });
  } catch {
    return false;
  }
  return value?.$schema === "urn:programmable:v4-hook-submission:2.0.0"
    || (value?.schemaVersion === 2 && value?.standardVersion === "2.0.0");
}

export function executeOpenWorldV2Check({ submission, repositoryRoot, options, summarize }) {
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
  const completed = {
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
  return options.fullJson ? completed : summarize(completed);
}

function relative(repositoryRoot, target) {
  return path.relative(repositoryRoot, target).split(path.sep).join("/");
}

export function validateOpenWorldPackage({ packageRoot, fragmentLimits } = {}) {
  return validateOpenWorldPackageFromDisk({
    packageRoot,
    fragmentLimits,
    artifacts: OPEN_WORLD_V2_ARTIFACTS,
    supportingArtifacts: OPEN_WORLD_V2_SUPPORTING_ARTIFACTS,
    optionalSupportingArtifacts: OPEN_WORLD_V2_OPTIONAL_SUPPORTING_ARTIFACTS,
    submissionFile: OPEN_WORLD_V2_SUBMISSION_FILE,
    reviewPackageIoLimits: OPEN_WORLD_V2_REVIEW_PACKAGE_IO_LIMITS,
    validateSubmissionPackage: validateOpenWorldV2Package
  });
}

export function validateOpenWorldV2Package(options = {}) {
  const context = createOpenWorldV2ValidationRuntime(options);
  const earlyReport = validateOpenWorldV2Intake(context);
  if (earlyReport !== null) return earlyReport;
  validateOpenWorldV2Intent(context);
  validateOpenWorldV2Graph(context);
  validateOpenWorldV2Fee(context);
  return finalizeOpenWorldV2Validation(context);
}
