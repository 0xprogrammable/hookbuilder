import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const cli = path.resolve(testDirectory, "..", "cli.mjs");

test("fresh ordinary launch scaffolds a permissionless token with the mandatory standard fee hook", () => {
  const repository = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-ordinary-cli-"));
  try {
    const initialized = childProcess.spawnSync("git", ["init", "--quiet", repository], {
      encoding: "utf8",
      shell: false
    });
    assert.equal(initialized.status, 0, initialized.stderr);

    const planDirectory = path.join(repository, "ordinary-plan");
    const started = run([
      "start",
      "--starter",
      "ordinary-launch",
      "--target",
      planDirectory
    ], repository);
    assert.equal(started.status, 0, started.stdout || started.stderr);

    const scaffolded = run([
      "scaffold",
      "ordinary-token",
      "--template-plan",
      path.join(planDirectory, "programmable-template.json"),
      "--repository-root",
      repository
    ], repository);
    assert.equal(scaffolded.status, 0, scaffolded.stdout || scaffolded.stderr);

    const submissionPath = path.join(repository, "submissions", "ordinary-token", "submission.json");
    const submission = JSON.parse(fs.readFileSync(submissionPath, "utf8"));
    assert.equal(submission.model.category, "permissionless-token");
    assert.match(submission.model.summary, /mandatory standard Programmable fee-hook profile/u);
    assert.match(submission.model.userOutcome, /no project-defined callback behavior beyond mandatory fee collection/u);
    assert.equal(submission.hook.used, true);
    assert.equal(submission.builderTemplate.templateSelection.starterId, "ordinary-launch");
    assert.ok(
      submission.builderTemplate.templateSelection.selectedCapabilityIds.includes("standard-programmable-fee-hook")
    );

    const checked = run([
      "check",
      submissionPath,
      "--no-write",
      "--repository-root",
      repository
    ], repository);
    assert.equal(checked.status, 0, checked.stdout || checked.stderr);
    const output = JSON.parse(checked.stdout);
    const codes = new Set(output.result.findings.map(({ code }) => code));
    assert.equal(codes.has("NOVEL_PROJECT_CATEGORY_REQUIRES_ARCHITECTURE_REVIEW"), false);
    assert.equal(codes.has("HOOK_USAGE_UNRESOLVED"), false);
    assert.equal(output.result.commandOutcome.zeroExitMeaning, "REPORT_GENERATED_ONLY_NOT_READINESS");
    assert.equal(output.result.reportWritten, null);

    const providerDisclosures = submission.projectCapabilities.find(({ id }) => id === "provider-disclosures");
    const publicMetadata = submission.projectCapabilities.find(({ id }) => id === "public-metadata");
    const metadataSurface = submission.projectSurfaces.find(({ id }) => id === "metadata-surface");
    assert.equal(providerDisclosures.securityTriggers.secretBoundary, false);
    assert.equal(publicMetadata.securityTriggers.secretBoundary, false);
    assert.equal(metadataSurface.exposure.usesSecrets, false);
    assert.equal(metadataSurface.profiles.secretBoundary.status, "not-applicable");
  } finally {
    fs.rmSync(repository, { recursive: true, force: true });
  }
});

test("Chainlink VRF selection materializes only the product-required provider surfaces", () => {
  const repository = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-chainlink-surface-"));
  try {
    assert.equal(childProcess.spawnSync("git", ["init", "--quiet", repository], { encoding: "utf8", shell: false }).status, 0);
    const planDirectory = path.join(repository, "chainlink-plan");
    const started = run(["start", "--starter", "ordinary-launch", "--chainlink-product", "vrf-v2-5", "--target", planDirectory], repository);
    assert.equal(started.status, 0, started.stdout || started.stderr);
    const scaffolded = run([
      "scaffold",
      "chainlink-provider-surface",
      "--template-plan",
      path.join(planDirectory, "programmable-template.json"),
      "--repository-root",
      repository
    ], repository);
    assert.equal(scaffolded.status, 0, scaffolded.stdout || scaffolded.stderr);
    const submission = JSON.parse(fs.readFileSync(path.join(repository, "submissions", "chainlink-provider-surface", "submission.json"), "utf8"));
    const provider = submission.projectSurfaces.find(({ id }) => id === "external-provider-surface");
    assert.ok(provider, JSON.stringify(submission.projectSurfaces, null, 2));
    assert.equal(provider.kind, "external-provider");
    assert.equal(provider.executionBoundary, "external-provider");
    assert.equal(provider.exposure.usesSecrets, true);
    assert.equal(provider.profiles.secretBoundary.status, "applicable");
    assert.equal(submission.builderTemplate.templateSelection.selectedPackIds.includes("chainlink-provider"), false);
    assert.equal(submission.builderTemplate.templateSelection.selectedCapabilityIds.includes("chainlink-provider"), true);
    assert.equal(submission.builderTemplate.templateSelection.selectedCapabilityIds.includes("chainlink-vrf-v2-5"), true);
    const surfaceIds = submission.projectSurfaces.map(({ id }) => id);
    assert.equal(surfaceIds.includes("keeper-surface"), false);
    assert.equal(surfaceIds.includes("service-surface"), false);
    assert.equal(surfaceIds.includes("external-provider-surface"), true);
  } finally {
    fs.rmSync(repository, { recursive: true, force: true });
  }
});

test("Chainlink foundation-only and product aliases fail early with one actionable recovery", () => {
  const repository = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-chainlink-product-choice-"));
  try {
    assert.equal(childProcess.spawnSync("git", ["init", "--quiet", repository], { encoding: "utf8", shell: false }).status, 0);
    const foundationOnly = run([
      "start", "--starter", "ordinary-launch", "--pack", "chainlink-provider", "--target", path.join(repository, "foundation")
    ], repository);
    assert.equal(foundationOnly.status, 1, foundationOnly.stdout || foundationOnly.stderr);
    const foundationOutput = JSON.parse(foundationOnly.stdout);
    assert.equal(foundationOutput.error.code, "CHAINLINK_PRODUCT_REQUIRED");
    assert.match(foundationOutput.error.message, /--chainlink-product vrf-v2-5/u);
    assert.equal(foundationOutput.error.details.eligibilityEffect, "none");

    const alias = run([
      "start", "--starter", "ordinary-launch", "--pack", "vrf", "--target", path.join(repository, "alias")
    ], repository);
    assert.equal(alias.status, 1, alias.stdout || alias.stderr);
    const aliasOutput = JSON.parse(alias.stdout);
    assert.equal(aliasOutput.error.code, "CHAINLINK_PRODUCT_ALIAS_INVALID");
    assert.match(aliasOutput.error.message, /--chainlink-product vrf-v2-5/u);
    assert.equal(aliasOutput.error.details.eligibilityEffect, "none");
  } finally {
    fs.rmSync(repository, { recursive: true, force: true });
  }
});

function run(args, cwd) {
  return childProcess.spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: "utf8",
    shell: false,
    timeout: 120_000
  });
}
