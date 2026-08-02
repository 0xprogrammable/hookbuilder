import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  TemplateCatalogError,
  composeTemplate,
  listTemplateCatalog,
  loadTemplateCatalog,
  materializeTemplate,
  parseCustomCapability,
  parseLocalTag,
  showTemplateDefinition
} from "../template-catalog-core.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(testDirectory, "..", "..");
const cliPath = path.join(skillRoot, "scripts", "template-catalog.mjs");
const catalogDirectory = path.join(skillRoot, "assets", "starter-catalog");
const expectedOutputFiles = [
  "CAPABILITY_CHECKLIST.md",
  "EVIDENCE.md",
  "METADATA_AND_DISCLOSURES.md",
  "PROPOSAL.md",
  "TAGS.md",
  "TEST_PLAN.md",
  "THREAT_MODEL.md",
  "programmable-template.json"
];

test("loads one hash-bound, closed and explicitly non-allowlisting catalog", () => {
  const catalog = loadTemplateCatalog({ skillRoot });
  const entries = listTemplateCatalog(catalog);

  assert.equal(catalog.catalogDigest, "a7875ce817fafd7ca4e0655e2937fa5a49b602283aa846e804732d18e6c1478e");
  assert.equal(entries.length, 37);
  assert.deepEqual(entries.map(({ id }) => id), [...entries.map(({ id }) => id)].sort());
  assert.deepEqual(
    entries.filter(({ kind }) => kind === "starter").map(({ id }) => id),
    ["blank-custom", "custom-hook", "custom-token-standard-fee-hook", "ordinary-launch"]
  );
  assert.deepEqual(catalog.manifest.policy, {
    selectionSemantics: "accelerator-only",
    unknownCapabilityOutcome: "architecture-review-required",
    missingCatalogLabelOutcome: "preserve-custom-capability",
    automaticAdverseDecision: false
  });
  for (const starter of catalog.definitions.filter(({ kind }) => kind === "starter")) {
    assert.deepEqual(
      catalog.manifest.mandatoryPacks.filter((id) => !starter.defaultPacks.includes(id)),
      [],
      `${starter.id} must include every mandatory pack`
    );
  }
});

test("catalog covers the requested broad starter and capability families", () => {
  const catalog = loadTemplateCatalog({ skillRoot });
  const expectedIds = [
    "ordinary-launch",
    "programmable-volume-fee",
    "custom-hook",
    "custom-hook-behavior",
    "custom-token-standard-fee-hook",
    "continuous-clearing-auction",
    "dynamic-lp-fee",
    "hook-owned-project-fee",
    "automatic-liquidity",
    "token-managed-automatic-liquidity",
    "threejs-pvp-rewards",
    "maps-location-quest",
    "wallet-transaction-quest",
    "signed-outcome-service",
    "oracle-keeper",
    "async-swap",
    "custom-curve",
    "permissioned-external-asset",
    "multi-repo-app-service-indexer",
    "multi-pool-hooks",
    "launch-distribution-vesting-lp-custody",
    "limit-orders-twamm",
    "mev-protection",
    "staking-liquidity-incentives",
    "randomness-loot-rewards",
    "metadata-disclosures",
    "test-evidence-threat-model",
    "tax-financed-auto-liquidity",
    "token-transfer-tax",
    "v4-liquidity-position-client",
    "v4-swap-client",
    "active-liquidity-market",
    "external-liquidity-aggregator",
    "hook-owned-idle-yield",
    "position-subscriber-automation",
    "wrapped-asset-conversion",
    "blank-custom"
  ];
  assert.deepEqual(
    expectedIds.filter((id) => !catalog.byId.has(id)),
    []
  );

  const fee = showTemplateDefinition(catalog, "programmable-volume-fee");
  assert.match(fee.requiredFacts.join("\n"), /0x4957f49620AFf3Adbbe8195a4f633E49cc93376c/u);
  assert.match(fee.requiredFacts.join("\n"), /four swap quadrants/u);
  assert.match(fee.requiredTests.join("\n"), /non-additive split/u);

  const swapClient = showTemplateDefinition(catalog, "v4-swap-client");
  assert.match(swapClient.requiredFacts.join("\n"), /minHopPriceX36/u);
  assert.match(swapClient.requiredTests.join("\n"), /never fall back to local Pool math/u);
  const positionClient = showTemplateDefinition(catalog, "v4-liquidity-position-client");
  assert.match(positionClient.requiredFacts.join("\n"), /PositionManager/u);
  assert.match(positionClient.requiredTests.join("\n"), /onchain reconciliation/u);
  assert.match(
    showTemplateDefinition(catalog, "position-subscriber-automation").requiredTests.join("\n"),
    /Donation-inflated feesAccrued/u
  );
  assert.match(
    showTemplateDefinition(catalog, "external-liquidity-aggregator").requiredTests.join("\n"),
    /Address-prefix collisions/u
  );
  assert.match(
    showTemplateDefinition(catalog, "active-liquidity-market").requiredFacts.join("\n"),
    /Dedicated quote path/u
  );
});

test("CLI list and show expose deterministic local JSON", () => {
  const listed = runCli("list", "--kind", "starter");
  assert.equal(listed.status, 0, listed.stderr);
  assert.equal(listed.stderr, "");
  const listOutput = JSON.parse(listed.stdout);
  assert.equal(listOutput.ok, true);
  assert.deepEqual(
    listOutput.result.entries.map(({ id }) => id),
    ["blank-custom", "custom-hook", "custom-token-standard-fee-hook", "ordinary-launch"]
  );

  const shown = runCli("show", "maps-location-quest");
  assert.equal(shown.status, 0, shown.stderr);
  const showOutput = JSON.parse(shown.stdout);
  assert.equal(showOutput.result.definition.id, "maps-location-quest");
  assert.match(showOutput.result.definition.requiredFacts.join("\n"), /retention/u);
});

test("ordinary launch materializes only one new closed planning directory", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-template-ordinary-"));
  const target = path.join(root, "project-plan");
  try {
    const result = runCli(
      "materialize",
      "--starter",
      "ordinary-launch",
      "--target",
      target
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.deepEqual(fs.readdirSync(target).sort(), expectedOutputFiles);
    assert.deepEqual(output.result.files.map(({ path: filePath }) => filePath), expectedOutputFiles);

    const manifest = readJson(path.join(target, "programmable-template.json"));
    assert.equal(manifest.selection.starterId, "ordinary-launch");
    assert.deepEqual(manifest.selection.selectedPackIds, [
      "metadata-disclosures",
      "programmable-volume-fee",
      "test-evidence-threat-model"
    ]);
    assert.equal(manifest.policy.selectionSemantics, "accelerator-only");
    assert.equal(manifest.policy.automaticAdverseDecision, false);
    assert.equal(manifest.machineCapabilities.knownCapabilityIds.includes("canonical-v4-pool"), true);
    assert.deepEqual(manifest.tagSuggestions.ownerProvidedLocalTags, []);
    assert.equal(Object.hasOwn(manifest.tagSuggestions, "localProjectTags"), false);
    assert.equal(manifest.machineCapabilities.publicDiscoveryTagInference, "forbidden");
    assert.match(fs.readFileSync(path.join(target, "METADATA_AND_DISCLOSURES.md"), "utf8"), /GMGN/u);
    assert.match(fs.readFileSync(path.join(target, "PROPOSAL.md"), "utf8"), /accelerator, not an allowlist/u);
    const tags = fs.readFileSync(path.join(target, "TAGS.md"), "utf8");
    assert.doesNotMatch(tags, /`canonical-v4-pool`/u);
    assert.doesNotMatch(tags, /`security-properties`|`test-evidence-threat-model`|`claimable-platform-fee`/u);
    assert.match(tags, /No owner-provided local discovery tags were selected/u);
    assert.match(tags, /\| GMGN \| \| unknown \| \|/u);
    assert.doesNotMatch(tags, /GMGN.{0,40}(?:supported|listed|indexed)/iu);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("dependencies are included automatically in stable order", () => {
  const catalog = loadTemplateCatalog({ skillRoot });
  const plan = composeTemplate({
    catalog,
    starterId: "custom-hook",
    packIds: ["threejs-pvp-rewards"]
  });

  assert.deepEqual(plan.selection.requestedPackIds, ["threejs-pvp-rewards"]);
  assert.deepEqual(plan.selection.autoIncludedPackIds, ["signed-outcome-service"]);
  assert.deepEqual(plan.selection.selectedPackIds, [
    "custom-hook-behavior",
    "metadata-disclosures",
    "programmable-volume-fee",
    "signed-outcome-service",
    "test-evidence-threat-model",
    "threejs-pvp-rewards"
  ]);
});

test("foundation conflicts redirect to the correct custom starter without rejecting the idea", () => {
  const catalog = loadTemplateCatalog({ skillRoot });
  for (const packId of [
    "custom-hook-behavior",
    "dynamic-lp-fee",
    "automatic-liquidity",
    "continuous-clearing-auction",
    "multi-pool-hooks",
    "active-liquidity-market",
    "external-liquidity-aggregator",
    "hook-owned-idle-yield",
    "wrapped-asset-conversion"
  ]) {
    assert.throws(
      () => composeTemplate({ catalog, starterId: "ordinary-launch", packIds: [packId] }),
      (error) => {
        assert.equal(error.code, "CUSTOM_HOOK_STARTER_REQUIRED");
        assert.equal(error.details.starterId, "ordinary-launch");
        assert.equal(error.details.recommendedStarterId, "custom-hook");
        assert.equal(error.details.adverseDecision, false);
        assert.equal(error.details.eligibilityEffect, "none");
        assert.equal(error.details.selectedPackIds.includes("custom-hook-behavior"), true);
        assert.match(error.message, /continue with --starter custom-hook/u);
        return true;
      },
      packId
    );
  }

  for (const packId of [
    "token-transfer-tax",
    "token-managed-automatic-liquidity",
    "tax-financed-auto-liquidity"
  ]) {
    assert.throws(
      () => composeTemplate({ catalog, starterId: "ordinary-launch", packIds: [packId] }),
      (error) => {
        assert.equal(error.code, "CUSTOM_TOKEN_STARTER_REQUIRED");
        assert.equal(error.details.starterId, "ordinary-launch");
        assert.equal(error.details.recommendedStarterId, "custom-token-standard-fee-hook");
        assert.equal(error.details.adverseDecision, false);
        assert.equal(error.details.eligibilityEffect, "none");
        assert.match(error.message, /continue with --starter custom-token-standard-fee-hook/u);
        return true;
      },
      packId
    );
  }

  assert.throws(
    () => composeTemplate({
      catalog,
      starterId: "custom-token-standard-fee-hook",
      packIds: ["continuous-clearing-auction"]
    }),
    (error) => {
      assert.equal(error.code, "CUSTOM_HOOK_STARTER_REQUIRED");
      assert.equal(error.details.starterId, "custom-token-standard-fee-hook");
      assert.equal(error.details.recommendedStarterId, "custom-hook");
      return true;
    }
  );

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-template-redirect-"));
  const target = path.join(root, "must-not-exist");
  try {
    const result = runCli(
      "materialize",
      "--starter",
      "ordinary-launch",
      "--pack",
      "tax-financed-auto-liquidity",
      "--target",
      target
    );
    assert.equal(result.status, 1);
    assert.equal(result.stderr, "");
    const output = JSON.parse(result.stdout);
    assert.equal(output.error.code, "CUSTOM_TOKEN_STARTER_REQUIRED");
    assert.equal(output.error.details.recommendedStarterId, "custom-token-standard-fee-hook");
    assert.equal(fs.existsSync(target), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("token tax and tax-financed automatic liquidity stay token-managed and composable", () => {
  const catalog = loadTemplateCatalog({ skillRoot });
  const dependencyPlan = composeTemplate({
    catalog,
    starterId: "custom-token-standard-fee-hook",
    packIds: ["tax-financed-auto-liquidity"]
  });
  assert.deepEqual(dependencyPlan.selection.autoIncludedPackIds, [
    "token-managed-automatic-liquidity",
    "token-transfer-tax"
  ]);

  const plan = composeTemplate({
    catalog,
    starterId: "custom-token-standard-fee-hook",
    packIds: ["tax-financed-auto-liquidity", "token-transfer-tax"]
  });

  assert.deepEqual(plan.selection.requestedPackIds, [
    "tax-financed-auto-liquidity",
    "token-transfer-tax"
  ]);
  assert.deepEqual(plan.selection.autoIncludedPackIds, ["token-managed-automatic-liquidity"]);
  assert.deepEqual(plan.selection.selectedPackIds, [
    "metadata-disclosures",
    "programmable-volume-fee",
    "tax-financed-auto-liquidity",
    "test-evidence-threat-model",
    "token-managed-automatic-liquidity",
    "token-transfer-tax"
  ]);
  assert.equal(plan.selection.selectedPackIds.includes("automatic-liquidity"), false);
  assert.equal(plan.selection.selectedPackIds.includes("custom-hook-behavior"), false);
  assert.equal(plan.machineCapabilities.knownCapabilityIds.includes("fee-on-transfer-token"), true);
  assert.deepEqual(plan.tagSuggestions.ownerProvidedLocalTags, []);

  const transferTax = showTemplateDefinition(catalog, "token-transfer-tax");
  assert.deepEqual(transferTax.requires, []);
  assert.match(transferTax.requiredFacts.join("\n"), /PoolManager, router, liquidity/u);
  assert.match(transferTax.requiredTests.join("\n"), /gross and net amounts/u);
  const autoLiquidity = showTemplateDefinition(catalog, "tax-financed-auto-liquidity");
  assert.deepEqual(autoLiquidity.requires, ["token-managed-automatic-liquidity", "token-transfer-tax"]);
  assert.match(autoLiquidity.requiredTests.join("\n"), /double counting/u);
  const hookOwned = showTemplateDefinition(catalog, "automatic-liquidity");
  assert.equal(hookOwned.label, "Hook-owned automatic liquidity");
  assert.deepEqual(hookOwned.requires, ["custom-hook-behavior"]);
});

test("custom-token standard-fee starter materializes token-side behavior without a custom hook pack", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-template-token-"));
  const target = path.join(root, "project-plan");
  try {
    const result = runCli(
      "materialize",
      "--starter",
      "custom-token-standard-fee-hook",
      "--pack",
      "tax-financed-auto-liquidity",
      "--local-tag",
      "auto-liquidity-token",
      "--target",
      target
    );
    assert.equal(result.status, 0, result.stdout);
    const manifest = readJson(path.join(target, "programmable-template.json"));
    assert.equal(manifest.selection.starterId, "custom-token-standard-fee-hook");
    assert.equal(manifest.selection.selectedPackIds.includes("token-transfer-tax"), true);
    assert.equal(manifest.selection.selectedPackIds.includes("token-managed-automatic-liquidity"), true);
    assert.equal(manifest.selection.selectedPackIds.includes("custom-hook-behavior"), false);
    assert.equal(manifest.machineCapabilities.knownCapabilityIds.includes("standard-programmable-fee-hook"), true);
    assert.deepEqual(manifest.tagSuggestions.ownerProvidedLocalTags, ["auto-liquidity-token"]);
    const tags = fs.readFileSync(path.join(target, "TAGS.md"), "utf8");
    assert.match(tags, /`auto-liquidity-token`/u);
    assert.doesNotMatch(tags, /`token-transfer-tax`/u);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("continuous clearing auction materializes through the custom-hook foundation", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-template-cca-"));
  const target = path.join(root, "project-plan");
  try {
    const result = runCli(
      "materialize",
      "--starter",
      "custom-hook",
      "--pack",
      "continuous-clearing-auction",
      "--target",
      target
    );
    assert.equal(result.status, 0, result.stdout);
    const manifest = readJson(path.join(target, "programmable-template.json"));
    assert.equal(manifest.selection.selectedPackIds.includes("continuous-clearing-auction"), true);
    assert.equal(manifest.selection.selectedPackIds.includes("custom-hook-behavior"), true);
    assert.equal(manifest.machineCapabilities.knownCapabilityIds.includes("continuous-clearing-auction"), true);
    assert.deepEqual(manifest.tagSuggestions.ownerProvidedLocalTags, []);
    assert.doesNotMatch(fs.readFileSync(path.join(target, "TAGS.md"), "utf8"), /continuous-clearing-auction/u);
    assert.match(fs.readFileSync(path.join(target, "TEST_PLAN.md"), "utf8"), /independent reference model/u);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("an unlisted capability remains representable without an unsafe or rejected decision", () => {
  const catalog = loadTemplateCatalog({ skillRoot });
  const plan = composeTemplate({
    catalog,
    starterId: "blank-custom",
    customCapabilities: [{
      id: "moving-arena-swap-rule",
      label: "Moving arena changes the next swap rule"
    }]
  });

  assert.deepEqual(plan.customCapabilities, [{
    id: "moving-arena-swap-rule",
    label: "Moving arena changes the next swap rule",
    catalogStatus: "unlisted",
    automaticDecision: "none",
    reviewRoute: "architecture-review-required",
    eligibilityEffect: "none",
    requiredFacts: [
      "Actors and assets",
      "Authority and trust boundary",
      "Value flow and conservation",
      "Failure, recovery and user exit",
      "Source, tests and attributable evidence"
    ]
  }]);
  assert.equal(plan.policy.missingCatalogLabelOutcome, "preserve-custom-capability");
  assert.equal(plan.policy.automaticAdverseDecision, false);
  assert.equal(plan.tagSuggestions.semantics, "owner-provided-local-discovery-only");
  assert.equal(plan.tagSuggestions.providerSupportInference, "forbidden");
  assert.equal(plan.tagSuggestions.machineCapabilityInference, "forbidden");
  assert.deepEqual(plan.tagSuggestions.ownerProvidedLocalTags, []);
  assert.equal(Object.hasOwn(plan.tagSuggestions, "localProjectTags"), false);
  assert.deepEqual(plan.machineCapabilities.ownerDefinedCapabilityIds, ["moving-arena-swap-rule"]);
  assert.equal(plan.machineCapabilities.allCapabilityIds.includes("moving-arena-swap-rule"), true);
  assert.equal(plan.machineCapabilities.publicDiscoveryTagInference, "forbidden");
  assert.notEqual(plan.customCapabilities[0].automaticDecision, "unsafe");
  assert.notEqual(plan.customCapabilities[0].automaticDecision, "rejected");
});

test("CLI materializes owner-defined capabilities and records architecture review", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-template-custom-"));
  const target = path.join(root, "project-plan");
  try {
    const result = runCli(
      "materialize",
      "--starter",
      "blank-custom",
      "--custom-capability",
      "invented-proof-game=Invented proof game",
      "--target",
      target
    );
    assert.equal(result.status, 0, result.stdout);
    const manifest = readJson(path.join(target, "programmable-template.json"));
    assert.equal(manifest.customCapabilities[0].catalogStatus, "unlisted");
    assert.equal(manifest.customCapabilities[0].automaticDecision, "none");
    assert.equal(manifest.customCapabilities[0].reviewRoute, "architecture-review-required");
    assert.deepEqual(manifest.machineCapabilities.ownerDefinedCapabilityIds, ["invented-proof-game"]);
    assert.deepEqual(manifest.tagSuggestions.ownerProvidedLocalTags, []);
    const checklist = fs.readFileSync(path.join(target, "CAPABILITY_CHECKLIST.md"), "utf8");
    assert.match(checklist, /never unsafe or rejected solely because this catalog lacks a label/u);
    assert.doesNotMatch(fs.readFileSync(path.join(target, "TAGS.md"), "utf8"), /invented-proof-game/u);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("free safe local tags are selection-bound and materialized without an allowlist", () => {
  const catalog = loadTemplateCatalog({ skillRoot });
  const withoutTags = composeTemplate({ catalog, starterId: "ordinary-launch" });
  const plan = composeTemplate({
    catalog,
    starterId: "ordinary-launch",
    localTags: ["weird-squid-market", "community-lore"]
  });

  assert.deepEqual(plan.tagSuggestions.ownerProvidedLocalTags, ["community-lore", "weird-squid-market"]);
  assert.equal(plan.tagSuggestions.catalogMembershipRequired, false);
  assert.equal(plan.tagSuggestions.providerSupportInference, "forbidden");
  assert.equal(plan.tagSuggestions.machineCapabilityInference, "forbidden");
  assert.equal(Object.hasOwn(plan.tagSuggestions, "localProjectTags"), false);
  assert.notEqual(plan.selectionDigest, withoutTags.selectionDigest);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-template-tags-"));
  const target = path.join(root, "project-plan");
  try {
    const result = runCli(
      "materialize",
      "--starter",
      "ordinary-launch",
      "--local-tag",
      "weird-squid-market",
      "--local-tag",
      "community-lore",
      "--target",
      target
    );
    assert.equal(result.status, 0, result.stdout);
    const output = JSON.parse(result.stdout);
    assert.deepEqual(output.result.localTags, ["community-lore", "weird-squid-market"]);
    const manifest = readJson(path.join(target, "programmable-template.json"));
    assert.deepEqual(manifest.tagSuggestions.ownerProvidedLocalTags, ["community-lore", "weird-squid-market"]);
    assert.equal(manifest.tagSuggestions.catalogMembershipRequired, false);
    const tags = fs.readFileSync(path.join(target, "TAGS.md"), "utf8");
    assert.match(tags, /`community-lore`/u);
    assert.match(tags, /`weird-squid-market`/u);
    assert.match(tags, /do not claim listing, routing, indexing or endorsement/u);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("materialization is byte-identical for the same selection", () => {
  const catalog = loadTemplateCatalog({ skillRoot });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-template-repeat-"));
  const first = path.join(root, "first");
  const second = path.join(root, "second");
  try {
    const input = {
      catalog,
      starterId: "custom-hook",
      packIds: ["wallet-transaction-quest", "oracle-keeper"],
      customCapabilities: [{ id: "social-recovery-round", label: "Social recovery round" }],
      localTags: ["round-based-economy"]
    };
    const firstResult = materializeTemplate({ ...input, targetDirectory: first });
    const secondResult = materializeTemplate({ ...input, targetDirectory: second });
    assert.equal(firstResult.selectionDigest, secondResult.selectionDigest);
    assert.deepEqual(firstResult.files, secondResult.files);
    for (const fileName of expectedOutputFiles) {
      assert.equal(
        fs.readFileSync(path.join(first, fileName), "utf8"),
        fs.readFileSync(path.join(second, fileName), "utf8"),
        fileName
      );
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("an existing target is rejected even when empty and remains untouched", () => {
  const catalog = loadTemplateCatalog({ skillRoot });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-template-existing-"));
  const target = path.join(root, "already-there");
  fs.mkdirSync(target);
  try {
    assert.throws(
      () => materializeTemplate({ catalog, starterId: "ordinary-launch", targetDirectory: target }),
      (error) => error instanceof TemplateCatalogError && error.code === "TARGET_EXISTS"
    );
    assert.deepEqual(fs.readdirSync(target), []);
    assert.deepEqual(fs.readdirSync(root).filter((name) => name.startsWith(".programmable-template-")), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("permissioned external asset stays composable and requires an explicit PoolKey role", () => {
  const catalog = loadTemplateCatalog({ skillRoot });
  const plan = composeTemplate({
    catalog,
    starterId: "ordinary-launch",
    packIds: ["permissioned-external-asset"]
  });
  assert.equal(plan.selection.selectedPackIds.includes("permissioned-external-asset"), true);
  const definition = showTemplateDefinition(catalog, "permissioned-external-asset");
  assert.deepEqual(definition.conflictsWith, []);
  assert.match(definition.requiredFacts.join("\n"), /launched, quote or both/u);
});

test("ids and visible labels fail closed while normal NFC labels remain usable", () => {
  assert.deepEqual(parseCustomCapability("cafe-quest=Café quest"), {
    id: "cafe-quest",
    label: "Café quest"
  });
  for (const invalid of [
    "Bad_ID=Visible label",
    "cafe-quest=Cafe\u0301 quest",
    "bidi=Visible\u202e label",
    "zero-width=Visible\u200b label",
    "missing-label="
  ]) {
    assert.throws(
      () => parseCustomCapability(invalid),
      (error) => error instanceof TemplateCatalogError
    );
  }

  assert.equal(parseLocalTag("unlisted-but-safe"), "unlisted-but-safe");
  for (const invalidTag of [
    "Not-Lowercase",
    "has space",
    "../outside",
    "zero-width\u200btag",
    ""
  ]) {
    assert.throws(
      () => parseLocalTag(invalidTag),
      (error) => error instanceof TemplateCatalogError && error.code === "LOCAL_TAG_INVALID"
    );
  }
  const catalog = loadTemplateCatalog({ skillRoot });
  assert.throws(
    () => composeTemplate({ catalog, starterId: "ordinary-launch", localTags: ["same-tag", "same-tag"] }),
    (error) => error instanceof TemplateCatalogError && error.code === "LOCAL_TAG_INVALID"
  );
  assert.throws(
    () => composeTemplate({
      catalog,
      starterId: "ordinary-launch",
      localTags: Array.from({ length: 65 }, (_, index) => `tag-${index}`)
    }),
    (error) => error instanceof TemplateCatalogError && error.code === "LOCAL_TAG_INVALID"
  );
});

test("definition hashes, field closure and manifest order are independently enforced", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-template-mutation-"));
  const hashMismatch = path.join(root, "hash-mismatch");
  const closedFields = path.join(root, "closed-fields");
  const badOrder = path.join(root, "bad-order");
  try {
    fs.cpSync(catalogDirectory, hashMismatch, { recursive: true });
    const feePath = path.join(hashMismatch, "packs", "programmable-volume-fee.json");
    fs.appendFileSync(feePath, "\n");
    assert.throws(
      () => loadTemplateCatalog({ catalogDirectory: hashMismatch }),
      (error) => error.code === "CATALOG_HASH_MISMATCH"
    );

    fs.cpSync(catalogDirectory, closedFields, { recursive: true });
    const metadataPath = path.join(closedFields, "packs", "metadata-disclosures.json");
    const metadata = readJson(metadataPath);
    metadata.unreviewedExtraField = true;
    writeJson(metadataPath, metadata);
    rewriteEntryHash(closedFields, "metadata-disclosures", metadataPath);
    assert.throws(
      () => loadTemplateCatalog({ catalogDirectory: closedFields }),
      (error) => error.code === "CATALOG_SCHEMA_INVALID"
    );

    fs.cpSync(catalogDirectory, badOrder, { recursive: true });
    const manifestPath = path.join(badOrder, "catalog.json");
    const manifest = readJson(manifestPath);
    [manifest.entries[0], manifest.entries[1]] = [manifest.entries[1], manifest.entries[0]];
    writeJson(manifestPath, manifest);
    assert.throws(
      () => loadTemplateCatalog({ catalogDirectory: badOrder }),
      (error) => error.code === "CATALOG_ORDER_INVALID"
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("catalog implementation has no process, Git or network execution dependency", () => {
  const core = fs.readFileSync(path.join(skillRoot, "scripts", "template-catalog-core.mjs"), "utf8");
  const cli = fs.readFileSync(cliPath, "utf8");
  assert.doesNotMatch(core, /from "node:(?:child_process|cluster|dgram|dns|http|https|net|tls|worker_threads)"/u);
  assert.doesNotMatch(cli, /from "node:(?:child_process|cluster|dgram|dns|http|https|net|tls|worker_threads)"/u);
  assert.doesNotMatch(core, /\b(?:fetch|spawn|execFile|execSync)\s*\(/u);
  assert.doesNotMatch(cli, /\b(?:fetch|spawn|execFile|execSync)\s*\(/u);
});

function runCli(...args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: skillRoot,
    encoding: "utf8",
    shell: false,
    env: {
      PATH: process.env.PATH,
      TMPDIR: process.env.TMPDIR ?? os.tmpdir()
    }
  });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function rewriteEntryHash(directory, id, definitionPath) {
  const manifestPath = path.join(directory, "catalog.json");
  const manifest = readJson(manifestPath);
  const entry = manifest.entries.find((candidate) => candidate.id === id);
  entry.sha256 = crypto.createHash("sha256").update(fs.readFileSync(definitionPath)).digest("hex");
  writeJson(manifestPath, manifest);
}
