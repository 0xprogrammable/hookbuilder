#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { validateAgainstSchema } from "./restricted-json-schema-core.mjs";
import { parseBoundedStrictJsonBytes } from "./strict-json-core.mjs";
import { chainlinkProductCapabilities, composeTemplate } from "./template-catalog-composition.mjs";
import { loadTemplateCatalog } from "./template-catalog-loader.mjs";
import { canonicalJson } from "./template-catalog-shared.mjs";
import {
  CHAINLINK_KNOWLEDGE_RECEIPT_SHA256_V1,
  collectChainlinkProviderArtifactBindingsV1,
  requiredChainlinkGenericCapabilitiesV1,
  validateChainlinkProviderProfileV1
} from "./chainlink-provider-profile-core.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.resolve(scriptDirectory, "../references/chainlink-provider-profile-v1.schema.json");
const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
const maximumProfileBytes = 1_048_576;
const maximumArtifactBytes = 64 * 1024 * 1024;
const maximumArtifactCount = 128;
const maximumAggregateArtifactBytes = 256 * 1024 * 1024;
const chainlinkProductCapabilityByIntegration = Object.freeze({
  ccip: "chainlink-ccip",
  cre: "chainlink-cre",
  "data-feeds": "chainlink-data-feeds",
  "data-streams": "chainlink-data-streams",
  "vrf-v2-5": "chainlink-vrf-v2-5"
});
const usage = [
  "Usage: chainlink-provider-profile.mjs check --root <candidate-root> --profile <profile.json>",
  "       chainlink-provider-profile.mjs init --root <candidate-root> --output <new-directory> --product vrf-v2-5 --chain-id <uint256>",
  "",
  "Validate one exact Chainlink provider profile offline, or create one closed planning-only VRF example in a new directory.",
  "A valid profile is structural candidate evidence only; it is not an audit, deployment proof, provider-availability proof, transaction authorization or launch approval."
].join("\n");

try {
  const { command, root, profile, output, product, chainId } = parseArguments(process.argv.slice(2));
  const repositoryRoot = fs.realpathSync(path.resolve(root));
  if (command === "init") {
    const result = initializeVrfPlanningExample({ repositoryRoot, output, product, chainId });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exit(0);
  }
  const profilePath = resolveProfile(repositoryRoot, profile);
  const source = fs.readFileSync(profilePath);
  const value = parseBoundedStrictJsonBytes(source, { maxSourceBytes: maximumProfileBytes });
  const identityFindings = profileIdentityFindings(value);
  const schemaFindings = identityFindings.length === 0
    ? validateAgainstSchema(value, schema).map((finding) => ({
        code: `SCHEMA_${finding.code}`,
        path: finding.path,
        message: finding.message
      }))
    : identityFindings;
  const semanticFindings = schemaFindings.length === 0
    ? validateChainlinkProviderProfileV1(value).map((message) => ({
        code: "CHAINLINK_PROFILE_SEMANTIC_INVALID",
        path: message.split(":", 1)[0],
        message
      }))
    : [];
  const findings = [...schemaFindings, ...semanticFindings];
  if (findings.length === 0) {
    findings.push(...verifyInstalledReceipt(value.sourceReceipt));
    findings.push(...verifyCandidateArtifacts(repositoryRoot, collectChainlinkProviderArtifactBindingsV1(value)));
    if (findings.length === 0) findings.push(...verifyProjectPlan(repositoryRoot, value));
  }
  const result = {
    schemaVersion: "1.0.0",
    ok: findings.length === 0,
    status: findings.length === 0 ? "CHAINLINK_PROFILE_STRUCTURALLY_VALID" : "CHAINLINK_PROFILE_INVALID",
    profile: path.relative(repositoryRoot, profilePath).replaceAll("\\", "/"),
    schema: schema.$id,
    findings,
    artifactBindingsVerified: findings.length === 0,
    deploymentOrRuntimeVerified: false,
    networkAccessed: false,
    externalActionsPerformed: [],
    executionAuthorityEffect: "NONE"
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
} catch (error) {
  process.stderr.write(`chainlink-provider-profile.mjs: ${error instanceof Error ? error.message : String(error)}\n\n${usage}\n`);
  process.exitCode = 2;
}

function parseArguments(argv) {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`${usage}\n`);
    process.exit(0);
  }
  const command = argv[0];
  if (!new Set(["check", "init"]).has(command)) throw new Error(`unknown command ${command}`);
  let root = null;
  let profile = null;
  let output = null;
  let product = null;
  let chainId = null;
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (!new Set(["--root", "--profile", "--output", "--product", "--chain-id"]).has(token)) throw new Error(`unknown option ${token}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${token} requires a value`);
    if (token === "--root") {
      if (root !== null) throw new Error("--root may only be provided once");
      root = value;
    } else if (token === "--profile") {
      if (profile !== null) throw new Error("--profile may only be provided once");
      profile = value;
    } else if (token === "--output") {
      if (output !== null) throw new Error("--output may only be provided once");
      output = value;
    } else if (token === "--product") {
      if (product !== null) throw new Error("--product may only be provided once");
      product = value;
    } else {
      if (chainId !== null) throw new Error("--chain-id may only be provided once");
      chainId = value;
    }
    index += 1;
  }
  if (root === null) throw new Error("--root is required");
  if (command === "check") {
    if (profile === null) throw new Error("--profile is required");
    if (output !== null || product !== null || chainId !== null) throw new Error("check accepts only --root and --profile");
  } else {
    if (output === null) throw new Error("--output is required");
    if (product === null) throw new Error("--product is required");
    if (chainId === null) throw new Error("--chain-id is required");
    if (profile !== null) throw new Error("init uses --output, not --profile");
  }
  return { command, root, profile, output, product, chainId };
}

function initializeVrfPlanningExample({ repositoryRoot, output, product, chainId }) {
  if (product !== "vrf-v2-5") {
    const alias = new Set(["vrf", "chainlink-vrf", "chainlink-vrf-v2-5"]).has(product);
    throw new Error(alias
      ? "--product must use the exact profile product id vrf-v2-5"
      : "the planning initializer currently supports only --product vrf-v2-5");
  }
  const maximumChainId = (1n << 256n) - 1n;
  if (!/^[1-9][0-9]{0,77}$/u.test(chainId) || BigInt(chainId) > maximumChainId) {
    throw new Error("--chain-id must be one canonical positive uint256 decimal string");
  }
  const target = path.isAbsolute(output) ? path.resolve(output) : path.resolve(repositoryRoot, output);
  const relativeTarget = path.relative(repositoryRoot, target);
  if (relativeTarget === "" || relativeTarget.startsWith(`..${path.sep}`) || path.isAbsolute(relativeTarget)) {
    throw new Error("--output must name a new directory inside --root");
  }
  if (fs.existsSync(target)) throw new Error("--output already exists");
  const parent = fs.realpathSync(path.dirname(target));
  const relativeParent = path.relative(repositoryRoot, parent);
  if (relativeParent.startsWith(`..${path.sep}`) || path.isAbsolute(relativeParent)) {
    throw new Error("--output parent must stay inside --root");
  }

  const plan = composeTemplate({
    catalog: loadTemplateCatalog({ skillRoot: path.resolve(scriptDirectory, "..") }),
    starterId: "ordinary-launch",
    capabilityIds: chainlinkProductCapabilities("vrf-v2-5")
  });
  const files = new Map();
  files.set("source/PlannedVrfConsumer.sol", Buffer.from([
    "// SPDX-License-Identifier: MIT",
    "pragma solidity ^0.8.26;",
    "",
    "// Planning-only placeholder. It is not a VRF implementation or deployment artifact.",
    "abstract contract PlannedVrfConsumer {}",
    ""
  ].join("\n"), "utf8"));
  files.set("programmable-template.json", jsonBytes(plan));
  files.set("evidence/profile-review.json", jsonBytes({
    schemaVersion: "1.0.0",
    kind: "chainlink-planning-example",
    product: "vrf-v2-5",
    claim: "Structural planning example only; no implementation, deployment, provider availability, audit or approval is claimed."
  }));
  files.set("evidence/vrf-design.json", jsonBytes({
    schemaVersion: "1.0.0",
    kind: "chainlink-vrf-planning-design",
    product: "vrf-v2-5",
    targetChainId: chainId,
    unresolvedBeforeImplementation: [
      "coordinator and key hash",
      "payment and funding configuration",
      "consumer source and deployment",
      "request lifecycle tests and runtime evidence"
    ]
  }));
  const profileValue = createVrfPlanningProfile({ chainId, files });
  const structuralFindings = [
    ...validateAgainstSchema(profileValue, schema),
    ...validateChainlinkProviderProfileV1(profileValue)
  ];
  if (structuralFindings.length > 0) throw new Error("internal VRF planning example is not structurally valid");
  files.set("profile.json", jsonBytes(profileValue));

  const temporary = fs.mkdtempSync(path.join(parent, ".chainlink-profile-init-"));
  try {
    for (const [relativePath, bytes] of files) {
      const destination = path.join(temporary, relativePath);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, bytes, { flag: "wx", mode: 0o644 });
    }
    fs.renameSync(temporary, target);
  } catch (error) {
    fs.rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
  return {
    schemaVersion: "1.0.0",
    ok: true,
    status: "CHAINLINK_VRF_PLANNING_EXAMPLE_CREATED",
    product: "vrf-v2-5",
    targetChainId: chainId,
    output: relativeTarget.replaceAll("\\", "/"),
    filesCreated: [...files.keys()].sort(),
    validationCommand: `node $SKILL_ROOT/scripts/chainlink-provider-profile.mjs check --root ${relativeTarget.replaceAll("\\", "/")} --profile profile.json`,
    planningOnly: true,
    deploymentOrRuntimeVerified: false,
    networkAccessed: false,
    externalActionsPerformed: [],
    executionAuthorityEffect: "NONE"
  };
}

function createVrfPlanningProfile({ chainId, files }) {
  const binding = (artifactPath, kind) => ({
    path: artifactPath,
    sha256: `sha256:${crypto.createHash("sha256").update(files.get(artifactPath)).digest("hex")}`,
    kind
  });
  return {
    schemaVersion: "1.0.0",
    kind: "programmable-chainlink-provider-profile",
    profileId: "chainlink-vrf-v2-5-planning-example",
    subject: binding("source/PlannedVrfConsumer.sol", "source"),
    projectPlan: binding("programmable-template.json", "config"),
    runtimeCoverage: { executionFamily: "evm", scope: "EVM_ONLY" },
    targetChainIds: [chainId],
    sourceReceipt: {
      path: "references/provider-knowledge-source-receipt-2026-08-13.json",
      sha256: CHAINLINK_KNOWLEDGE_RECEIPT_SHA256_V1
    },
    authorityBoundary: {
      executionAuthorityEffect: "NONE",
      validationNetworkAccess: "forbidden",
      secrets: "backend-only",
      automaticDeployment: false,
      automaticApproval: false
    },
    sourceCoverage: {
      automation: "not-covered-by-reviewed-source",
      functions: "not-covered-by-reviewed-source",
      confidentialAi: "excluded-alpha",
      ace: "excluded-separate-legal-license-security-review",
      nonEvm: "out-of-scope"
    },
    productionInvariants: {
      liveness: {
        disposition: "requirements-declared",
        callerBinding: "required",
        authorizationBinding: "required",
        gasPayerBinding: "required",
        fundingAndIncentiveBinding: "required",
        deadlineBinding: "required",
        workBound: "required",
        retryIdempotency: "required",
        stuckExitBinding: "required"
      },
      accountExecution: {
        disposition: "requirements-declared",
        supportedModels: ["eip7702", "eoa", "erc1271", "erc4337", "relayer-session-key"],
        nonceBinding: "required",
        deadlineBinding: "required",
        domainBinding: "required",
        replayPolicy: "must-reject",
        codeLengthAssumptionPolicy: "forbidden",
        mutableSignatureValidityPolicy: "must-handle",
        persistentDelegationPolicy: "must-handle"
      },
      indexerRpc: {
        disposition: "requirements-declared",
        runtimeHashBinding: "required",
        abiAndTopicBinding: "required",
        startBlockHashBinding: "required",
        blockTagBinding: "required",
        logChunkBound: "required",
        removedLogPolicy: "must-handle",
        deterministicReplayRequirement: "required",
        providerDisagreementPolicy: "fail-closed",
        freshnessBinding: "required"
      },
      chainCapability: {
        disposition: "requirements-declared",
        inclusionFinalityWithdrawalSeparation: "required",
        feeAndTimeSemanticsBinding: "required",
        sequencerPolicyRequirement: "bind-or-prove-not-applicable",
        opcodePrecompileCompilerBinding: "required",
        bridgeReplayDomainBinding: "required",
        deterministicAddressAssumptionPolicy: "forbidden"
      },
      futureProtocol: {
        disposition: "requirements-declared",
        forkInclusionEvidence: "required",
        executionSpecCommitBinding: "required",
        targetRuntimeProof: "required",
        fallbackOrMigrationBinding: "required"
      }
    },
    integrations: [{
      id: "vrf-v2-5",
      status: "planned",
      genericCapabilities: ["randomness"],
      executionOperations: ["async-callback-outside-hook"],
      deployments: [],
      properties: {
        chainId,
        paymentMode: "subscription",
        coordinatorKeyHash: `0x${"0".repeat(63)}1`,
        subscriptionId: "1",
        minimumRequestConfirmations: "3",
        callbackGasLimit: "500000",
        numWords: "1",
        coordinatorMaximumNumWords: "500",
        fundingAsset: "native",
        requestIdentityBinding: "required",
        frozenInputBinding: "required",
        replacementRerollPolicy: "forbidden",
        callbackRevertPolicy: "forbidden",
        callbackWorkPolicy: "minimal-store-only",
        duplicateFulfillmentPolicy: "idempotent-ignore",
        unknownRequestPolicy: "record-and-return",
        timeoutPolicy: "cancel-or-refund-without-reroll",
        outOfOrderFulfillmentTestRequirement: "required",
        storageBoundRequirement: "required"
      },
      evidence: [binding("evidence/vrf-design.json", "review")]
    }],
    evidence: [binding("evidence/profile-review.json", "review")]
  };
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function resolveProfile(repositoryRoot, requested) {
  const target = path.isAbsolute(requested) ? path.resolve(requested) : path.resolve(repositoryRoot, requested);
  const relative = path.relative(repositoryRoot, target);
  if (relative === "" || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("--profile must stay inside --root");
  const stat = fs.lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("--profile must be one regular non-symbolic-link file");
  if (stat.size < 2 || stat.size > maximumProfileBytes) throw new Error(`--profile must contain 2..${maximumProfileBytes} bytes`);
  const real = fs.realpathSync(target);
  const realRelative = path.relative(repositoryRoot, real);
  if (realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) throw new Error("--profile may not escape --root through an ancestor link");
  return real;
}

function profileIdentityFindings(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return [{
      code: "CHAINLINK_PROFILE_ROOT_INVALID",
      path: "$",
      message: "profile root must be one JSON object"
    }];
  }
  if (value.schemaVersion !== "1.0.0" || value.kind !== "programmable-chainlink-provider-profile") {
    return [{
      code: "CHAINLINK_PROFILE_IDENTITY_INVALID",
      path: "$",
      message: "expected schemaVersion 1.0.0 and kind programmable-chainlink-provider-profile; initialize or select the Chainlink profile, not another JSON artifact"
    }];
  }
  return [];
}

function verifyInstalledReceipt(binding) {
  const target = path.resolve(scriptDirectory, "..", binding.path);
  try {
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > maximumProfileBytes) throw new Error("receipt is not one bounded regular file");
    const actual = `sha256:${crypto.createHash("sha256").update(fs.readFileSync(target)).digest("hex")}`;
    if (actual !== binding.sha256) throw new Error(`receipt digest mismatch: expected ${binding.sha256}, got ${actual}`);
    return [];
  } catch (error) {
    return [{ code: "CHAINLINK_SOURCE_RECEIPT_INVALID", path: "$.sourceReceipt", message: error.message }];
  }
}

function verifyCandidateArtifacts(repositoryRoot, bindings) {
  const findings = [];
  const byPath = new Map();
  for (const binding of bindings) {
    const previous = byPath.get(binding.path);
    if (previous && (previous.sha256 !== binding.sha256 || previous.kind !== binding.kind)) {
      findings.push({ code: "CHAINLINK_ARTIFACT_BINDING_CONFLICT", path: binding.path, message: "the same artifact path has conflicting bindings" });
      continue;
    }
    byPath.set(binding.path, binding);
  }
  if (byPath.size > maximumArtifactCount) {
    return [{ code: "CHAINLINK_ARTIFACT_BUDGET_EXCEEDED", path: "$.evidence", message: `artifact bindings exceed ${maximumArtifactCount} unique files` }];
  }
  const resolved = [];
  let aggregateBytes = 0;
  for (const binding of byPath.values()) {
    try {
      const target = resolveCandidateArtifact(repositoryRoot, binding.path);
      const size = fs.statSync(target).size;
      aggregateBytes += size;
      resolved.push({ binding, target });
    } catch (error) {
      findings.push({ code: "CHAINLINK_ARTIFACT_BINDING_INVALID", path: binding.path, message: error.message });
    }
  }
  if (aggregateBytes > maximumAggregateArtifactBytes) {
    findings.push({ code: "CHAINLINK_ARTIFACT_BUDGET_EXCEEDED", path: "$.evidence", message: `aggregate artifact bytes exceed ${maximumAggregateArtifactBytes}` });
    return findings;
  }
  for (const { binding, target } of resolved) {
    try {
      const actual = `sha256:${crypto.createHash("sha256").update(fs.readFileSync(target)).digest("hex")}`;
      if (actual !== binding.sha256) throw new Error(`digest mismatch: expected ${binding.sha256}, got ${actual}`);
    } catch (error) {
      findings.push({ code: "CHAINLINK_ARTIFACT_BINDING_INVALID", path: binding.path, message: error.message });
    }
  }
  return findings;
}

function verifyProjectPlan(repositoryRoot, value) {
  try {
    const target = resolveCandidateArtifact(repositoryRoot, value.projectPlan.path);
    const plan = parseBoundedStrictJsonBytes(fs.readFileSync(target), { maxSourceBytes: maximumProfileBytes * 2 });
    const selection = plan?.selection;
    const recomposed = composeTemplate({
      catalog: loadTemplateCatalog({ skillRoot: path.resolve(scriptDirectory, "..") }),
      starterId: selection?.starterId,
      packIds: selection?.requestedPackIds,
      capabilityIds: selection?.requestedCapabilityIds ?? [],
      customCapabilities: Array.isArray(plan?.customCapabilities) ? plan.customCapabilities.map(({ id, label }) => ({ id, label })) : [],
      localTags: plan?.tagSuggestions?.ownerProvidedLocalTags
    });
    if (canonicalJson(recomposed) !== canonicalJson(plan)) throw new Error("project plan does not equal its deterministic catalog recomposition");
    const plannedCapabilities = new Set([
      ...plan.machineCapabilities.knownCapabilityIds,
      ...plan.machineCapabilities.ownerDefinedCapabilityIds
    ]);
    if (!plannedCapabilities.has("chainlink-provider")) throw new Error("project plan must select the exact Chainlink provider capability");
    const expectedProductCapabilityIds = value.integrations
      .map(({ id }) => chainlinkProductCapabilityByIntegration[id])
      .sort();
    const selectedProductCapabilityIds = [...plannedCapabilities]
      .filter((id) => Object.values(chainlinkProductCapabilityByIntegration).includes(id))
      .sort();
    if (canonicalJson(selectedProductCapabilityIds) !== canonicalJson(expectedProductCapabilityIds)) {
      throw new Error(`project plan must select exactly the profile products: ${expectedProductCapabilityIds.join(", ")}`);
    }
    for (const capability of requiredChainlinkGenericCapabilitiesV1(value)) {
      if (!plannedCapabilities.has(capability)) throw new Error(`project plan is missing required generic capability ${capability}`);
    }
    return [];
  } catch (error) {
    return [{ code: "CHAINLINK_PROJECT_PLAN_INVALID", path: "$.projectPlan", message: error.message }];
  }
}

function resolveCandidateArtifact(repositoryRoot, requested) {
  const target = path.resolve(repositoryRoot, requested);
  const relative = path.relative(repositoryRoot, target);
  if (relative === "" || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("artifact must stay inside candidate root");
  const stat = fs.lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("artifact must be one regular non-symbolic-link file");
  if (stat.size < 1 || stat.size > maximumArtifactBytes) throw new Error(`artifact must contain 1..${maximumArtifactBytes} bytes`);
  const real = fs.realpathSync(target);
  const realRelative = path.relative(repositoryRoot, real);
  if (realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) throw new Error("artifact may not escape candidate root through an ancestor link");
  return real;
}
