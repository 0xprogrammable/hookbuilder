import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const cli = path.resolve(testDirectory, "..", "..", "skills", "programmable-v4-hook-builder", "scripts", "cli.mjs");

test("current ordinary launch plans cannot enter the frozen legacy V1 scaffold", () => {
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
    assert.equal(scaffolded.status, 2, scaffolded.stdout || scaffolded.stderr);
    const failure = JSON.parse(scaffolded.stdout);
    assert.equal(failure.error.code, "SCAFFOLD_FAILED");
    assert.match(failure.error.message, /frozen legacy V1 scaffold does not accept current catalog plans/u);
    assert.match(failure.error.message, /use project materialize for current builds/u);
    assert.equal(fs.existsSync(path.join(repository, "submissions")), false);
  } finally {
    fs.rmSync(repository, { recursive: true, force: true });
  }
});

test("every current Chainlink product plan remains outside the frozen legacy V1 scaffold", () => {
  const cases = [
    ["ccip", "chainlink-ccip", "cross-chain-messaging"],
    ["cre", "chainlink-cre", "keeper-automation"],
    ["data-feeds", "chainlink-data-feeds", "oracle-data"],
    ["data-streams", "chainlink-data-streams", "oracle-data"],
    ["vrf-v2-5", "chainlink-vrf-v2-5", "randomness"]
  ];

  for (const [selector, productId, genericCapabilityId] of cases) {
    const repository = fs.mkdtempSync(path.join(os.tmpdir(), `programmable-chainlink-${selector}-`));
    try {
      assert.equal(childProcess.spawnSync("git", ["init", "--quiet", repository], { encoding: "utf8", shell: false }).status, 0);
      const planDirectory = path.join(repository, "chainlink-plan");
      const started = run(["start", "--starter", "ordinary-launch", "--chainlink-product", selector, "--target", planDirectory], repository);
      assert.equal(started.status, 0, started.stdout || started.stderr);
      const plan = JSON.parse(fs.readFileSync(path.join(planDirectory, "programmable-template.json"), "utf8"));
      for (const capabilityId of ["chainlink-provider", productId, genericCapabilityId]) {
        assert.equal(plan.machineCapabilities.knownCapabilityIds.includes(capabilityId), true, `${selector}:${capabilityId}`);
      }
      const submissionId = `chainlink-${selector}-surface`;
      const scaffolded = run([
        "scaffold",
        submissionId,
        "--template-plan",
        path.join(planDirectory, "programmable-template.json"),
        "--repository-root",
        repository
      ], repository);
      assert.equal(scaffolded.status, 2, scaffolded.stdout || scaffolded.stderr);
      const failure = JSON.parse(scaffolded.stdout);
      assert.equal(failure.error.code, "SCAFFOLD_FAILED", selector);
      assert.match(failure.error.message, /frozen legacy V1 scaffold does not accept current catalog plans/u);
      assert.equal(fs.existsSync(path.join(repository, "submissions")), false, selector);
    } finally {
      fs.rmSync(repository, { recursive: true, force: true });
    }
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
