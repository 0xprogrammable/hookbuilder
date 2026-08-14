import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { loadKnowledgeRouting } from "./knowledge-router-core.mjs";
import { compareUtf8, KnowledgeRouterError, MAX_TEMPLATE_PLAN_BYTES } from "./knowledge-router-support-core.mjs";
import { canonicalJson } from "./template-catalog-core.mjs";
import { parseBoundedStrictJsonBytes } from "./strict-json-core.mjs";

const digestPattern = /^[a-f0-9]{64}$/u;
const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const maximumBriefBytes = 2_500;

export function activateConfirmedKnowledge({
  basePlan,
  routedPlan,
  baseProfileDigest,
  explicitCapabilities,
  explicitSurfaces,
  skillRoot
}) {
  const capabilities = normalizeConfirmedIds(explicitCapabilities);
  const surfaces = normalizeConfirmedIds(explicitSurfaces);
  if (capabilities.length === 0 && surfaces.length === 0) {
    activationFailure(
      "KNOWLEDGE_ACTIVATION_INVALID",
      "--activate-confirmed requires at least one exact --capability or --surface selector."
    );
  }
  if (!digestPattern.test(baseProfileDigest ?? "") || baseProfileDigest !== basePlan.profileDigest) {
    activationFailure(
      "KNOWLEDGE_ACTIVATION_BASE_MISMATCH",
      "--base-profile-digest must equal the current mode-only context profile digest."
    );
  }

  const activation = loadActivationContract(skillRoot);
  const quarantined = new Set(activation.contract.quarantinedReferences.map(toReferencePath));
  const routedLater = routedPlan.loadLater.filter(({ reasons, path: reference }) => (
    Array.isArray(reasons) && reasons.length > 0 && !quarantined.has(reference)
  ));
  const matchingRule = activation.contract.rules
    .filter((rule) => (
      rule.capabilityAny.some((id) => capabilities.includes(id))
      && rule.surfaceAny.some((id) => surfaces.includes(id))
    ))
    .sort(comparePriority)[0] ?? null;

  const orderedCandidates = routedLater
    .map((reference) => enrichReference(reference, skillRoot, activation.priorityByPath))
    .sort(compareReferencePriority);
  const selected = matchingRule === null
    ? orderedCandidates[0]
    : descriptorForRule(matchingRule, skillRoot);
  if (selected === undefined) {
    activationFailure(
      "KNOWLEDGE_ACTIVATION_INVALID",
      "No specialist reference applies to the exact confirmed selector."
    );
  }

  const loadLater = orderedCandidates
    .filter(({ path: reference }) => reference !== selected.path)
    .map(stripPriority);
  const deferredCatalog = orderedDeferredCatalog(routedPlan, skillRoot);
  const selectionPreimage = {
    schemaVersion: "1.0.0",
    mode: routedPlan.mode,
    baseProfileDigest,
    routedProfileDigest: routedPlan.profileDigest,
    capabilities,
    surfaces
  };
  const selectionDigest = domainHash("programmable.knowledge-activation-selection.v1", selectionPreimage);
  const profilePreimage = {
    schemaVersion: "1.0.0",
    baseProfileDigest,
    routedProfileDigest: routedPlan.profileDigest,
    selectionDigest,
    activationContractSha256: activation.sha256,
    selected: stripPriority(selected),
    loadLater,
    deferredCatalog,
    reviewRoute: routedPlan.reviewRoute,
    unknownCapabilities: routedPlan.unknownCapabilities,
    unknownSurfaces: routedPlan.unknownSurfaces
  };

  return {
    schemaVersion: "1.0.0",
    kind: "programmable-knowledge-activation",
    mode: routedPlan.mode,
    baseProfileDigest,
    routedProfileDigest: routedPlan.profileDigest,
    selectionDigest,
    packs: routedPlan.packs,
    capabilities: routedPlan.capabilities,
    surfaces: routedPlan.surfaces,
    registryProjects: routedPlan.registryProjects,
    unknownCapabilities: routedPlan.unknownCapabilities,
    unknownSurfaces: routedPlan.unknownSurfaces,
    reviewRoute: routedPlan.reviewRoute,
    ideaEligibility: "ELIGIBLE_FOR_REVIEW",
    designEligible: true,
    automaticAdverseDecision: false,
    loadNow: [stripPriority(selected)],
    loadLater,
    deferredCatalog,
    knowledgeActivation: {
      path: "references/knowledge-activation-v1.json",
      sha256: activation.sha256,
      ruleId: matchingRule?.id ?? "ordered-applicable-reference",
      selectionSemantics: activation.contract.selectionSemantics,
      maximumLoadNow: activation.contract.maximumLoadNow
    },
    profileDigest: domainHash("programmable.knowledge-activation-profile.v1", profilePreimage),
    cumulativeEstimatedTokenTarget: activation.contract.cumulativeEstimatedTokenTarget,
    networkAccessed: false
  };
}

export function renderContextBrief(result, { basePlan = null } = {}) {
  if (result.kind === "programmable-knowledge-activation") {
    if (basePlan === null) throw new Error("activated context brief requires the bound base plan");
    return renderActivated(result, basePlan, true);
  }
  return renderInitialBrief(result);
}

export function renderActivatedContext(result, { basePlan }) {
  return renderActivated(result, basePlan, false);
}

function renderInitialBrief(result) {
  return fixedPointEnvelope((routerOutputBytes) => {
    const routerOutputEstimatedTokens = Math.ceil(routerOutputBytes / 4);
    const totalBytes = result.contextBudget.contentBytes + routerOutputBytes;
    const estimatedTokens = result.contextBudget.contentEstimatedTokens + routerOutputEstimatedTokens;
    return briefResult(result, {
      phase: "initial-profile",
      contentBytes: result.contextBudget.contentBytes,
      contentEstimatedTokens: result.contextBudget.contentEstimatedTokens,
      routerOutput: {
        bytes: routerOutputBytes,
        estimatedTokens: routerOutputEstimatedTokens,
        measurement: "canonical-context-brief-envelope-v1"
      },
      totalBytes,
      estimatedTokens,
      targetEstimatedTokens: result.contextBudget.targetInitialTokens,
      status: estimatedTokens <= result.contextBudget.targetInitialTokens ? "within-target" : "expanded-required-context",
      estimation: result.contextBudget.estimation
    });
  }, { enforceBriefLimit: true });
}

function renderActivated(result, basePlan, brief) {
  const baseBriefBytes = Buffer.byteLength(renderInitialBrief(basePlan));
  const selectedReferenceBytes = result.loadNow.reduce((total, reference) => total + reference.bytes, 0);
  const selectedReferenceEstimatedTokens = result.loadNow.reduce((total, reference) => total + reference.estimatedTokens, 0);
  return fixedPointEnvelope((routerOutputBytes) => {
    const baseBriefEstimatedTokens = Math.ceil(baseBriefBytes / 4);
    const routerOutputEstimatedTokens = Math.ceil(routerOutputBytes / 4);
    const cumulativeBytes = basePlan.contextBudget.contentBytes
      + baseBriefBytes
      + selectedReferenceBytes
      + routerOutputBytes;
    const cumulativeEstimatedTokens = basePlan.contextBudget.contentEstimatedTokens
      + baseBriefEstimatedTokens
      + selectedReferenceEstimatedTokens
      + routerOutputEstimatedTokens;
    const contextBudget = {
      phase: "confirmed-activation-delta",
      base: {
        contentBytes: basePlan.contextBudget.contentBytes,
        briefOutputBytes: baseBriefBytes,
        estimatedTokens: basePlan.contextBudget.contentEstimatedTokens + baseBriefEstimatedTokens
      },
      activation: {
        referenceBytes: selectedReferenceBytes,
        outputBytes: routerOutputBytes,
        estimatedTokens: selectedReferenceEstimatedTokens + routerOutputEstimatedTokens
      },
      cumulativeBytes,
      cumulativeEstimatedTokens,
      targetEstimatedTokens: result.cumulativeEstimatedTokenTarget,
      status: cumulativeEstimatedTokens < result.cumulativeEstimatedTokenTarget
        ? "within-cumulative-target"
        : "cumulative-target-exceeded",
      estimation: "ceil-utf8-bytes-divided-by-four"
    };
    return brief ? briefResult(result, contextBudget) : { ...result, contextBudget };
  }, { enforceBriefLimit: brief });
}

function briefResult(result, contextBudget) {
  const routedLater = result.kind === "programmable-knowledge-activation"
    ? result.loadLater
    : result.loadLater.filter(({ reasons }) => Array.isArray(reasons) && reasons.length > 0);
  const deferredCatalog = result.kind === "programmable-knowledge-activation"
    ? result.deferredCatalog
    : result.loadLater.filter(({ reasons }) => !Array.isArray(reasons) || reasons.length === 0);
  return {
    schemaVersion: "1.0.0",
    kind: result.kind,
    mode: result.mode,
    selectors: {
      packs: compactIds(result.packs),
      capabilities: compactIds(result.capabilities),
      surfaces: compactIds(result.surfaces),
      registryProjects: compactIds(result.registryProjects.map(({ id }) => id))
    },
    unknowns: {
      capabilities: compactIds(result.unknownCapabilities),
      surfaces: compactIds(result.unknownSurfaces)
    },
    ...(result.status === undefined ? {} : {
      hold: {
        code: result.code,
        status: result.status,
        ideaEligibility: result.ideaEligibility,
        designEligible: result.designEligible,
        automaticAdverseDecision: result.automaticAdverseDecision,
        automaticMaterialization: result.automaticMaterialization
      }
    }),
    reviewRoute: result.reviewRoute,
    ...(result.baseProfileDigest === undefined ? {} : {
      baseProfileDigest: result.baseProfileDigest,
      selectionDigest: result.selectionDigest,
      ideaEligibility: result.ideaEligibility,
      automaticAdverseDecision: result.automaticAdverseDecision
    }),
    profileDigest: result.profileDigest,
    loadNow: result.loadNow.map(compactLoadNow),
    routedLater: compactReferenceInventory(routedLater),
    deferredCatalog: compactReferenceInventory(deferredCatalog),
    contextBudget,
    fullOutputInstruction: "Repeat the same context command without --brief for the complete deterministic plan."
  };
}

function fixedPointEnvelope(buildResult, { enforceBriefLimit }) {
  let outputBytes = 0;
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const envelope = {
      schemaVersion: "1.0.0",
      ok: true,
      command: "context",
      result: buildResult(outputBytes)
    };
    const serialized = `${canonicalJson(envelope)}\n`;
    const measured = Buffer.byteLength(serialized);
    if (measured === outputBytes) {
      if (enforceBriefLimit && measured >= maximumBriefBytes) {
        throw new KnowledgeRouterError(
          "KNOWLEDGE_BRIEF_BUDGET_EXCEEDED",
          `The bounded context brief exceeded ${maximumBriefBytes - 1} bytes.`
        );
      }
      return serialized;
    }
    outputBytes = measured;
  }
  throw new KnowledgeRouterError("KNOWLEDGE_BUDGET_MEASUREMENT_FAILED", "Context brief size did not reach a fixed point.");
}

function compactIds(values) {
  if (values.length <= 8) return { count: values.length, ids: values };
  const ids = values.slice(0, 4);
  return {
    count: values.length,
    ids,
    omitted: values.length - ids.length,
    sha256: hashJson(values)
  };
}

function compactLoadNow(reference) {
  return {
    path: reference.path,
    sha256: reference.sha256,
    bytes: reference.bytes,
    reasons: compactReasons(reference.reasons)
  };
}

function compactReasons(reasons) {
  const byteLength = Buffer.byteLength(canonicalJson(reasons));
  if (reasons.length <= 8 && byteLength <= 512) return reasons;
  const preview = reasons.slice(0, 2);
  return {
    count: reasons.length,
    values: preview,
    omitted: reasons.length - preview.length,
    sha256: hashJson(reasons)
  };
}

function compactReferenceInventory(references) {
  const paths = references.map(({ path: reference }) => reference);
  if (paths.length <= 5) return { count: paths.length, paths };
  const preview = paths.length <= 5 ? paths : paths.slice(0, 3);
  return {
    count: paths.length,
    paths: preview,
    omitted: paths.length - preview.length,
    sha256: hashJson(references)
  };
}

function loadActivationContract(skillRoot) {
  const target = path.join(skillRoot, "references", "knowledge-activation-v1.json");
  let source;
  let contract;
  try {
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > MAX_TEMPLATE_PLAN_BYTES) {
      throw new Error("activation contract is not one bounded regular file");
    }
    source = fs.readFileSync(target);
    contract = parseBoundedStrictJsonBytes(source, { maxSourceBytes: MAX_TEMPLATE_PLAN_BYTES });
  } catch (error) {
    throw new KnowledgeRouterError("KNOWLEDGE_ACTIVATION_UNAVAILABLE", `Cannot load activation contract: ${error.message}`);
  }
  validateActivationContract(contract, skillRoot);
  const priorityByPath = new Map(contract.ordering.map((entry) => [toReferencePath(entry.path), entry]));
  return {
    contract,
    priorityByPath,
    sha256: crypto.createHash("sha256").update(source).digest("hex")
  };
}

function validateActivationContract(contract, skillRoot) {
  if (
    contract?.schemaVersion !== "1.0.0"
    || contract?.kind !== "programmable-knowledge-activation"
    || contract?.selectionSemantics !== "confirmed-selector-delta-one-reference"
    || contract?.maximumLoadNow !== 1
    || contract?.cumulativeEstimatedTokenTarget !== 8000
    || !Array.isArray(contract.rules)
    || contract.rules.length < 1
    || !Array.isArray(contract.ordering)
    || contract.ordering.length < 1
    || !Array.isArray(contract.quarantinedReferences)
    || !contract.quarantinedReferences.includes("programmable-fee-policy-v2.md")
  ) activationContractFailure("Activation contract identity or policy is invalid.");

  const identities = new Set();
  const references = new Set(contract.quarantinedReferences);
  for (const rule of contract.rules) {
    if (
      !exactKeys(rule, ["capabilityAny", "id", "order", "reason", "reference", "stage", "surfaceAny"])
      || !idPattern.test(rule.id ?? "")
      || identities.has(rule.id)
      || !validPriority(rule)
      || !validIds(rule.capabilityAny)
      || !validIds(rule.surfaceAny)
      || rule.capabilityAny.length < 1
      || rule.surfaceAny.length < 1
      || typeof rule.reference !== "string"
      || typeof rule.reason !== "string"
      || rule.reason.length < 24
      || rule.reason.length > 300
    ) activationContractFailure("Activation rule is invalid.");
    identities.add(rule.id);
    references.add(rule.reference);
  }
  const orderedPaths = new Set();
  for (const entry of contract.ordering) {
    if (
      !exactKeys(entry, ["order", "path", "stage"])
      || !validPriority(entry)
      || typeof entry.path !== "string"
      || orderedPaths.has(entry.path)
    ) activationContractFailure("Activation ordering is invalid.");
    orderedPaths.add(entry.path);
    references.add(entry.path);
  }
  for (const reference of references) requireReferenceFile(skillRoot, reference);
}

function orderedDeferredCatalog(routedPlan, skillRoot) {
  const modeLater = loadKnowledgeRouting({ skillRoot }).modes[routedPlan.mode].later;
  const priority = new Map(modeLater.map(({ reference }, index) => [toReferencePath(reference), index]));
  return routedPlan.loadLater
    .filter(({ reasons }) => !Array.isArray(reasons) || reasons.length === 0)
    .sort((left, right) => (
      (priority.get(left.path) ?? Number.MAX_SAFE_INTEGER) - (priority.get(right.path) ?? Number.MAX_SAFE_INTEGER)
      || compareUtf8(left.path, right.path)
    ));
}

function descriptorForRule(rule, skillRoot) {
  const descriptor = referenceDescriptor(rule.reference, skillRoot);
  return {
    ...descriptor,
    reasons: [`activation-rule:${rule.id}`, ...rule.capabilityAny.map((id) => `capability:${id}`), ...rule.surfaceAny.map((id) => `surface:${id}`)].sort(compareUtf8),
    stage: rule.stage,
    order: rule.order
  };
}

function enrichReference(reference, skillRoot, priorityByPath) {
  const descriptor = referenceDescriptor(reference.path, skillRoot);
  const priority = priorityByPath.get(reference.path) ?? { stage: 9_999, order: 9_999 };
  return {
    ...reference,
    ...descriptor,
    stage: priority.stage,
    order: priority.order
  };
}

function referenceDescriptor(reference, skillRoot) {
  const relative = reference.startsWith("references/") ? reference.slice("references/".length) : reference;
  const contents = requireReferenceFile(skillRoot, relative);
  return {
    path: toReferencePath(relative),
    bytes: contents.length,
    estimatedTokens: Math.ceil(contents.length / 4),
    sha256: crypto.createHash("sha256").update(contents).digest("hex")
  };
}

function requireReferenceFile(skillRoot, reference) {
  if (!/^[a-z0-9]+(?:[-.][a-z0-9]+)*\.(?:md|json)$/u.test(reference)) {
    activationContractFailure(`Unsafe activation reference: ${String(reference)}.`);
  }
  const target = path.join(skillRoot, "references", reference);
  try {
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink() || fs.realpathSync(target) !== target) throw new Error("not a real file");
    return fs.readFileSync(target);
  } catch {
    activationContractFailure(`Activation reference is unavailable: ${reference}.`);
  }
}

function stripPriority({ stage: _stage, order: _order, ...reference }) {
  return reference;
}

function compareReferencePriority(left, right) {
  return left.stage - right.stage || left.order - right.order || compareUtf8(left.path, right.path);
}

function comparePriority(left, right) {
  return left.stage - right.stage || left.order - right.order || compareUtf8(left.id, right.id);
}

function validPriority(value) {
  return Number.isSafeInteger(value.stage) && value.stage > 0
    && Number.isSafeInteger(value.order) && value.order > 0;
}

function validIds(values) {
  return Array.isArray(values) && values.every((value) => typeof value === "string" && idPattern.test(value));
}

function exactKeys(value, expected) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && canonicalJson(Object.keys(value).sort(compareUtf8)) === canonicalJson([...expected].sort(compareUtf8));
}

function normalizeConfirmedIds(values) {
  return [...new Set(values)].sort(compareUtf8);
}

function toReferencePath(reference) {
  return reference.startsWith("references/") ? reference : `references/${reference}`;
}

function domainHash(domain, value) {
  return crypto.createHash("sha256")
    .update(Buffer.from(domain, "utf8"))
    .update(Buffer.from([0]))
    .update(Buffer.from(canonicalJson(value), "utf8"))
    .digest("hex");
}

function hashJson(value) {
  return crypto.createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function activationFailure(code, message) {
  throw new KnowledgeRouterError(code, message, {
    ideaEligibility: "ELIGIBLE_FOR_REVIEW",
    automaticAdverseDecision: false
  });
}

function activationContractFailure(message) {
  throw new KnowledgeRouterError("KNOWLEDGE_ACTIVATION_INVALID", message);
}
