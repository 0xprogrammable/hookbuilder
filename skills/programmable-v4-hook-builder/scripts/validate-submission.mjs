#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseCliOrExit } from "./cli-args.mjs";
import { applyRepositoryClosureToReport } from "./closure-report-core.mjs";
import { analyzeRepositoryReview } from "./review-target-core.mjs";
import { assertInsideRepository, resolveRepositoryRoot } from "./repository-root.mjs";
import { analyzeSubmission } from "./submission-core.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(scriptDirectory, "..", "references", "submission.schema.json");
const { options, positionals } = parseCliOrExit({
  command: "validate-submission.mjs",
  usage: "validate-submission.mjs <submission.json> [--write-report <path>] [--require-intake-ready | --require-ready | --require-prototype-validated] [--repository-root <path>]",
  summary: "Run the deterministic compatibility preflight for one submission document.",
  options: [
    { name: "--write-report", key: "reportPath", type: "value", valueName: "path", description: "Write the generated report to this path." },
    { name: "--require-intake-ready", key: "requireIntakeReady", type: "boolean", description: "Exit with status 1 unless repository closure reports STRUCTURALLY_COMPLETE." },
    { name: "--require-ready", key: "requireReady", type: "boolean", description: "Deprecated alias for --require-intake-ready." },
    { name: "--require-prototype-validated", key: "requirePrototypeValidated", type: "boolean", description: "Always fail closed; independent verification is required and this command does not perform it." },
    { name: "--repository-root", key: "repositoryRoot", type: "value", valueName: "path", description: "Bind repository source and build-closure diagnostics to this Git worktree." }
  ],
  positionals: { min: 1, max: 1, names: ["submission.json"] }
});
const input = positionals[0];
const reportPath = options.reportPath;
const requireIntakeReady = options.requireIntakeReady || options.requireReady;

let submission;
let schema;
let submissionPath;
let repositoryRoot = null;
try {
  submissionPath = path.resolve(input);
  if (options.repositoryRoot !== null) {
    repositoryRoot = resolveRepositoryRoot(options.repositoryRoot);
    submissionPath = assertInsideRepository(repositoryRoot, submissionPath);
  }
  submission = JSON.parse(fs.readFileSync(submissionPath, "utf8"));
  schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
} catch (error) {
  fail(error.message, 2);
}

let report = analyzeSubmission(submission, { schema });
if (
  repositoryRoot !== null
  && !report.findings.some(({ code, severity }) => code.startsWith("SCHEMA_") && severity !== "warning")
) {
  try {
    const repositoryReview = analyzeRepositoryReview({
      repositoryRoot,
      packageRoot: path.dirname(submissionPath),
      submission
    });
    report = applyRepositoryClosureToReport(report, repositoryReview.closure, {
      stage: submission.stage,
      runtimeAssets: repositoryReview.runtimeAssets
    });
  } catch (error) {
    fail(`repository closure: ${error.message}`, 2);
  }
}
const output = `${JSON.stringify(report, null, 2)}\n`;
process.stdout.write(output);

if (reportPath) {
  const absoluteReport = path.resolve(reportPath);
  fs.mkdirSync(path.dirname(absoluteReport), { recursive: true });
  fs.writeFileSync(absoluteReport, output, { flag: "w" });
}

if (options.requirePrototypeValidated) {
  process.stderr.write("validate-submission: INDEPENDENT_VERIFICATION_REQUIRED\n");
  process.exit(1);
}
if (
  requireIntakeReady
  && (
    report.readiness?.implementation !== "STRUCTURALLY_COMPLETE"
    || report.closure?.status !== "complete"
  )
) process.exit(1);

function fail(message, code) {
  console.error(`validate-submission: ${message}`);
  process.exit(code);
}
