import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { planKnowledge } from "../knowledge-router-core.mjs";
import { composeTemplate, loadTemplateCatalog } from "../template-catalog-core.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(testDirectory, "..", "..");
const cli = path.join(skillRoot, "scripts", "cli.mjs");
const catalog = loadTemplateCatalog({ skillRoot });

test("mode-only exploration stays within the target and avoids implementation context", () => {
  const result = planKnowledge({ mode: "explore", skillRoot });
  assert.deepEqual(paths(result), [
    "references/intake-playbook.md",
    "references/programmable-fee-policy.md",
    "references/template-catalog.md"
  ]);
  assert.equal(result.contextBudget.status, "within-target");
  assert.equal(result.networkAccessed, false);
  assert.equal(result.reviewRoute, "selected-profile");
  assert.equal(paths(result).includes("references/submission.schema.json"), false);
  assert.equal(paths(result).includes("references/v4-sdk-integration.md"), false);
});

test("ordinary launch plan does not load unrelated game, SDK, or advanced-hook chapters", () => {
  const templatePlan = composeTemplate({ catalog, starterId: "ordinary-launch" });
  const result = planKnowledge({ mode: "preflight", templatePlan, skillRoot });
  assert.equal(result.unknownCapabilities.length, 0);
  assert.equal(result.reviewRoute, "custom-review");
  assert.equal(result.surfaces.includes("contract"), true);
  assert.equal(paths(result).includes("references/v4-protocol-mechanics.md"), false);
  assert.equal(paths(result).includes("references/runtime-assets.md"), false);
  assert.equal(paths(result).includes("references/v4-sdk-integration.md"), false);
  assert.equal(paths(result).includes("references/v4-hook-lego.md"), false);
});

test("swap and liquidity clients receive exact SDK, state, and periphery safety context", () => {
  const templatePlan = composeTemplate({
    catalog,
    starterId: "custom-hook",
    packIds: ["v4-swap-client", "v4-liquidity-position-client"]
  });
  const result = planKnowledge({ mode: "prototype", templatePlan, skillRoot });
  for (const reference of [
    "references/v4-sdk-integration.md",
    "references/v4-liquidity-and-state.md",
    "references/v4-protocol-mechanics.md",
    "references/security-and-evidence.md"
  ]) assert.equal(paths(result).includes(reference), true, reference);
  assert.equal(paths(result).includes("references/upstream-sources.md"), false);
  assert.equal(result.loadLater.some(({ path: reference }) => reference === "references/upstream-sources.md"), true);
  assert.equal(result.capabilities.includes("v4-swap-client"), true);
  assert.equal(result.capabilities.includes("liquidity-position-client"), true);
  assert.equal(result.networkAccessed, false);
});

test("game and service compositions load runtime and trust-boundary context without the full library", () => {
  const templatePlan = composeTemplate({
    catalog,
    starterId: "custom-hook",
    packIds: ["threejs-pvp-rewards"]
  });
  const result = planKnowledge({ mode: "preflight", templatePlan, skillRoot });
  assert.equal(paths(result).includes("references/project-surfaces-and-capabilities.md"), true);
  assert.equal(paths(result).includes("references/runtime-assets.md"), true);
  assert.equal(paths(result).includes("references/companion-manifests.md"), true);
  assert.equal(paths(result).includes("references/agent-entry-and-application.md"), false);
  assert.ok(result.loadNow.length < 12, JSON.stringify(result.loadNow));
});

test("explicit catalog packs expand to their exact capabilities and canonical surfaces", () => {
  const result = planKnowledge({
    mode: "prototype",
    packs: ["threejs-pvp-rewards", "signed-outcome-service", "v4-swap-client"],
    skillRoot
  });
  assert.deepEqual(result.packs, ["signed-outcome-service", "threejs-pvp-rewards", "v4-swap-client"]);
  assert.equal(result.capabilities.includes("threejs"), true);
  assert.equal(result.capabilities.includes("signed-claim"), true);
  assert.equal(result.capabilities.includes("v4-swap-client"), true);
  assert.equal(result.surfaces.includes("game"), true);
  assert.equal(result.surfaces.includes("service"), true);
  assert.deepEqual(result.unknownCapabilities, []);
  assert.deepEqual(result.unknownSurfaces, []);
  assert.equal(result.reviewRoute, "architecture-review-required");
  for (const reference of [
    "references/runtime-assets.md",
    "references/companion-manifests.md",
    "references/v4-sdk-integration.md"
  ]) assert.equal(paths(result).includes(reference), true, reference);
});

test("novel capabilities remain eligible and receive an architecture-review profile", () => {
  const result = planKnowledge({
    mode: "explore",
    capabilities: ["telepathic-auction-world"],
    surfaces: ["other"],
    skillRoot
  });
  assert.deepEqual(result.unknownCapabilities, ["telepathic-auction-world"]);
  assert.deepEqual(result.unknownSurfaces, []);
  assert.equal(result.reviewRoute, "architecture-review-required");
  assert.equal(result.automaticAdverseDecision, false);
  for (const reference of [
    "references/scenario-matrix.md",
    "references/project-surfaces-and-capabilities.md",
    "references/v4-hook-lego.md",
    "references/security-and-evidence.md"
  ]) assert.equal(paths(result).includes(reference), true, reference);
});

test("knowledge plans are deterministic regardless of repeated caller order", () => {
  const first = planKnowledge({
    mode: "review",
    capabilities: ["v4-swap-client", "custom-curve", "v4-swap-client"],
    surfaces: ["application", "contract"],
    skillRoot
  });
  const second = planKnowledge({
    mode: "review",
    capabilities: ["custom-curve", "v4-swap-client"],
    surfaces: ["contract", "application"],
    skillRoot
  });
  assert.equal(first.profileDigest, second.profileDigest);
  assert.deepEqual(first.loadNow, second.loadNow);
});

test("host-neutral context command reads one exact plan and emits canonical local JSON", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-knowledge-router-"));
  const planPath = path.join(temporary, "programmable-template.json");
  try {
    fs.writeFileSync(planPath, `${JSON.stringify(composeTemplate({
      catalog,
      starterId: "custom-hook",
      packIds: ["v4-swap-client"]
    }))}\n`);
    const result = childProcess.spawnSync(process.execPath, [
      cli,
      "context",
      "--mode",
      "prototype",
      "--template-plan",
      planPath
    ], { encoding: "utf8", shell: false });
    assert.equal(result.status, 0, result.stdout || result.stderr);
    assert.equal(result.stderr, "");
    const output = JSON.parse(result.stdout);
    assert.equal(output.command, "context");
    assert.equal(output.ok, true);
    assert.equal(output.result.networkAccessed, false);
    assert.equal(paths(output.result).includes("references/v4-sdk-integration.md"), true);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("context command rejects symbolic template plans and invalid ids", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-knowledge-router-hostile-"));
  const realPlan = path.join(temporary, "plan.json");
  const linkedPlan = path.join(temporary, "linked.json");
  try {
    fs.writeFileSync(realPlan, "{}\n");
    fs.symlinkSync(realPlan, linkedPlan);
    let result = childProcess.spawnSync(process.execPath, [
      cli,
      "context",
      "--mode",
      "explore",
      "--template-plan",
      linkedPlan
    ], { encoding: "utf8", shell: false });
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stdout).error.code, "TEMPLATE_PLAN_INVALID");

    result = childProcess.spawnSync(process.execPath, [
      cli,
      "context",
      "--mode",
      "explore",
      "--capability",
      "../../escape"
    ], { encoding: "utf8", shell: false });
    assert.equal(result.status, 2);
    assert.equal(JSON.parse(result.stdout).error.code, "KNOWLEDGE_INPUT_INVALID");

    result = childProcess.spawnSync(process.execPath, [
      cli,
      "context",
      "--mode",
      "explore",
      "--pack",
      "ordinary-launch"
    ], { encoding: "utf8", shell: false });
    assert.equal(result.status, 2);
    assert.equal(JSON.parse(result.stdout).error.code, "KNOWLEDGE_PACK_INVALID");
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

function paths(result) {
  return result.loadNow.map(({ path: reference }) => reference);
}
