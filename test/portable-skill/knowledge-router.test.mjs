import assert from "node:assert/strict";
import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { builderTemplateFromPlan } from "../../skills/programmable-v4-hook-builder/scripts/builder-template-contract.mjs";
import { parseBoundedLosslessJson } from "../../skills/programmable-v4-hook-builder/scripts/github-public-source-core.mjs";
import { KnowledgeRouterError, planKnowledge } from "../../skills/programmable-v4-hook-builder/scripts/knowledge-router-core.mjs";
import { canonicalJson, composeTemplate, loadTemplateCatalog } from "../../skills/programmable-v4-hook-builder/scripts/template-catalog-core.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(testDirectory, "..", "..", "skills", "programmable-v4-hook-builder");
const cli = path.join(skillRoot, "scripts", "cli.mjs");
const catalog = loadTemplateCatalog({ skillRoot });

test("active application routes identify the six-file transport as frozen legacy only", () => {
  const entry = fs.readFileSync(path.join(skillRoot, "references", "agent-entry-and-application.md"), "utf8");
  const workflow = fs.readFileSync(path.join(skillRoot, "references", "workflow.md"), "utf8");
  assert.match(entry, /## Frozen Public Applicant Beta/u);
  assert.match(entry, /six-file `prepare-pr` path is historical replay/u);
  assert.doesNotMatch(entry, /## Current Public Applicant Beta/u);
  assert.match(workflow, /## 8\. Preserve the frozen six-file application transport/u);
  assert.match(workflow, /not the current\/default\s+application path/u);
  assert.doesNotMatch(workflow, /## 8\. Prepare the public GitHub application/u);
});

test("mode-only exploration starts from the compact business compiler without implementation context", () => {
  const result = planKnowledge({ mode: "explore", skillRoot });
  assert.deepEqual(paths(result), ["references/business-system-compiler.md"]);
  assert.ok(deferred(result, "references/intent-contract.md"));
  assert.ok(deferred(result, "references/project-surfaces-and-capabilities.md"));
  assert.equal(result.loadLater.some(({ path: reference }) => reference === "references/intake-playbook.md"), true);
  assert.equal(result.loadLater.some(({ path: reference }) => reference === "references/template-catalog.md"), true);
  assert.equal(result.loadLater.some(({ path: reference }) => reference === "references/programmable-fee-policy-v2.md"), true);
  assert.equal(result.contextBudget.status, "within-target");
  assert.equal(result.contextBudget.entryContract.path, "SKILL.md");
  assert.ok(result.contextBudget.entryContract.estimatedTokens <= 3000);
  assert.equal(result.contextBudget.contentBytes, result.contextBudget.entryContract.bytes + result.contextBudget.selectedReferenceBytes);
  assert.equal(result.contextBudget.totalBytes, result.contextBudget.contentBytes + result.contextBudget.routerOutput.bytes);
  assert.equal(result.contextBudget.estimatedTokens, result.contextBudget.contentEstimatedTokens + result.contextBudget.routerOutput.estimatedTokens);
  assert.equal(result.contextBudget.routerOutput.measurement, "canonical-context-command-envelope-v1");
  assert.match(result.contextBudget.entryContract.sha256, /^[a-f0-9]{64}$/u);
  assert.equal(result.networkAccessed, false);
  assert.equal(result.reviewRoute, "selected-profile");
  assert.equal(paths(result).includes("references/submission.schema.json"), false);
  assert.equal(paths(result).includes("references/v4-sdk-integration.md"), false);
});

test("Autopilot starts from the compact compiler with the productive completion gate and defers specialist context", () => {
  const result = planKnowledge({ mode: "autopilot", skillRoot });
  assert.deepEqual(paths(result), ["references/business-system-compiler.md"]);
  const skill = fs.readFileSync(path.join(skillRoot, "SKILL.md"), "utf8");
  const compiler = fs.readFileSync(path.join(skillRoot, "references", "business-system-compiler.md"), "utf8");
  const coldContext = [skill, ...result.loadNow.map(({ path: reference }) => fs.readFileSync(path.join(skillRoot, reference), "utf8"))].join("\n");
  assert.match(skill, /context --mode autopilot --brief/u);
  assert.match(skill, /node "\$BUILDER_CLI" context --mode autopilot --capability "\$CONFIRMED_CAPABILITY" --activate-confirmed --base-profile-digest "\$BASE_PROFILE_DIGEST" --brief/u);
  assert.match(skill, /after isolated failure run `context --mode repair --brief`/u);
  assert.match(skill, /before architecture or code/u);
  assert.doesNotMatch(skill, /context --mode explore --capability owner-defined-capability/u);
  assert.match(skill, /Before materializing read no other reference; `project --help` is complete\.[\s\S]*Dry-run this custom-tradable command, then add `--write`/u);
  assert.doesNotMatch(skill, /--classification no-market --source-contract "\$SOURCE_CONTRACT" --test-source "\$TEST_SOURCE"/u);
  assert.match(coldContext, /project materialize --idea-file "\$IDEA_FILE" --application-id "\$APPLICATION_ID" --classification tradable --market-ref "\$MARKET_REF" --project-profile foundry --contract-config-root "\$CONTRACT_CONFIG_ROOT" --source-root "\$SOURCE_ROOT" --test-root "\$TEST_ROOT" --output "\$NEW_REPOSITORY"/u);
  assert.match(coldContext, /Missing catalog\/profile never justifies refusal/u);
  assert.match(coldContext, /policy gates\s+launch, never source/iu);
  assert.match(coldContext, /No trusted sandbox\? Materialize source\/tests/u);
  assert.match(coldContext, /--reference-profile programmable-volume-fee-v2/u);
  assert.match(coldContext, /`programmable-volume-fee-v2` is optional frozen legacy compatibility; never infer it/u);
  assert.match(coldContext, /Save the exact prompt bytes as `\$IDEA_FILE`; never rewrite them\. Bind as ProjectSpec and Submission IdeaSource/u);
  assert.doesNotMatch(coldContext, /(?:independent audit findings?|known findings?|expected solutions?|finding [1-4])/iu);
  assert.doesNotMatch(coldContext, /(?:Reference fee kernel|ProgrammableVolumeFeeHookV2\.sol|known exploit|audit report)/iu);
  assert.match(coldContext, /NOT_APPROVED/u);
  assert.match(coldContext, /NOT_SUBMITTED/u);
  assert.match(coldContext, /require authority for secrets, cost, signing, deploy, publish, submit, merge or Registry writes/iu);
  assert.match(skill, /project require-output --brief --repository-root "\$NEW_REPOSITORY" --state \.programmable\/project-states\/000006-submission-evidence\.v1\.json --previous-state \.programmable\/project-states\/000005-verification\.v1\.json --submission-root submission/u);
  assert.match(compiler, /project materialize/u);
  assert.match(compiler, /project\s+require-output/u);
  assert.match(compiler, /PROJECT_PREFLIGHT_VALID/u);
  assert.match(compiler, /NOT_SUBMITTED/u);
  assert.ok(deferred(result, "references/intent-contract.md"));
  assert.ok(deferred(result, "references/project-surfaces-and-capabilities.md"));
  for (const reference of [
    "references/open-world-v2-workflow.md",
    "references/open-world-v2-output-contract.md",
    "references/programmable-fee-policy-v2.md",
    "references/layered-response-contract.md"
  ]) assert.equal(result.loadLater.some(({ path: candidate }) => candidate === reference), true, reference);
  assert.equal(result.contextBudget.status, "within-target");
  assert.ok(result.contextBudget.estimatedTokens <= 4000);
  assert.equal(result.networkAccessed, false);

  const help = childProcess.spawnSync(process.execPath, [cli, "project", "--help"], { encoding: "utf8", shell: false });
  assert.equal(help.status, 0, help.stdout || help.stderr);
  assert.match(help.stdout, /validate\|validate-output\|preflight\|require-output\|execute\|diagnose\|materialize/u);
  for (const option of ["--idea-file", "--application-id", "--classification", "--market-ref", "--reference-profile", "--source-contract", "--test-source", "--output", "--write"]) assert.match(help.stdout, new RegExp(option, "u"), option);
});

test("Applicant Draft eligibility is independent from trusted sandbox completion", () => {
  const skill = fs.readFileSync(path.join(skillRoot, "SKILL.md"), "utf8");
  const application = fs.readFileSync(path.join(skillRoot, "references", "github-application-v3.md"), "utf8");
  const routing = JSON.parse(fs.readFileSync(path.join(skillRoot, "references", "knowledge-routing.json"), "utf8"));
  const initialSubmitReferences = routing.modes.submit.initial.map((reference) => (
    fs.readFileSync(path.join(skillRoot, "references", reference), "utf8")
  ));
  const publicBeta = fs.readFileSync(path.resolve(skillRoot, "..", "..", "docs", "PUBLIC_GITHUB_PR_BETA.md"), "utf8");

  assert.deepEqual(routing.modes.submit.initial, ["applicant-journey.md"]);
  for (const source of [skill, application, publicBeta, ...initialSubmitReferences]) {
    assert.match(source, /Do not require `PROJECT_PREFLIGHT_VALID` or a trusted external sandbox to create an unreviewed Applicant Draft/u);
    assert.match(source, /Local or applicant-supplied test evidence remains unverified until independent review/u);
  }
  for (const source of initialSubmitReferences) {
    assert.match(source, /Use one visible command for a completed project with exact public GitHub source/u);
    assert.match(source, /submit-project "\$REPOSITORY_ROOT"/u);
    assert.match(source, /Do not expose\s+internal package assembly, queue experiments or legacy transport as the normal journey/u);
  }
  assert.match(application, /APPLICATION_PACKAGE_VALID -> submit plan -> explicit confirmation -> protected Draft PR/u);
  assert.doesNotMatch(application, /PROJECT_PREFLIGHT_VALID -> prepare-revision -> application -> submit plan/u);
});

test("an owner-defined Explore route stays within the cold-start budget", () => {
  const result = planKnowledge({
    mode: "explore",
    capabilities: ["owner-defined-capability"],
    skillRoot
  });
  assert.equal(result.contextBudget.status, "within-target");
  assert.ok(result.contextBudget.estimatedTokens <= 4000);
  assert.deepEqual(result.unknownCapabilities, ["owner-defined-capability"]);
  assert.equal(result.reviewRoute, "architecture-review-required");
});

test("current-contract and migration diagnostics load only their narrow references", () => {
  const resolver = planKnowledge({
    mode: "repair",
    capabilities: ["submit-launch-policy-drift"],
    skillRoot
  });
  assert.equal(resolver.loadLater.some(({ path }) => path === "references/submit-launch-resolver.md"), true);
  assert.equal(resolver.loadLater.some(({ path }) => path === "references/application-compatibility-and-migration.md"), false);

  const migration = planKnowledge({
    mode: "submit",
    capabilities: ["application-v3-migration"],
    skillRoot
  });
  assert.equal(migration.loadLater.some(({ path }) => path === "references/application-compatibility-and-migration.md"), true);
  assert.equal(migration.loadLater.some(({ path }) => path === "references/submit-launch-resolver.md"), false);

  const ordinarySubmit = planKnowledge({ mode: "submit", skillRoot });
  assert.deepEqual(paths(ordinarySubmit), ["references/applicant-journey.md"]);
});

test("user-facing result modes defer the layered response contract without spending initial context", () => {
  for (const mode of ["explore", "autopilot", "preflight", "prototype", "repair", "review", "submit"]) {
    const result = planKnowledge({ mode, skillRoot });
    assert.equal(paths(result).includes("references/layered-response-contract.md"), false, mode);
    assert.equal(
      result.loadLater.some(({ path: reference }) => reference === "references/layered-response-contract.md"),
      true,
      mode
    );
    const coldMode = mode === "explore" || mode === "autopilot" || mode === "repair" || mode === "submit";
    assert.equal(
      result.contextBudget.status,
      coldMode ? "within-target" : "expanded-required-context",
      mode
    );
    assert.ok(result.contextBudget.estimatedTokens <= (coldMode ? 4000 : 8000), mode);
  }

  const maintainerHandoff = planKnowledge({ mode: "handoff", skillRoot });
  assert.equal(paths(maintainerHandoff).includes("references/layered-response-contract.md"), false);
  assert.equal(
    maintainerHandoff.loadLater.some(({ path: reference }) => reference === "references/layered-response-contract.md"),
    false
  );
});

test("Repair starts only from the compact non-completion loop and defers v2 regeneration", () => {
  const result = planKnowledge({ mode: "repair", skillRoot });
  assert.deepEqual(paths(result), ["references/repair-loop.md"]);
  assert.equal(result.loadLater.some(({ path: reference }) => reference === "references/open-world-v2-workflow.md"), true);
  assert.equal(result.contextBudget.status, "within-target");
  assert.ok(result.contextBudget.estimatedTokens <= 3000, result.contextBudget.estimatedTokens);
  const repair = fs.readFileSync(path.join(skillRoot, "references", "repair-loop.md"), "utf8");
  assert.ok(Buffer.byteLength(repair, "utf8") <= 2000);
  assert.match(repair, /project diagnose/u);
  assert.match(repair, /initial and at most two later failures/u);
  assert.match(repair, /NOT_COMPLETION/u);
  assert.match(repair, /NOT_APPROVAL/u);
  assert.match(repair, /PROJECT_PREFLIGHT_VALID/u);
});

test("knowledge-routing source is duplicate-key-free under strict lossless JSON", () => {
  const source = fs.readFileSync(
    path.join(skillRoot, "references", "knowledge-routing.json"),
    "utf8"
  );
  const routing = parseBoundedLosslessJson(source);
  assert.equal(routing.kind, "programmable-knowledge-routing");

  for (const [mode, profile] of Object.entries(routing.modes)) {
    const deferredReferences = profile.later.map((item) => {
      assert.deepEqual(Object.keys(item).sort(), ["reference", "trigger"], mode);
      return item.reference;
    });
    assert.equal(new Set(deferredReferences).size, deferredReferences.length, mode);
  }
  assert.equal(
    routing.modes.explore.later.filter(({ reference }) => reference === "intake-playbook.md").length,
    1
  );

  const duplicate = source.replace(
    '"reference": "intake-playbook.md",',
    '"reference": "intake-playbook.md",\n          "reference": "intake-playbook.md",'
  );
  assert.notEqual(duplicate, source);
  assert.throws(() => parseBoundedLosslessJson(duplicate), /duplicate key/u);
});

test("every installed Markdown reference is routed, linked, or explicitly archival", () => {
  const routing = JSON.parse(fs.readFileSync(
    path.join(skillRoot, "references", "knowledge-routing.json"),
    "utf8"
  ));
  const routed = new Set([
    ...Object.values(routing.modes).flatMap((profile) => [
      ...profile.initial,
      ...profile.later.map(({ reference }) => reference)
    ]),
    ...routing.capabilityRoutes.flatMap(({ references }) => references),
    ...routing.surfaceRoutes.flatMap(({ references }) => references),
    ...routing.unknownCapabilityReferences
  ]);
  const activation = JSON.parse(fs.readFileSync(
    path.join(skillRoot, "references", "knowledge-activation-v1.json"),
    "utf8"
  ));
  for (const reference of activation.routeSelections.map(({ reference }) => reference)) routed.add(reference);
  const archival = new Set(routing.archivalReferences.flatMap(({ references }) => references));
  assert.deepEqual([...archival].sort(), [
    "compatibility-standard.md",
    "github-application-journey.md",
    "launch-bundle-input-v2.schema.json",
    "launch-bundle-output-v2.schema.json",
    "output-contract.md",
    "programmable-fee-policy.md",
    "standard-fee-kernel.md",
    "submission-workflow.md",
    "workflow.md"
  ]);
  assert.equal(routed.has("github-application-v3.md"), true);
  assert.equal(routed.has("public-pr-application-v3.schema.json"), true);
  assert.equal(routed.has("build-profiles.md"), true);

  const skill = fs.readFileSync(path.join(skillRoot, "SKILL.md"), "utf8");
  const skillLinks = new Set(
    [...skill.matchAll(/\]\(references\/([a-z0-9.-]+\.md)(?:#[^)]+)?\)/gu)].map((match) => match[1])
  );
  const markdownReferences = fs.readdirSync(path.join(skillRoot, "references"))
    .filter((name) => name.endsWith(".md"))
    .sort();
  assert.deepEqual(
    markdownReferences.filter((name) => !routed.has(name) && !skillLinks.has(name) && !archival.has(name)),
    []
  );
});

test("explore never infers the optional frozen fee policy from a local capability label", () => {
  const pureService = planKnowledge({
    mode: "explore",
    capabilities: ["owner-defined-service-flow"],
    surfaces: ["application", "indexer", "service"],
    skillRoot
  });
  assert.equal(paths(pureService).includes("references/programmable-fee-policy-v2.md"), false);
  assert.equal(
    pureService.loadLater.some(({ path: reference }) => reference === "references/programmable-fee-policy-v2.md"),
    true
  );

  for (const capability of ["canonical-v4-pool", "standard-programmable-fee-hook", "claimable-platform-fee"]) {
    const confirmed = planKnowledge({ mode: "explore", capabilities: [capability], skillRoot });
    const feePolicy = deferred(confirmed, "references/programmable-fee-policy-v2.md");
    assert.ok(feePolicy, capability);
    assert.equal(Object.hasOwn(feePolicy, "reasons"), false, capability);
    assert.match(feePolicy.trigger, /preserved project intent or an applicable current central-policy Rule ID/u);
    assert.equal(paths(confirmed).includes("references/programmable-fee-policy-v2.md"), false, capability);
  }
});

test("mode-only preflight defers full Fee V2 until canonical applicability is confirmed", () => {
  const result = planKnowledge({ mode: "preflight", skillRoot });
  assert.deepEqual(paths(result), ["references/open-world-v2-workflow.md"]);
  assert.equal(
    result.loadLater.some(({ path: reference }) => reference === "references/programmable-fee-policy-v2.md"),
    true
  );
  assert.equal(result.contextBudget.status, "expanded-required-context");
  assert.ok(result.contextBudget.estimatedTokens <= 8000);
});

test("ordinary launch plan loads canonical v4 context without unrelated game, SDK, or advanced-hook chapters", () => {
  const templatePlan = composeTemplate({ catalog, starterId: "ordinary-launch" });
  const result = planKnowledge({ mode: "preflight", templatePlan, skillRoot });
  assert.equal(result.unknownCapabilities.length, 0);
  assert.equal(result.reviewRoute, "standard-review");
  assert.equal(result.surfaces.includes("contract"), true);
  assert.ok(deferred(result, "references/v4-protocol-mechanics.md"));
  assert.ok(deferred(result, "references/programmable-fee-policy-v2.md"));
  assert.equal(paths(result).includes("references/runtime-assets.md"), false);
  assert.equal(paths(result).includes("references/v4-sdk-integration.md"), false);
  assert.equal(paths(result).includes("references/v4-hook-lego.md"), false);
  assert.equal(paths(result).includes("references/open-world-v2-workflow.md"), true);
  assert.equal(paths(result).includes("references/compatibility-standard.md"), false);
});

test("fee pack without an explicit indexer does not load companion manifests", () => {
  const result = planKnowledge({
    mode: "preflight",
    packs: ["programmable-volume-fee"],
    skillRoot
  });

  assert.equal(result.surfaces.includes("indexer"), false);
  assert.equal(paths(result).includes("references/companion-manifests.md"), false);
  assert.ok(deferred(result, "references/programmable-fee-policy-v2.md"));
  assert.equal(result.contextBudget.status, "expanded-required-context");
  assert.ok(result.contextBudget.estimatedTokens <= 8000);
});

test("open-world v2 modes never route through the historical six-file transport", () => {
  const historical = new Set([
    "references/github-application-journey.md",
    "references/output-contract.md",
    "references/submission-workflow.md",
    "references/workflow.md"
  ]);
  for (const mode of ["preflight", "prototype", "repair", "review", "submit", "handoff"]) {
    const result = planKnowledge({ mode, skillRoot });
    const routed = [...paths(result), ...result.loadLater.map(({ path: reference }) => reference)];
    assert.equal(routed.some((reference) => historical.has(reference)), false, `${mode}: ${JSON.stringify(routed)}`);
  }
  assert.deepEqual(paths(planKnowledge({ mode: "submit", skillRoot })), [
    "references/applicant-journey.md"
  ]);
  assert.deepEqual(paths(planKnowledge({ mode: "handoff", skillRoot })), [
    "references/open-world-v2-workflow.md"
  ]);
  for (const mode of ["submit", "handoff"]) {
    assert.ok(deferred(planKnowledge({ mode, skillRoot }), "references/agent-entry-and-application.md"), mode);
  }
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
  ]) assert.ok(deferred(result, reference), reference);
  assert.equal(paths(result).includes("references/upstream-sources.md"), false);
  assert.equal(result.loadLater.some(({ path: reference }) => reference === "references/upstream-sources.md"), true);
  assert.equal(result.capabilities.includes("v4-swap-client"), true);
  assert.equal(result.capabilities.includes("liquidity-position-client"), true);
  assert.equal(result.networkAccessed, false);
});

test("indexer surfaces load discovery policy and v4 position indexing also loads coherent state guidance", () => {
  const genericIndexer = planKnowledge({
    mode: "prototype",
    surfaces: ["indexer"],
    skillRoot
  });
  assert.ok(deferred(genericIndexer, "references/routing-and-discovery.md"));
  assert.ok(deferred(genericIndexer, "references/companion-manifests.md"));
  assert.equal(paths(genericIndexer).includes("references/v4-liquidity-and-state.md"), false);

  const positionIndexer = planKnowledge({
    mode: "prototype",
    capabilities: ["position-discovery"],
    surfaces: ["indexer"],
    skillRoot
  });
  assert.ok(deferred(positionIndexer, "references/routing-and-discovery.md"));
  assert.ok(deferred(positionIndexer, "references/v4-liquidity-and-state.md"));
});

test("canonical external-provider surfaces use their minimal route while novel surfaces stay open", () => {
  const externalProvider = planKnowledge({
    mode: "prototype",
    surfaces: ["external-provider"],
    skillRoot
  });
  assert.deepEqual(externalProvider.unknownSurfaces, []);
  assert.equal(externalProvider.reviewRoute, "selected-profile");
  assert.equal(externalProvider.automaticAdverseDecision, false);
  assert.ok(deferred(externalProvider, "references/project-surfaces-and-capabilities.md"));
  assert.equal(paths(externalProvider).includes("references/routing-and-discovery.md"), false);

  const novel = planKnowledge({
    mode: "prototype",
    surfaces: ["owner-defined-telemetry-relay"],
    skillRoot
  });
  assert.deepEqual(novel.unknownSurfaces, ["owner-defined-telemetry-relay"]);
  assert.equal(novel.reviewRoute, "architecture-review-required");
  assert.equal(novel.automaticAdverseDecision, false);
  assert.ok(deferred(novel, "references/project-surfaces-and-capabilities.md"));
  assert.ok(deferred(novel, "references/security-and-evidence.md"));
});

test("Chainlink routing is explicit while generic production invariants remain provider-neutral", (t) => {
  const selected = planKnowledge({
    mode: "prototype",
    packs: ["chainlink-provider"],
    skillRoot
  });
  assert.equal(selected.capabilities.includes("chainlink-provider"), true);
  assert.equal(selected.surfaces.includes("external-provider"), true);
  assert.equal(selected.surfaces.includes("oracle"), false);
  assert.equal(selected.reviewRoute, "architecture-review-required");
  assert.equal(selected.networkAccessed, false);
  for (const reference of [
    "references/chainlink-provider-integration.md",
    "references/project-surfaces-and-capabilities.md",
    "references/companion-manifests.md"
  ]) {
    const route = deferred(selected, reference);
    assert.ok(route, reference);
    assert.equal(route.reasons.includes("capability:chainlink-provider"), true, reference);
  }

  for (const processedOutsideContext of [
    "references/chainlink-provider-profile-v1.schema.json",
    "references/provider-knowledge-source-receipt-2026-08-13.json"
  ]) assert.equal(paths(selected).includes(processedOutsideContext), false, processedOutsideContext);

  for (const productCapability of [
    "chainlink-ccip",
    "chainlink-cre",
    "chainlink-data-feeds",
    "chainlink-data-streams",
    "chainlink-vrf-v2-5"
  ]) {
    const direct = planKnowledge({
      mode: "prototype",
      capabilities: [productCapability],
      skillRoot
    });
    assert.deepEqual(direct.unknownCapabilities, [], productCapability);
    const route = deferred(direct, "references/chainlink-provider-integration.md");
    assert.ok(route, productCapability);
    assert.equal(route.reasons.includes(`capability:${productCapability}`), true, productCapability);
  }

  const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "programmable-chainlink-route-closure-")));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const copiedSkill = path.join(temporary, "skill");
  fs.cpSync(skillRoot, copiedSkill, { recursive: true });
  const copiedRoutingPath = path.join(copiedSkill, "references", "knowledge-routing.json");
  const copiedRouting = JSON.parse(fs.readFileSync(copiedRoutingPath, "utf8"));
  copiedRouting.capabilityRoutes
    .find(({ id }) => id === "chainlink-provider")
    .matches = copiedRouting.capabilityRoutes
      .find(({ id }) => id === "chainlink-provider")
      .matches.filter((id) => id !== "chainlink-cre");
  fs.writeFileSync(copiedRoutingPath, `${JSON.stringify(copiedRouting, null, 2)}\n`);
  assert.throws(
    () => planKnowledge({ mode: "prototype", capabilities: ["chainlink-cre"], skillRoot: copiedSkill }),
    (error) => error instanceof KnowledgeRouterError
      && error.code === "KNOWLEDGE_ROUTING_INVALID"
      && /every exact supported product capability/u.test(error.message)
  );

  for (const capability of ["cross-chain-messaging", "randomness", "oracle-data", "keeper-automation"]) {
    const generic = planKnowledge({ mode: "prototype", capabilities: [capability], skillRoot });
    assert.equal(
      generic.loadLater.some(({ path: reference }) => reference === "references/chainlink-provider-integration.md"),
      false,
      capability
    );
    assert.ok(deferred(generic, "references/ethereum-production-invariants.md"), capability);
  }

  for (const surface of ["external-provider", "indexer", "keeper", "service"]) {
    const generic = planKnowledge({ mode: "prototype", surfaces: [surface], skillRoot });
    assert.ok(deferred(generic, "references/ethereum-production-invariants.md"), surface);
  }

  const contractOnly = planKnowledge({ mode: "prototype", surfaces: ["contract"], skillRoot });
  assert.equal(paths(contractOnly).includes("references/ethereum-production-invariants.md"), false);
});

test("every canonical catalog surface has an explicit route and route drift fails closed", (t) => {
  const routing = JSON.parse(fs.readFileSync(path.join(skillRoot, "references", "knowledge-routing.json"), "utf8"));
  const routedSurfaces = new Set(routing.surfaceRoutes.flatMap(({ matches }) => matches));
  const catalogSurfaces = [...new Set(catalog.definitions.flatMap(({ projectSurfaces }) => projectSurfaces))].sort();
  assert.deepEqual(catalogSurfaces.filter((surface) => !routedSurfaces.has(surface)), []);

  const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "programmable-routing-surface-closure-")));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const copiedSkill = path.join(temporary, "skill");
  fs.cpSync(skillRoot, copiedSkill, { recursive: true });
  const copiedRoutingPath = path.join(copiedSkill, "references", "knowledge-routing.json");
  const copiedRouting = JSON.parse(fs.readFileSync(copiedRoutingPath, "utf8"));
  copiedRouting.surfaceRoutes = copiedRouting.surfaceRoutes.filter(({ id }) => id !== "external-provider");
  fs.writeFileSync(copiedRoutingPath, `${JSON.stringify(copiedRouting, null, 2)}\n`);

  assert.throws(
    () => planKnowledge({ mode: "prototype", packs: ["chainlink-provider"], skillRoot: copiedSkill }),
    (error) => error instanceof KnowledgeRouterError
      && error.code === "KNOWLEDGE_ROUTING_INVALID"
      && /external-provider/u.test(error.message)
  );
});

test("every canonical catalog capability has an explicit route and route drift fails closed", (t) => {
  const routing = JSON.parse(fs.readFileSync(path.join(skillRoot, "references", "knowledge-routing.json"), "utf8"));
  const routedCapabilities = new Set(routing.capabilityRoutes.flatMap(({ matches }) => matches));
  const catalogCapabilities = [...new Set(catalog.definitions.flatMap(({ capabilities }) => capabilities))].sort();
  assert.deepEqual(catalogCapabilities.filter((capability) => !routedCapabilities.has(capability)), []);

  const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "programmable-routing-capability-closure-")));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const copiedSkill = path.join(temporary, "skill");
  fs.cpSync(skillRoot, copiedSkill, { recursive: true });
  const copiedRoutingPath = path.join(copiedSkill, "references", "knowledge-routing.json");
  const copiedRouting = JSON.parse(fs.readFileSync(copiedRoutingPath, "utf8"));
  copiedRouting.capabilityRoutes = copiedRouting.capabilityRoutes.map((route) => ({
    ...route,
    matches: route.matches.filter((id) => id !== "v4-claim-client")
  }));
  fs.writeFileSync(copiedRoutingPath, `${JSON.stringify(copiedRouting, null, 2)}\n`);

  assert.throws(
    () => planKnowledge({ mode: "prototype", packs: ["v4-claim-client"], skillRoot: copiedSkill }),
    (error) => error instanceof KnowledgeRouterError
      && error.code === "KNOWLEDGE_ROUTING_INVALID"
      && /v4-claim-client/u.test(error.message)
  );
});

test("catalog capabilities defer their exact specialist knowledge routes", () => {
  const cases = [
    {
      pack: "limit-orders-twamm",
      references: [
        "references/scenario-matrix.md",
        "references/v4-hook-lego.md",
        "references/v4-protocol-mechanics.md"
      ]
    },
    {
      pack: "v4-claim-client",
      references: [
        "references/scenario-matrix.md",
        "references/v4-protocol-mechanics.md",
        "references/v4-sdk-integration.md"
      ]
    },
    {
      pack: "continuous-clearing-auction",
      references: [
        "references/scenario-matrix.md",
        "references/upstream-sources.md"
      ]
    },
    {
      pack: "test-evidence-threat-model",
      references: ["references/security-and-evidence.md"]
    }
  ];

  for (const { pack, references } of cases) {
    const result = planKnowledge({ mode: "prototype", packs: [pack], skillRoot });
    assert.deepEqual(paths(result), ["references/open-world-v2-workflow.md"], pack);
    for (const reference of references) {
      const route = deferred(result, reference);
      assert.ok(route, `${pack}:${reference}`);
      assert.equal(
        route.reasons.some((reason) => reason.startsWith("capability:")),
        true,
        `${pack}:${reference}`
      );
    }
  }
});

test("every routing-contract match is known and genuinely unlisted ids remain exact", (t) => {
  const routing = JSON.parse(fs.readFileSync(
    path.join(skillRoot, "references", "knowledge-routing.json"),
    "utf8"
  ));
  const routedCapabilities = [...new Set(routing.capabilityRoutes.flatMap(({ matches }) => matches))].sort();
  const routedSurfaces = [...new Set(routing.surfaceRoutes.flatMap(({ matches }) => matches))].sort();
  const canonical = planKnowledge({
    mode: "explore",
    capabilities: routedCapabilities,
    surfaces: routedSurfaces,
    skillRoot
  });
  assert.deepEqual(canonical.capabilities, routedCapabilities);
  assert.deepEqual(canonical.surfaces, routedSurfaces);
  assert.deepEqual(canonical.unknownCapabilities, []);
  assert.deepEqual(canonical.unknownSurfaces, []);

  const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "programmable-routing-known-")));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const copiedSkill = path.join(temporary, "skill");
  fs.cpSync(skillRoot, copiedSkill, { recursive: true });
  const copiedRoutingPath = path.join(copiedSkill, "references", "knowledge-routing.json");
  const copiedRouting = JSON.parse(fs.readFileSync(copiedRoutingPath, "utf8"));
  copiedRouting.capabilityRoutes
    .find(({ id }) => id === "discovery-and-provider")
    .matches.push("routing-contract-only-capability");
  fs.writeFileSync(copiedRoutingPath, `${JSON.stringify(copiedRouting, null, 2)}\n`);

  const mixed = planKnowledge({
    mode: "explore",
    capabilities: ["routing-contract-only-capability", "truly-novel-capability"],
    surfaces: ["external-provider", "truly-novel-surface"],
    registryProjects: [{
      capabilities: ["registry-metadata-only-capability"],
      id: "descriptive-only",
      recordSha256: `sha256:${"a".repeat(64)}`,
      status: "accepted",
      surfaces: ["registry-metadata-only-surface"]
    }],
    skillRoot: copiedSkill
  });
  assert.deepEqual(mixed.unknownCapabilities, ["truly-novel-capability"]);
  assert.deepEqual(mixed.unknownSurfaces, ["truly-novel-surface"]);
  assert.equal(mixed.capabilities.includes("registry-metadata-only-capability"), false);
  assert.equal(mixed.surfaces.includes("registry-metadata-only-surface"), false);
  assert.equal(mixed.reviewRoute, "architecture-review-required");
  assert.equal(mixed.automaticAdverseDecision, false);
  const discovery = mixed.loadLater.find(({ path: reference }) => (
    reference === "references/routing-and-discovery.md"
  ));
  assert.ok(discovery);
  assert.equal(discovery.reasons.includes("capability:routing-contract-only-capability"), true);
});

test("routing-family names return exact non-adverse selector guidance while genuine novelty stays open", () => {
  assert.throws(
    () => planKnowledge({
      mode: "prototype",
      capabilities: ["hook-implementation"],
      surfaces: ["runtime"],
      skillRoot
    }),
    (error) => {
      assert.ok(error instanceof KnowledgeRouterError);
      assert.equal(error.code, "KNOWLEDGE_ROUTE_FAMILY_AMBIGUOUS");
      assert.equal(error.details.status, "SELECTOR_GUIDANCE_REQUIRED");
      assert.equal(error.details.ideaEligibility, "ELIGIBLE_FOR_REVIEW");
      assert.equal(error.details.automaticAdverseDecision, false);
      const hookFamily = error.details.selectors.find(({ id }) => id === "hook-implementation");
      assert.ok(hookFamily);
      assert.equal(hookFamily.kind, "capability");
      assert.equal(hookFamily.selectableIds.includes("async-swap"), true);
      assert.equal(hookFamily.selectableIds.includes("custom-accounting"), true);
      assert.equal(hookFamily.selectableIds.includes("dynamic-lp-fee"), true);
      const runtimeFamily = error.details.selectors.find(({ id }) => id === "runtime");
      assert.deepEqual(runtimeFamily, {
        kind: "surface",
        id: "runtime",
        selectableIds: ["game"],
        matchingPackIds: []
      });
      return true;
    }
  );

  const novel = planKnowledge({
    mode: "prototype",
    capabilities: ["my-new-settlement"],
    surfaces: ["game"],
    skillRoot
  });
  assert.deepEqual(novel.unknownCapabilities, ["my-new-settlement"]);
  assert.deepEqual(novel.unknownSurfaces, []);
  assert.equal(novel.reviewRoute, "architecture-review-required");
  assert.equal(novel.automaticAdverseDecision, false);
});

test("permissioned pools and advanced liquidity route official models before handoff", () => {
  for (const mode of ["preflight", "prototype", "repair", "review"]) {
    for (const capability of ["permissioned-asset", "active-liquidity-market", "hook-owned-idle-yield"]) {
      const result = planKnowledge({ mode, capabilities: [capability], skillRoot });
      assert.ok(deferred(result, "references/official-model-patterns.md"), `${mode}:${capability}`);
    }
  }
});

test("pure application, service, and indexer prototypes do not preload v4 or the full fee policy", () => {
  const result = planKnowledge({
    mode: "prototype",
    capabilities: ["browser-game"],
    surfaces: ["application", "indexer", "service"],
    skillRoot
  });

  assert.ok(deferred(result, "references/project-surfaces-and-capabilities.md"));
  assert.equal(paths(result).includes("references/v4-protocol-mechanics.md"), false);
  assert.equal(paths(result).includes("references/programmable-fee-policy-v2.md"), false);
  assert.ok(deferred(result, "references/routing-and-discovery.md"));
  assert.equal(
    result.loadLater.some(({ path: reference }) => reference === "references/v4-protocol-mechanics.md"),
    true
  );
  assert.equal(
    result.loadLater.some(({ path: reference }) => reference === "references/programmable-fee-policy-v2.md"),
    true
  );
});

test("surface-only repair and review routes defer v4 until a canonical capability is selected", () => {
  for (const mode of ["repair", "review"]) {
    const result = planKnowledge({
      mode,
      capabilities: ["browser-game"],
      surfaces: ["application", "indexer", "service"],
      skillRoot
    });
    assert.equal(paths(result).includes("references/v4-protocol-mechanics.md"), false, mode);
    assert.equal(
      result.loadLater.some(({ path: reference }) => reference === "references/v4-protocol-mechanics.md"),
      true,
      mode
    );
  }
});

test("canonical v4 prototype capabilities load protocol mechanics and the full fee policy", () => {
  const result = planKnowledge({
    mode: "prototype",
    capabilities: ["canonical-v4-pool"],
    surfaces: ["contract"],
    skillRoot
  });

  assert.ok(deferred(result, "references/v4-protocol-mechanics.md"));
  assert.ok(deferred(result, "references/programmable-fee-policy-v2.md"));
});

test("game compositions do not assume a signed service before the outcome architecture is chosen", () => {
  const templatePlan = composeTemplate({
    catalog,
    starterId: "custom-hook",
    packIds: ["threejs-pvp-rewards"]
  });
  const result = planKnowledge({ mode: "preflight", templatePlan, skillRoot });
  assert.ok(deferred(result, "references/project-surfaces-and-capabilities.md"));
  assert.ok(deferred(result, "references/runtime-assets.md"));
  assert.ok(deferred(result, "references/companion-manifests.md"));
  assert.equal(result.surfaces.includes("service"), false);
  assert.equal(result.capabilities.includes("signed-claim"), false);
  assert.equal(result.capabilities.includes("offchain-outcome"), false);
  assert.equal(paths(result).includes("references/agent-entry-and-application.md"), false);
  assert.ok(result.loadNow.length < 12, JSON.stringify(result.loadNow));
});

test("token behavior routes through open mechanics instead of the one-token v1 compatibility profile", () => {
  const result = planKnowledge({
    mode: "preflight",
    capabilities: ["token-transfer-tax", "token-managed-automatic-liquidity"],
    skillRoot
  });
  assert.ok(deferred(result, "references/scenario-matrix.md"));
  assert.equal(paths(result).includes("references/v4-protocol-mechanics.md"), false);
  assert.equal(paths(result).includes("references/compatibility-standard.md"), false);
});

test("Registry discovery metadata stays namespaced and never becomes Builder novelty", () => {
  const snapshot = JSON.parse(fs.readFileSync(
    path.join(skillRoot, "references", "programmable-registry-snapshot.json"),
    "utf8"
  ));
  const entry = snapshot.projects.find(({ record }) => record.id === "classic");
  const result = planKnowledge({
    mode: "explore",
    registryProjects: [{
      capabilities: entry.record.capabilities,
      id: entry.record.id,
      recordSha256: entry.sourceSha256,
      status: entry.record.status,
      surfaces: entry.record.surfaces
    }],
    skillRoot
  });

  assert.deepEqual(result.capabilities, []);
  assert.deepEqual(result.surfaces, []);
  assert.deepEqual(result.unknownCapabilities, []);
  assert.deepEqual(result.unknownSurfaces, []);
  assert.equal(result.reviewRoute, "selected-profile");
  assert.equal(result.automaticAdverseDecision, false);
  assert.equal(result.registryMetadataAffectsEligibility, false);
  assert.equal(result.registryRoutingHintsApplied, false);
  assert.equal(result.registryProjects[0].id, "classic");
  assert.equal(
    result.loadLater.some(({ path: reference }) => reference === "references/routing-and-discovery.md"),
    true
  );
});

test("Registry discovery accepts 20 records and batches the complete 21st-record inventory", () => {
  const projects20 = registryProjects(20);
  const accepted = planKnowledge({ mode: "explore", registryProjects: projects20, skillRoot });
  assert.equal(accepted.status, undefined);
  assert.deepEqual(accepted.registryProjects.map(({ id }) => id), projects20.map(({ id }) => id));

  const projects21 = registryProjects(21);
  const held = planKnowledge({ mode: "explore", registryProjects: projects21, skillRoot });
  assert.equal(held.code, "KNOWLEDGE_SPLIT_REVIEW_REQUIRED");
  assertReviewOnlyHold(held);
  assert.equal(held.registryMetadataAffectsEligibility, false);
  assert.equal(held.reviewRoute, "selected-profile");
  assert.equal(held.splitReviewPlan.classification, "tooling-split-review");
  assert.equal(held.splitReviewPlan.maximumRegistryProjectsPerBatch, 20);
  assert.equal(held.splitReviewPlan.registryProjectCount, 21);
  assert.equal(held.splitReviewPlan.registryProjectIdBatches.every((batch) => batch.length <= 20), true);
  assert.deepEqual(held.splitReviewPlan.registryProjectIdBatches.flat(), projects21.map(({ id }) => id));
  assert.deepEqual(held.registryProjects.map(({ id }) => id), projects21.map(({ id }) => id));

  const reordered = planKnowledge({
    mode: "explore",
    registryProjects: [...projects21].reverse(),
    skillRoot
  });
  assert.deepEqual(reordered.splitReviewPlan, held.splitReviewPlan);
  assert.equal(reordered.profileDigest, held.profileDigest);

  const invalid = structuredClone(projects21);
  invalid[0].id = "../escape";
  assert.throws(
    () => planKnowledge({ mode: "explore", registryProjects: invalid, skillRoot }),
    (error) => error.code === "KNOWLEDGE_INPUT_INVALID"
  );

  const ids = projects21.map(({ id }) => id);
  const args = [cli, "context", "--mode", "explore"];
  for (const id of ids) args.push("--registry-project", id);
  const cliResult = childProcess.spawnSync(process.execPath, args, {
    encoding: "utf8",
    shell: false
  });
  assert.equal(cliResult.status, 0, cliResult.stdout || cliResult.stderr);
  const output = JSON.parse(cliResult.stdout);
  assert.equal(output.ok, true);
  assertReviewOnlyHold(output.result);
  assert.equal(output.result.networkAccessed, false);
  assert.deepEqual(output.result.registryProjects, []);
  assert.deepEqual(output.result.splitReviewPlan.registryProjectIdBatches.flat(), ids);
  assert.equal(
    output.result.sources.some(({ kind }) => kind === "registry-discovery-split-review"),
    true
  );
});

test("explicit known high-risk capabilities inherit their canonical catalog review route", () => {
  for (const [capability, expectedReviewRoute] of [
    ["async-swap", "architecture-review-required"],
    ["custom-curve", "architecture-review-required"],
    ["dynamic-lp-fee", "custom-review"],
    ["browser-game", "architecture-review-required"],
    ["threejs", "architecture-review-required"]
  ]) {
    const result = planKnowledge({
      mode: "explore",
      capabilities: [capability],
      skillRoot
    });
    assert.equal(result.reviewRoute, expectedReviewRoute, capability);
    assert.equal(result.automaticAdverseDecision, false, capability);
  }
});

test("direct capability Legos are exact, catalog-provenance-bound, and never expand a pack", () => {
  const result = planKnowledge({
    mode: "explore",
    capabilities: ["randomness", "randomness", "owner-defined-telepathy"],
    skillRoot
  });
  assert.deepEqual(result.capabilities, ["owner-defined-telepathy", "randomness"]);
  assert.equal(result.capabilities.includes("loot-rewards"), false);
  assert.equal(result.directCapabilityLegos.selectionSemantics, "exact-capability-only-no-pack-expansion");
  assert.match(result.directCapabilityLegos.selectionDigest, /^[a-f0-9]{64}$/u);
  assert.equal(result.directCapabilityLegos.entries.length, 2);

  const randomness = result.directCapabilityLegos.entries.find(({ capabilityId }) => capabilityId === "randomness");
  assert.equal(randomness.source, "catalog");
  assert.equal(randomness.definitionReceipts.some((receipt) => (
    receipt.definitionId === "verifiable-randomness"
    && receipt.definitionKind === "pack"
    && receipt.definitionSha256 === catalog.byId.get("verifiable-randomness").definitionSha256
  )), true);
  assert.equal(randomness.exactRequirementStatus, "catalog-atomic");
  assert.match(randomness.requiredFacts.join("\n"), /Entropy source/u);
  assert.match(randomness.requiredTests.join("\n"), /input-manipulation/u);
  assert.doesNotMatch(randomness.requiredFacts.join("\n"), /loot|reward/iu);
  assert.match(randomness.capabilityDigest, /^[a-f0-9]{64}$/u);

  const unknown = result.directCapabilityLegos.entries.find(({ capabilityId }) => capabilityId === "owner-defined-telepathy");
  assert.deepEqual(unknown.definitionReceipts, []);
  assert.equal(unknown.source, "owner-defined");
  assert.equal(unknown.catalogStatus, "unlisted");
  assert.equal(unknown.automaticDecision, "none");
  assert.equal(unknown.eligibilityEffect, "none");
  assert.equal(unknown.reviewRoute, "architecture-review-required");

  const cliResult = childProcess.spawnSync(process.execPath, [
    cli,
    "context",
    "--mode",
    "explore",
    "--capability",
    "randomness"
  ], { encoding: "utf8", shell: false });
  assert.equal(cliResult.status, 0, cliResult.stdout || cliResult.stderr);
  const output = JSON.parse(cliResult.stdout);
  assert.deepEqual(output.result.capabilities, ["randomness"]);
  assert.equal(output.result.capabilities.includes("loot-rewards"), false);
  assert.equal(output.result.directCapabilityLegos.entries[0].capabilityId, "randomness");
  assert.equal(output.result.directCapabilityLegos.selectionDigest, planKnowledge({
    mode: "explore",
    capabilities: ["randomness"],
    skillRoot
  }).directCapabilityLegos.selectionDigest);

  const templatePlan = composeTemplate({
    catalog,
    starterId: "blank-custom",
    capabilityIds: ["randomness"]
  });
  const templateResult = planKnowledge({ mode: "prototype", templatePlan, skillRoot });
  assert.equal(templateResult.capabilities.includes("randomness"), true);
  assert.equal(templateResult.capabilities.includes("loot-rewards"), false);
  assert.ok(deferred(templateResult, "references/companion-manifests.md"));
  const templateSource = templateResult.sources.find(({ kind }) => kind === "template-plan");
  assert.deepEqual(templateSource.requestedCapabilityIds, ["randomness"]);
  assert.deepEqual(templateSource.directCapabilityLegos, templatePlan.directCapabilityLegos);
  assert.equal(
    templateSource.directCapabilityLegos.entries[0].definitionReceipts.some(({ definitionId }) => (
      definitionId === "verifiable-randomness"
    )),
    true
  );
});

test("Registry capability metadata cannot escalate or downgrade Builder review routing", () => {
  const result = planKnowledge({
    mode: "explore",
    registryProjects: [{
      capabilities: ["async-swap", "dynamic-lp-fee", "threejs"],
      id: "descriptive-only",
      recordSha256: `sha256:${"a".repeat(64)}`,
      status: "accepted",
      surfaces: ["contract", "game"]
    }],
    skillRoot
  });

  assert.deepEqual(result.capabilities, []);
  assert.deepEqual(result.surfaces, []);
  assert.equal(result.reviewRoute, "selected-profile");
  assert.equal(result.automaticAdverseDecision, false);
  assert.equal(result.registryMetadataAffectsEligibility, false);
  assert.equal(result.registryRoutingHintsApplied, false);
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
  ]) assert.ok(deferred(result, reference), reference);
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
  assert.ok(deferred(result, "references/project-surfaces-and-capabilities.md"));
  for (const reference of [
    "references/scenario-matrix.md",
    "references/v4-hook-lego.md",
    "references/security-and-evidence.md"
  ]) {
    assert.equal(paths(result).includes(reference), false, reference);
    assert.equal(result.loadLater.some(({ path: deferred }) => deferred === reference), true, reference);
  }
  assert.equal(result.contextBudget.status, "within-target");
  assert.ok(result.contextBudget.estimatedTokens <= 4000);
});

test("submit defers unrelated capability chapters while preserving their route", () => {
  const result = planKnowledge({
    mode: "submit",
    capabilities: ["telepathic-auction-world"],
    surfaces: ["other"],
    skillRoot
  });
  assert.equal(result.reviewRoute, "architecture-review-required");
  assert.equal(result.contextBudget.status, "within-target");
  assert.ok(result.contextBudget.estimatedTokens <= 4000);
  assert.equal(paths(result).includes("references/security-and-evidence.md"), false);
  assert.equal(
    result.loadLater.some(({ path: deferred, reasons }) =>
      deferred === "references/security-and-evidence.md"
      && reasons.includes("novel-capability:architecture-review")
    ),
    true
  );
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

test("normal template source receipts bind owner labels into the profile digest", () => {
  const firstPlan = composeTemplate({
    catalog,
    starterId: "blank-custom",
    customCapabilities: [{ id: "novel-thing", label: "Novel thing A" }]
  });
  const secondPlan = composeTemplate({
    catalog,
    starterId: "blank-custom",
    customCapabilities: [{ id: "novel-thing", label: "Novel thing B" }]
  });
  const first = planKnowledge({ mode: "prototype", templatePlan: firstPlan, skillRoot });
  const repeated = planKnowledge({ mode: "prototype", templatePlan: firstPlan, skillRoot });
  const second = planKnowledge({ mode: "prototype", templatePlan: secondPlan, skillRoot });

  assert.equal(first.profileDigest, repeated.profileDigest);
  assert.notEqual(firstPlan.selectionDigest, secondPlan.selectionDigest);
  assert.notEqual(first.profileDigest, second.profileDigest);
  assert.equal(
    first.sources.find(({ kind }) => kind === "template-plan").selectionDigest,
    firstPlan.selectionDigest
  );
});

test("historical template bytes remain context-reviewable without current-catalog claims", () => {
  const historicalCatalog = JSON.parse(fs.readFileSync(
    path.join(skillRoot, "references", "template-catalog-history.json"),
    "utf8"
  )).releases[0];
  const templatePlan = structuredClone(composeTemplate({ catalog, starterId: "ordinary-launch" }));
  templatePlan.catalogDigest = historicalCatalog.catalogDigest;
  const selectionPreimage = {
    schemaVersion: "1.0.0",
    catalogDigest: templatePlan.catalogDigest,
    starterId: templatePlan.selection.starterId,
    requestedPackIds: templatePlan.selection.requestedPackIds,
    selectedPackIds: templatePlan.selection.selectedPackIds,
    customCapabilities: [],
    localTags: []
  };
  templatePlan.selectionDigest = crypto.createHash("sha256")
    .update(Buffer.from("programmable.template-selection.v1", "utf8"))
    .update(Buffer.from([0]))
    .update(Buffer.from(canonicalJson(selectionPreimage), "utf8"))
    .digest("hex");

  const result = planKnowledge({ mode: "prototype", templatePlan, skillRoot });
  const source = result.sources.find(({ kind }) => kind === "template-plan");
  assert.equal(source.catalogProvenance, "historical-unverified");
  assert.equal(source.catalogDigest, historicalCatalog.catalogDigest);
  assert.equal(source.selectionDigest, templatePlan.selectionDigest);
  assert.equal(result.reviewRoute, "architecture-review-required");
  assert.equal(result.automaticAdverseDecision, false);
});

test("65 local tags stay on the selected product review route and materialization path", () => {
  const templatePlan = composeTemplate({
    catalog,
    starterId: "ordinary-launch",
    localTags: numberedIds("tag", 65)
  });
  const result = planKnowledge({ mode: "prototype", templatePlan, skillRoot });

  assert.equal(result.status, undefined);
  assert.equal(result.code, undefined);
  assert.equal(result.reviewRoute, "standard-review");
  assert.equal(result.automaticAdverseDecision, false);
});

test("knowledge routing accepts 256 ids and returns a non-adverse split review plan at 257", () => {
  const capabilities256 = numberedIds("capability", 256);
  const accepted = planKnowledge({
    mode: "submit",
    capabilities: capabilities256,
    skillRoot
  });
  assert.equal(accepted.status, undefined);
  assert.deepEqual(accepted.capabilities, capabilities256);

  const capabilities257 = numberedIds("capability", 257);
  const surfaces257 = numberedIds("surface", 257);
  const held = planKnowledge({
    mode: "submit",
    capabilities: capabilities257,
    surfaces: surfaces257,
    skillRoot
  });
  assert.equal(held.code, "KNOWLEDGE_SPLIT_REVIEW_REQUIRED");
  assertReviewOnlyHold(held);
  assert.equal(held.reviewRoute, "architecture-review-required");
  assert.equal(held.splitReviewPlan.maximumItemsPerChunk, 256);
  assert.equal(held.splitReviewPlan.capabilityCount, 257);
  assert.equal(held.splitReviewPlan.surfaceCount, 257);
  assert.equal(held.splitReviewPlan.capabilityChunks.every((chunk) => chunk.length <= 256), true);
  assert.equal(held.splitReviewPlan.surfaceChunks.every((chunk) => chunk.length <= 256), true);
  assert.deepEqual(held.splitReviewPlan.capabilityChunks.flat(), capabilities257);
  assert.deepEqual(held.splitReviewPlan.surfaceChunks.flat(), surfaces257);
  assert.deepEqual(held.capabilities, capabilities257);
  assert.deepEqual(held.surfaces, surfaces257);

  const reordered = planKnowledge({
    mode: "submit",
    capabilities: [...capabilities257].reverse(),
    surfaces: [...surfaces257].reverse(),
    skillRoot
  });
  assert.deepEqual(reordered.splitReviewPlan, held.splitReviewPlan);
  assert.equal(reordered.profileDigest, held.profileDigest);

  const invalid = [...capabilities256, "../../escape"];
  assert.throws(
    () => planKnowledge({ mode: "submit", capabilities: invalid, skillRoot }),
    (error) => error.code === "KNOWLEDGE_INPUT_INVALID"
  );
  assert.throws(
    () => planKnowledge({ mode: "submit", surfaces: [...surfaces257.slice(0, 256), "Bad_Surface"], skillRoot }),
    (error) => error.code === "KNOWLEDGE_INPUT_INVALID"
  );
});

test("template split review preserves exact tags and custom capability policy objects", () => {
  const base = builderTemplateFromPlan(composeTemplate({ catalog, starterId: "blank-custom" }));
  const customCount = 257 - base.templateSelection.localProjectTags.length;
  const customCapabilities = numberedIds("owner-capability", customCount)
    .map((id, index) => ({ id, label: `Owner capability ${index + 1}` }));
  const templatePlan = composeTemplate({
    catalog,
    starterId: "blank-custom",
    customCapabilities
  });
  const result = planKnowledge({ mode: "prototype", templatePlan, skillRoot });

  assert.equal(result.code, "KNOWLEDGE_SPLIT_REVIEW_REQUIRED");
  assertReviewOnlyHold(result);
  assert.equal(result.splitReviewPlan.builderTemplate.code, "BUILDER_TEMPLATE_SPLIT_REVIEW_REQUIRED");
  assert.deepEqual(result.splitReviewPlan.builderTemplate.manualProvenanceFallback, {
    schemaVersion: "1.0.0",
    source: "manual",
    templateSelection: null
  });
  assert.equal(result.splitReviewPlan.builderTemplate.localProjectTagCount, 257);
  assert.equal(
    result.splitReviewPlan.builderTemplate.localProjectTagChunks.every((chunk) => chunk.length <= 256),
    true
  );
  assert.equal(result.splitReviewPlan.builderTemplate.localProjectTagChunks.flat().length, 257);
  const expectedCustomCapabilities = templatePlan.customCapabilities.map((capability) => ({
    id: capability.id,
    label: capability.label,
    catalogStatus: capability.catalogStatus,
    automaticDecision: capability.automaticDecision,
    reviewRoute: capability.reviewRoute,
    eligibilityEffect: capability.eligibilityEffect
  }));
  assert.deepEqual(
    result.splitReviewPlan.builderTemplate.customCapabilityChunks.flat(),
    expectedCustomCapabilities
  );
  for (const { id } of customCapabilities) assert.equal(result.capabilities.includes(id), true, id);
  assert.deepEqual(result.splitReviewPlan.capabilityChunks.flat(), result.capabilities);

  const relabeledCapabilities = customCapabilities.map((capability, index) => (
    index === 0 ? { ...capability, label: `${capability.label} revised` } : capability
  ));
  const relabeled = planKnowledge({
    mode: "prototype",
    templatePlan: composeTemplate({
      catalog,
      starterId: "blank-custom",
      customCapabilities: relabeledCapabilities
    }),
    skillRoot
  });
  assert.deepEqual(relabeled.capabilities, result.capabilities);
  assert.notEqual(
    relabeled.splitReviewPlan.builderTemplate.selectionDigest,
    result.splitReviewPlan.builderTemplate.selectionDigest
  );
  assert.notEqual(relabeled.profileDigest, result.profileDigest);
});

test("knowledge profile digest binds selected reference bytes and the routing contract", (t) => {
  const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "programmable-knowledge-digest-")));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const copiedSkill = path.join(temporary, "skill");
  fs.cpSync(skillRoot, copiedSkill, { recursive: true });

  const before = planKnowledge({ mode: "explore", skillRoot: copiedSkill });
  const beforeCompiler = before.loadNow.find(({ path: reference }) => reference === "references/business-system-compiler.md");
  assert.ok(beforeCompiler, JSON.stringify(before.loadNow));
  const compilerPath = path.join(copiedSkill, beforeCompiler.path);
  const compiler = fs.readFileSync(compilerPath, "utf8");
  const mutated = compiler.replace("# Business-system compiler", "# Business-system compilEr");
  assert.notEqual(mutated, compiler);
  assert.equal(Buffer.byteLength(mutated), Buffer.byteLength(compiler));
  fs.writeFileSync(compilerPath, mutated);
  const afterReferenceChange = planKnowledge({ mode: "explore", skillRoot: copiedSkill });
  const afterCompiler = afterReferenceChange.loadNow.find(({ path: reference }) => reference === beforeCompiler.path);
  assert.ok(afterCompiler, JSON.stringify(afterReferenceChange.loadNow));
  assert.notEqual(afterReferenceChange.profileDigest, before.profileDigest);
  assert.notEqual(afterCompiler.sha256, beforeCompiler.sha256);

  const routingPath = path.join(copiedSkill, "references", "knowledge-routing.json");
  const routing = fs.readFileSync(routingPath, "utf8");
  const changedRouting = routing.replace("Load the capability-specific chapters", "Read the capability-specific chapters");
  assert.equal(Buffer.byteLength(changedRouting), Buffer.byteLength(routing));
  fs.writeFileSync(routingPath, changedRouting);
  const afterRoutingChange = planKnowledge({ mode: "explore", skillRoot: copiedSkill });
  assert.notEqual(afterRoutingChange.profileDigest, afterReferenceChange.profileDigest);
  assert.notEqual(afterRoutingChange.knowledgeRouting.sha256, before.knowledgeRouting.sha256);
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
    assert.ok(deferred(output.result, "references/v4-sdk-integration.md"));
    assert.equal(Buffer.byteLength(result.stdout), output.result.contextBudget.routerOutput.bytes);
    assert.equal(
      output.result.contextBudget.totalBytes,
      output.result.contextBudget.contentBytes + output.result.contextBudget.routerOutput.bytes
    );
    assert.equal(
      output.result.contextBudget.estimatedTokens,
      output.result.contextBudget.contentEstimatedTokens + output.result.contextBudget.routerOutput.estimatedTokens
    );
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("context command resolves a hash-bound offline Registry project without routing its descriptive ids", () => {
  const result = childProcess.spawnSync(process.execPath, [
    cli,
    "context",
    "--mode",
    "explore",
    "--registry-project",
    "classic"
  ], { encoding: "utf8", shell: false });
  assert.equal(result.status, 0, result.stdout || result.stderr);
  assert.equal(result.stderr, "");
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  assert.equal(output.result.registryProjects[0].id, "classic");
  assert.deepEqual(output.result.capabilities, []);
  assert.deepEqual(output.result.surfaces, []);
  assert.deepEqual(output.result.unknownCapabilities, []);
  assert.deepEqual(output.result.unknownSurfaces, []);
  assert.equal(output.result.reviewRoute, "selected-profile");
  assert.equal(output.result.networkAccessed, false);
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

test("context help stays concise while opt-in JSON preserves every selector", () => {
  const help = childProcess.spawnSync(process.execPath, [cli, "context", "--help"], {
    encoding: "utf8",
    shell: false
  });
  assert.equal(help.status, 0, help.stdout || help.stderr);
  assert.equal(help.stderr, "");
  assert.ok(Buffer.byteLength(help.stdout) < 1_500);
  assert.match(help.stdout, /--help --json/u);
  assert.match(help.stdout, /owner-defined kebab-case capabilities/u);

  const detail = childProcess.spawnSync(process.execPath, [cli, "context", "--help", "--json"], {
    encoding: "utf8",
    shell: false
  });
  assert.equal(detail.status, 0, detail.stdout || detail.stderr);
  const selectorInventory = JSON.parse(detail.stdout).result;
  assert.ok(selectorInventory.capabilityIds.includes("dynamic-lp-fee"));
  assert.ok(selectorInventory.surfaceIds.includes("game"));
  assert.ok(selectorInventory.routeFamilies.some(({ id }) => id === "hook-implementation"));
  assert.deepEqual(selectorInventory.packIds, catalog.definitions.filter(({ kind }) => kind === "pack").map(({ id }) => id));

  const ambiguous = childProcess.spawnSync(process.execPath, [
    cli,
    "context",
    "--mode",
    "prototype",
    "--capability",
    "hook-implementation",
    "--surface",
    "runtime"
  ], { encoding: "utf8", shell: false });
  assert.equal(ambiguous.status, 2, ambiguous.stdout || ambiguous.stderr);
  assert.equal(ambiguous.stderr, "");
  const payload = JSON.parse(ambiguous.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, "KNOWLEDGE_ROUTE_FAMILY_AMBIGUOUS");
  assert.equal(payload.error.details.ideaEligibility, "ELIGIBLE_FOR_REVIEW");
  assert.equal(payload.error.details.automaticAdverseDecision, false);
  assert.equal(Object.hasOwn(payload, "result"), false);
});

test("context command routes only template size overflow to manual split review", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-knowledge-router-template-size-"));
  const oversizedPlan = path.join(temporary, "oversized.json");
  const sameSizeDifferentPlan = path.join(temporary, "oversized-different.json");
  const invalidUtf8Plan = path.join(temporary, "invalid-utf8.json");
  const invalidJsonPlan = path.join(temporary, "invalid-json.json");
  try {
    fs.writeFileSync(oversizedPlan, JSON.stringify({ padding: "x".repeat(1_048_576) }));
    let result = childProcess.spawnSync(process.execPath, [
      cli,
      "context",
      "--mode",
      "prototype",
      "--template-plan",
      oversizedPlan
    ], { encoding: "utf8", shell: false });
    assert.equal(result.status, 0, result.stdout || result.stderr);
    let output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.result.code, "KNOWLEDGE_SPLIT_REVIEW_REQUIRED");
    assertReviewOnlyHold(output.result);
    assert.equal(output.result.splitReviewPlan.templatePlan.code, "TEMPLATE_PLAN_SPLIT_REVIEW_REQUIRED");
    assert.equal(output.result.splitReviewPlan.templatePlan.reason, "size-overflow");
    assert.equal(output.result.splitReviewPlan.templatePlan.maximumBytes, 1_048_576);
    assert.equal(output.result.splitReviewPlan.templatePlan.byteLength, fs.statSync(oversizedPlan).size);
    assert.match(output.result.splitReviewPlan.templatePlan.sourceSha256, /^sha256:[a-f0-9]{64}$/u);
    const source = output.result.sources.find(({ kind }) => kind === "template-plan-split-review");
    assert.equal(source.sourceSha256, output.result.splitReviewPlan.templatePlan.sourceSha256);
    assert.deepEqual(output.result.splitReviewPlan.templatePlan.manualProvenanceFallback, {
      schemaVersion: "1.0.0",
      source: "manual",
      templateSelection: null
    });
    assert.equal(result.stdout.includes("xxxxxxxxxxxxxxxx"), false);

    fs.writeFileSync(sameSizeDifferentPlan, JSON.stringify({ padding: "y".repeat(1_048_576) }));
    assert.equal(fs.statSync(sameSizeDifferentPlan).size, fs.statSync(oversizedPlan).size);
    const secondResult = childProcess.spawnSync(process.execPath, [
      cli,
      "context",
      "--mode",
      "prototype",
      "--template-plan",
      sameSizeDifferentPlan
    ], { encoding: "utf8", shell: false });
    assert.equal(secondResult.status, 0, secondResult.stdout || secondResult.stderr);
    const secondOutput = JSON.parse(secondResult.stdout);
    assert.notEqual(
      secondOutput.result.splitReviewPlan.templatePlan.sourceSha256,
      output.result.splitReviewPlan.templatePlan.sourceSha256
    );
    assert.notEqual(secondOutput.result.profileDigest, output.result.profileDigest);
    assert.equal(secondResult.stdout.includes("yyyyyyyyyyyyyyyy"), false);

    fs.writeFileSync(invalidUtf8Plan, Buffer.from([0xff, 0xfe]));
    result = childProcess.spawnSync(process.execPath, [
      cli,
      "context",
      "--mode",
      "prototype",
      "--template-plan",
      invalidUtf8Plan
    ], { encoding: "utf8", shell: false });
    assert.equal(result.status, 1, result.stdout || result.stderr);
    output = JSON.parse(result.stdout);
    assert.equal(output.ok, false);
    assert.equal(output.error.code, "TEMPLATE_PLAN_INVALID");

    fs.writeFileSync(invalidJsonPlan, "{not-json}\n");
    result = childProcess.spawnSync(process.execPath, [
      cli,
      "context",
      "--mode",
      "prototype",
      "--template-plan",
      invalidJsonPlan
    ], { encoding: "utf8", shell: false });
    assert.equal(result.status, 1, result.stdout || result.stderr);
    output = JSON.parse(result.stdout);
    assert.equal(output.ok, false);
    assert.equal(output.error.code, "TEMPLATE_PLAN_INVALID");
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("context CLI emits the complete typed split-review plan for 257 capabilities", () => {
  const capabilities = numberedIds("cli-capability", 257);
  const args = [cli, "context", "--mode", "submit"];
  for (const capability of capabilities) args.push("--capability", capability);
  const result = childProcess.spawnSync(process.execPath, args, {
    encoding: "utf8",
    shell: false
  });

  assert.equal(result.status, 0, result.stdout || result.stderr);
  assert.equal(result.stderr, "");
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  assert.equal(output.result.code, "KNOWLEDGE_SPLIT_REVIEW_REQUIRED");
  assertReviewOnlyHold(output.result);
  assert.deepEqual(output.result.splitReviewPlan.capabilityChunks.flat(), capabilities);

  const help = childProcess.spawnSync(process.execPath, [cli, "context", "--help"], {
    encoding: "utf8",
    shell: false
  });
  assert.equal(help.status, 0, help.stdout || help.stderr);
  assert.match(help.stdout, /Over 256 direct ids/u);
  assert.match(help.stdout, /HOLD_SPLIT_REVIEW/u);
});

test("confirmed activation is digest-bound, delta-only, and promotes the compact v4 reasoning kernel first", () => {
  const cold = contextCli(["--mode", "autopilot", "--brief"]);
  assert.equal(cold.status, 0, cold.stdout || cold.stderr);
  assert.ok(Buffer.byteLength(cold.stdout) < 2_500);
  const coldOutput = JSON.parse(cold.stdout);

  const activated = contextCli([
    "--mode", "autopilot",
    "--capability", "custom-curve",
    "--surface", "contract",
    "--activate-confirmed",
    "--base-profile-digest", coldOutput.result.profileDigest,
    "--brief"
  ]);
  assert.equal(activated.status, 0, activated.stdout || activated.stderr);
  assert.equal(activated.stderr, "");
  assert.ok(Buffer.byteLength(activated.stdout) < 2_500, activated.stdout);
  const output = JSON.parse(activated.stdout).result;
  assert.equal(output.kind, "programmable-knowledge-activation");
  assert.equal(output.mode, "autopilot");
  assert.deepEqual(output.selectors.capabilities.ids, ["custom-curve"]);
  assert.deepEqual(output.selectors.surfaces.ids, ["contract"]);
  assert.equal(Object.hasOwn(output, "unknowns"), false);
  assert.equal(output.baseProfileDigest, coldOutput.result.profileDigest);
  assert.match(output.selectionDigest, /^[a-f0-9]{64}$/u);
  assert.match(output.profileDigest, /^[a-f0-9]{64}$/u);
  assert.equal(output.loadNow.length, 1);
  assert.equal(output.loadNow[0].path, "references/v4-contract-reasoning-kernel.md");
  assert.match(output.loadNow[0].sha256, /^[a-f0-9]{64}$/u);
  assert.ok(output.loadNow[0].bytes > 0 && output.loadNow[0].bytes <= 6_000);
  assert.equal(output.loadNow[0].reasons.includes("capability:custom-curve"), true);
  assert.equal(output.loadNow[0].reasons.includes("activation-route:capability:hook-implementation"), true);
  assert.equal(output.loadNow.some(({ path: reference }) => reference === "references/business-system-compiler.md"), false);
  assert.equal(output.contextBudget.phase, "confirmed-activation-delta");
  assert.equal(output.contextBudget.cumulativeEstimatedTokens < 8_000, true, JSON.stringify(output.contextBudget));
  assert.match(output.fullOutputInstruction, /without --brief/u);

  const repeated = contextCli([
    "--mode", "autopilot",
    "--surface", "contract",
    "--capability", "custom-curve",
    "--activate-confirmed",
    "--base-profile-digest", coldOutput.result.profileDigest,
    "--brief"
  ]);
  assert.equal(repeated.status, 0, repeated.stdout || repeated.stderr);
  assert.equal(repeated.stdout, activated.stdout);
});

test("confirmed browser-game application activation never introduces v4 context", () => {
  const cold = JSON.parse(contextCli(["--mode", "autopilot", "--brief"]).stdout).result;
  const activated = contextCli([
    "--mode", "autopilot",
    "--capability", "browser-game",
    "--surface", "application",
    "--activate-confirmed",
    "--base-profile-digest", cold.profileDigest
  ]);
  assert.equal(activated.status, 0, activated.stdout || activated.stderr);
  const output = JSON.parse(activated.stdout).result;
  assert.deepEqual(output.loadNow.map(({ path: reference }) => reference), ["references/runtime-assets.md"]);
  assert.equal(
    [...output.loadNow, ...output.loadLater].some(({ path: reference }) => /v4-(?:protocol|hook|sdk|liquidity)/u.test(reference)),
    false
  );
  assert.equal(output.loadLater[0].path, "references/project-surfaces-and-capabilities.md");
});

test("confirmed cross-domain activation loads two route-owned specialists under the cumulative budget", () => {
  const cold = JSON.parse(contextCli(["--mode", "autopilot", "--brief"]).stdout).result;
  const activated = contextCli([
    "--mode", "autopilot",
    "--capability", "browser-game",
    "--capability", "custom-curve",
    "--surface", "application",
    "--surface", "contract",
    "--activate-confirmed",
    "--base-profile-digest", cold.profileDigest,
    "--brief"
  ]);
  assert.equal(activated.status, 0, activated.stdout || activated.stderr);
  assert.equal(activated.stderr, "");
  assert.ok(Buffer.byteLength(activated.stdout) < 2_500, activated.stdout);
  const output = JSON.parse(activated.stdout).result;
  assert.deepEqual(
    output.loadNow.map(({ path: reference }) => reference),
    ["references/v4-contract-reasoning-kernel.md", "references/runtime-assets.md"]
  );
  assert.equal(output.knowledgeActivation.maximumLoadNow, 2);
  assert.deepEqual(output.knowledgeActivation.routeIds, ["capability:hook-implementation", "capability:runtime-product"]);
  assert.equal(output.contextBudget.cumulativeEstimatedTokens < 8_000, true, JSON.stringify(output.contextBudget));
});

test("confirmed activation keeps a third specialist deferred without overflowing the brief", () => {
  const cold = JSON.parse(contextCli(["--mode", "autopilot", "--brief"]).stdout).result;
  const argumentsList = [
    "--mode", "autopilot",
    "--capability", "browser-game",
    "--capability", "chainlink-vrf-v2-5",
    "--capability", "custom-curve",
    "--surface", "application",
    "--surface", "contract",
    "--surface", "external-provider",
    "--activate-confirmed",
    "--base-profile-digest", cold.profileDigest
  ];
  const activated = contextCli([...argumentsList, "--brief"]);
  assert.equal(activated.status, 0, activated.stdout || activated.stderr);
  assert.ok(Buffer.byteLength(activated.stdout) < 2_500, activated.stdout);
  const output = JSON.parse(activated.stdout).result;
  assert.deepEqual(
    output.loadNow.map(({ path: reference }) => reference),
    ["references/v4-contract-reasoning-kernel.md", "references/chainlink-provider-integration.md"]
  );
  const complete = JSON.parse(contextCli(argumentsList).stdout).result;
  assert.equal(complete.loadLater.some(({ path: reference }) => reference === "references/runtime-assets.md"), true);
  assert.equal(Object.hasOwn(output.selectors, "packs"), false);
  assert.equal(Object.hasOwn(output.selectors, "registryProjects"), false);
  assert.equal(Object.hasOwn(output, "unknowns"), false);
});

test("confirmed route specialists cover clients, providers, economics, and repository architecture", () => {
  const cold = JSON.parse(contextCli(["--mode", "autopilot", "--brief"]).stdout).result;
  for (const fixture of [
    {
      args: ["--capability", "v4-swap-client", "--surface", "application"],
      expected: ["references/v4-sdk-integration.md"]
    },
    {
      args: ["--capability", "chainlink-vrf-v2-5", "--surface", "external-provider"],
      expected: [
        "references/chainlink-provider-integration.md",
        "references/ethereum-production-invariants.md"
      ]
    },
    {
      args: ["--capability", "continuous-clearing-auction", "--surface", "contract"],
      expected: ["references/v4-contract-reasoning-kernel.md"]
    },
    {
      args: ["--capability", "project-spec", "--surface", "other"],
      expected: [],
      reusedBasePath: "references/business-system-compiler.md"
    }
  ]) {
    const activated = contextCli([
      "--mode", "autopilot",
      ...fixture.args,
      "--activate-confirmed",
      "--base-profile-digest", cold.profileDigest,
      "--brief"
    ]);
    assert.equal(activated.status, 0, activated.stdout || activated.stderr);
    const output = JSON.parse(activated.stdout).result;
    assert.deepEqual(
      output.loadNow.map(({ path: reference }) => reference),
      fixture.expected,
      JSON.stringify(output)
    );
    if (fixture.reusedBasePath !== undefined) {
      assert.deepEqual(output.knowledgeActivation.reusedBasePaths, [fixture.reusedBasePath]);
      assert.equal(output.routedLater.paths.includes(fixture.reusedBasePath), false);
    } else {
      assert.equal(Object.hasOwn(output.knowledgeActivation, "reusedBasePaths"), false);
    }
    assert.ok(output.loadNow.length <= 2, JSON.stringify(output.loadNow));
    assert.equal(output.contextBudget.cumulativeEstimatedTokens < 8_000, true, JSON.stringify(output.contextBudget));
  }
});

test("confirmed activation never reloads or recharges a cold reference", () => {
  const cold = JSON.parse(contextCli(["--mode", "autopilot", "--brief"]).stdout).result;
  const activated = contextCli([
    "--mode", "autopilot",
    "--capability", "project-spec",
    "--surface", "other",
    "--activate-confirmed",
    "--base-profile-digest", cold.profileDigest,
    "--brief"
  ]);
  assert.equal(activated.status, 0, activated.stdout || activated.stderr);
  const output = JSON.parse(activated.stdout).result;
  assert.deepEqual(output.loadNow, []);
  assert.deepEqual(output.knowledgeActivation.reusedBasePaths, ["references/business-system-compiler.md"]);
  assert.equal(output.routedLater.paths.includes("references/business-system-compiler.md"), false);
  assert.equal(output.contextBudget.activation.referenceBytes, 0);
  assert.equal(
    output.contextBudget.cumulativeBytes,
    output.contextBudget.base.contentBytes
      + output.contextBudget.base.briefOutputBytes
      + output.contextBudget.activation.outputBytes
  );
});

test("a confirmed capability cannot suppress an independently confirmed surface route", () => {
  const cold = JSON.parse(contextCli(["--mode", "autopilot", "--brief"]).stdout).result;
  const activated = contextCli([
    "--mode", "autopilot",
    "--capability", "project-spec",
    "--surface", "contract",
    "--activate-confirmed",
    "--base-profile-digest", cold.profileDigest,
    "--brief"
  ]);
  assert.equal(activated.status, 0, activated.stdout || activated.stderr);
  const output = JSON.parse(activated.stdout).result;
  assert.deepEqual(
    output.loadNow.map(({ path: reference }) => reference),
    ["references/v4-contract-reasoning-kernel.md"]
  );
  assert.deepEqual(
    output.knowledgeActivation.reusedBasePaths,
    ["references/business-system-compiler.md"]
  );
  assert.deepEqual(output.knowledgeActivation.routeIds, [
    "capability:open-world-project-compiler",
    "surface:contract"
  ]);
  assert.equal(output.routedLater.paths.includes("references/v4-contract-reasoning-kernel.md"), false);
  assert.equal(output.contextBudget.activation.referenceBytes, 5_314);
});

test("confirmed activation rejects empty, family, and stale-base requests without harming eligibility", () => {
  const cold = JSON.parse(contextCli(["--mode", "autopilot", "--brief"]).stdout).result;
  for (const args of [
    ["--mode", "autopilot", "--activate-confirmed", "--base-profile-digest", cold.profileDigest],
    ["--mode", "autopilot", "--capability", "hook-implementation", "--activate-confirmed", "--base-profile-digest", cold.profileDigest],
    ["--mode", "autopilot", "--capability", "custom-curve", "--activate-confirmed", "--base-profile-digest", "0".repeat(64)]
  ]) {
    const rejected = contextCli(args);
    assert.equal(rejected.status, 2, rejected.stdout || rejected.stderr);
    const output = JSON.parse(rejected.stdout);
    assert.equal(output.ok, false);
    assert.equal(output.error.details?.automaticAdverseDecision ?? false, false);
  }

  const novel = contextCli([
    "--mode", "autopilot",
    "--capability", "owner-defined-telepathy",
    "--activate-confirmed",
    "--base-profile-digest", cold.profileDigest,
    "--brief"
  ]);
  assert.equal(novel.status, 0, novel.stdout || novel.stderr);
  const novelOutput = JSON.parse(novel.stdout).result;
  assert.equal(novelOutput.reviewRoute, "architecture-review-required");
  assert.equal(novelOutput.ideaEligibility, "ELIGIBLE_FOR_REVIEW");
  assert.deepEqual(novelOutput.unknowns.capabilities.ids, ["owner-defined-telepathy"]);
  assert.equal(novelOutput.automaticAdverseDecision, false);
  assert.equal(novelOutput.loadNow.length, 1);
});

test("brief output is bounded for oversized selectors and the no-flag envelope remains canonical", () => {
  const capabilities = numberedIds("brief-capability", 257);
  const briefArgs = ["--mode", "submit", "--brief"];
  for (const capability of capabilities) briefArgs.push("--capability", capability);
  const brief = contextCli(briefArgs);
  assert.equal(brief.status, 0, brief.stdout || brief.stderr);
  assert.ok(Buffer.byteLength(brief.stdout) < 2_500, String(Buffer.byteLength(brief.stdout)));
  const output = JSON.parse(brief.stdout).result;
  assert.equal(output.selectors.capabilities.count, 257);
  assert.ok(output.selectors.capabilities.omitted > 0);
  assert.match(output.selectors.capabilities.sha256, /^[a-f0-9]{64}$/u);
  assert.equal(output.unknowns.capabilities.count, 257);
  assert.deepEqual(output.hold, {
    code: "KNOWLEDGE_SPLIT_REVIEW_REQUIRED",
    status: "HOLD_SPLIT_REVIEW",
    ideaEligibility: "ELIGIBLE_FOR_REVIEW",
    designEligible: true,
    automaticAdverseDecision: false,
    automaticMaterialization: false
  });
  assert.match(output.fullOutputInstruction, /without --brief/u);

  const cold = JSON.parse(contextCli(["--mode", "submit", "--brief"]).stdout).result;
  const heldActivationArgs = [
    "--mode", "submit",
    "--activate-confirmed",
    "--base-profile-digest", cold.profileDigest,
    "--brief"
  ];
  for (const capability of capabilities) heldActivationArgs.push("--capability", capability);
  const heldActivation = contextCli(heldActivationArgs);
  assert.equal(heldActivation.status, 0, heldActivation.stdout || heldActivation.stderr);
  assert.ok(Buffer.byteLength(heldActivation.stdout) < 2_500, String(Buffer.byteLength(heldActivation.stdout)));
  const heldOutput = JSON.parse(heldActivation.stdout).result;
  assert.equal(heldOutput.hold.status, "HOLD_SPLIT_REVIEW");
  assert.equal(heldOutput.hold.automaticMaterialization, false);
  assert.equal(heldOutput.kind, "programmable-knowledge-plan");
  assert.equal(heldActivation.stdout, brief.stdout);

  const standard = contextCli(["--mode", "autopilot"]);
  assert.equal(standard.status, 0, standard.stdout || standard.stderr);
  const expected = `${canonicalJson({
    schemaVersion: "1.0.0",
    ok: true,
    command: "context",
    result: planKnowledge({ mode: "autopilot", skillRoot })
  })}\n`;
  assert.equal(standard.stdout, expected);
});

test("activation contract is explicit, duplicate-free, hash-bound, and keeps Fee V2 quarantined", (t) => {
  const activationPath = path.join(skillRoot, "references", "knowledge-activation-v1.json");
  const activationSource = fs.readFileSync(activationPath, "utf8");
  parseBoundedLosslessJson(activationSource);
  const activation = JSON.parse(activationSource);
  const routing = JSON.parse(fs.readFileSync(path.join(skillRoot, "references", "knowledge-routing.json"), "utf8"));
  assert.equal(activation.kind, "programmable-knowledge-activation");
  assert.equal(activation.schemaVersion, "1.1.0");
  assert.equal(activation.selectionSemantics, "confirmed-route-specialists-up-to-two");
  assert.equal(activation.maximumLoadNow, 2);
  assert.equal(activation.cumulativeEstimatedTokenTarget, 8_000);
  assert.deepEqual(activation.quarantinedReferences, ["programmable-fee-policy-v2.md"]);
  assert.deepEqual(
    activation.routeSelections
      .filter(({ routeKind }) => routeKind === "capability")
      .map(({ routeId }) => routeId)
      .sort(),
    routing.capabilityRoutes.map(({ id }) => id).sort()
  );
  assert.deepEqual(
    activation.routeSelections
      .filter(({ routeKind }) => routeKind === "surface")
      .map(({ routeId }) => routeId)
      .sort(),
    routing.surfaceRoutes.map(({ id }) => id).sort()
  );
  assert.deepEqual(
    activation.ordering.map(({ stage, order, path: reference }) => `${stage}:${order}:${reference}`),
    [...activation.ordering]
      .sort((left, right) => left.stage - right.stage || left.order - right.order || Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)))
      .map(({ stage, order, path: reference }) => `${stage}:${order}:${reference}`)
  );

  const cold = JSON.parse(contextCli(["--mode", "autopilot", "--brief"]).stdout).result;
  const fee = contextCli([
    "--mode", "autopilot",
    "--capability", "standard-programmable-fee-hook",
    "--surface", "contract",
    "--activate-confirmed",
    "--base-profile-digest", cold.profileDigest
  ]);
  assert.equal(fee.status, 0, fee.stdout || fee.stderr);
  const feeOutput = JSON.parse(fee.stdout).result;
  assert.equal(feeOutput.loadNow.some(({ path: reference }) => reference === "references/programmable-fee-policy-v2.md"), false);
  assert.equal(feeOutput.loadLater.some(({ path: reference }) => reference === "references/programmable-fee-policy-v2.md"), false);
  assert.equal(feeOutput.deferredCatalog.some(({ path: reference }) => reference === "references/programmable-fee-policy-v2.md"), true);

  const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "programmable-activation-binding-")));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const copiedSkill = path.join(temporary, "skill");
  fs.cpSync(skillRoot, copiedSkill, { recursive: true });
  const copiedCold = JSON.parse(contextCliAt(copiedSkill, ["--mode", "autopilot", "--brief"]).stdout).result;
  const args = [
    "--mode", "autopilot",
    "--capability", "custom-curve",
    "--surface", "contract",
    "--activate-confirmed",
    "--base-profile-digest", copiedCold.profileDigest
  ];
  const before = JSON.parse(contextCliAt(copiedSkill, args).stdout).result;
  fs.appendFileSync(path.join(copiedSkill, "references", "v4-contract-reasoning-kernel.md"), "\nBinding mutation.\n");
  const after = JSON.parse(contextCliAt(copiedSkill, args).stdout).result;
  assert.notEqual(after.loadNow[0].sha256, before.loadNow[0].sha256);
  assert.notEqual(after.profileDigest, before.profileDigest);

  const quarantinedRule = activationSource.replace(
    '"reference": "v4-contract-reasoning-kernel.md",',
    '"reference": "programmable-fee-policy-v2.md",'
  );
  assert.notEqual(quarantinedRule, activationSource);
  fs.writeFileSync(path.join(copiedSkill, "references", "knowledge-activation-v1.json"), quarantinedRule);
  const rejectedQuarantine = contextCliAt(copiedSkill, args);
  assert.equal(rejectedQuarantine.status, 2, rejectedQuarantine.stdout || rejectedQuarantine.stderr);
  assert.equal(JSON.parse(rejectedQuarantine.stdout).error.code, "KNOWLEDGE_ACTIVATION_INVALID");

  fs.writeFileSync(path.join(copiedSkill, "references", "knowledge-activation-v1.json"), activationSource);
  const missingRoute = JSON.parse(activationSource);
  missingRoute.routeSelections = missingRoute.routeSelections.slice(1);
  fs.writeFileSync(
    path.join(copiedSkill, "references", "knowledge-activation-v1.json"),
    `${JSON.stringify(missingRoute, null, 2)}\n`
  );
  const rejectedIncompleteCoverage = contextCliAt(copiedSkill, args);
  assert.equal(rejectedIncompleteCoverage.status, 2, rejectedIncompleteCoverage.stdout || rejectedIncompleteCoverage.stderr);
  assert.equal(JSON.parse(rejectedIncompleteCoverage.stdout).error.code, "KNOWLEDGE_ACTIVATION_INVALID");

  const duplicate = activationSource.replace(
    '"maximumLoadNow": 2,',
    '"maximumLoadNow": 2,\n  "maximumLoadNow": 2,'
  );
  assert.notEqual(duplicate, activationSource);
  assert.throws(() => parseBoundedLosslessJson(duplicate), /duplicate key/u);
});

function paths(result) {
  return result.loadNow.map(({ path: reference }) => reference);
}

function contextCli(args) {
  return contextCliAt(skillRoot, args);
}

function contextCliAt(root, args) {
  return childProcess.spawnSync(process.execPath, [path.join(root, "scripts", "cli.mjs"), "context", ...args], {
    encoding: "utf8",
    shell: false
  });
}

function deferred(result, reference) {
  return result.loadLater.find(({ path: candidate }) => candidate === reference);
}

function numberedIds(prefix, count) {
  return Array.from({ length: count }, (_, index) => `${prefix}-${String(index + 1).padStart(3, "0")}`);
}

function registryProjects(count) {
  return Array.from({ length: count }, (_, index) => ({
    capabilities: [],
    id: `project-${String(index + 1).padStart(3, "0")}`,
    recordSha256: `sha256:${String(index + 1).padStart(64, "0")}`,
    status: "accepted",
    surfaces: []
  }));
}

function assertReviewOnlyHold(value) {
  assert.equal(value.status, "HOLD_SPLIT_REVIEW");
  assert.equal(value.ideaEligibility, "ELIGIBLE_FOR_REVIEW");
  assert.equal(value.designEligible, true);
  assert.equal(value.automaticAdverseDecision, false);
  assert.equal(value.automaticMaterialization, false);
  assert.equal(Object.hasOwn(value, "eligible"), false);
  assert.equal(Object.hasOwn(value, "launchAuthorizationGranted"), false);
  assert.equal(Object.hasOwn(value, "permitGranted"), false);
}
