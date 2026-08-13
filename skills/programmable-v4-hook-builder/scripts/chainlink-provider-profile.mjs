#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { validateAgainstSchema } from "./restricted-json-schema-core.mjs";
import { parseBoundedStrictJsonBytes } from "./strict-json-core.mjs";
import { composeTemplate } from "./template-catalog-composition.mjs";
import { loadTemplateCatalog } from "./template-catalog-loader.mjs";
import { canonicalJson } from "./template-catalog-shared.mjs";
import {
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
const usage = [
  "Usage: chainlink-provider-profile.mjs check --root <candidate-root> --profile <profile.json>",
  "",
  "Validate one exact Chainlink provider profile offline.",
  "A valid profile is structural candidate evidence only; it is not an audit, deployment proof, provider-availability proof, transaction authorization or launch approval."
].join("\n");

try {
  const { command, root, profile } = parseArguments(process.argv.slice(2));
  if (command !== "check") throw new Error(`unknown command ${command}`);
  const repositoryRoot = fs.realpathSync(path.resolve(root));
  const profilePath = resolveProfile(repositoryRoot, profile);
  const source = fs.readFileSync(profilePath);
  const value = parseBoundedStrictJsonBytes(source, { maxSourceBytes: maximumProfileBytes });
  const schemaFindings = validateAgainstSchema(value, schema).map((finding) => ({
    code: `SCHEMA_${finding.code}`,
    path: finding.path,
    message: finding.message
  }));
  const semanticFindings = validateChainlinkProviderProfileV1(value).map((message) => ({
    code: "CHAINLINK_PROFILE_SEMANTIC_INVALID",
    path: message.split(":", 1)[0],
    message
  }));
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
  let root = null;
  let profile = null;
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (token !== "--root" && token !== "--profile") throw new Error(`unknown option ${token}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${token} requires a value`);
    if (token === "--root") {
      if (root !== null) throw new Error("--root may only be provided once");
      root = value;
    } else {
      if (profile !== null) throw new Error("--profile may only be provided once");
      profile = value;
    }
    index += 1;
  }
  if (root === null) throw new Error("--root is required");
  if (profile === null) throw new Error("--profile is required");
  return { command, root, profile };
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
    if (!selection.selectedPackIds.includes("chainlink-provider")) throw new Error("project plan must select the chainlink-provider pack");
    const plannedCapabilities = new Set([
      ...plan.machineCapabilities.knownCapabilityIds,
      ...plan.machineCapabilities.ownerDefinedCapabilityIds
    ]);
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
