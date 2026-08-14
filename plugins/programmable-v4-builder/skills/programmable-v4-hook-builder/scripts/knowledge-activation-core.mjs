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
  if (routedPlan.status === "HOLD_SPLIT_REVIEW") return routedPlan;

  const activation = loadActivationContract(skillRoot);
  const quarantined = new Set(activation.contract.quarantinedReferences.map(toReferencePath));
  const basePaths = new Set(basePlan.loadNow.map(({ path: reference }) => reference));
  const routedLater = routedPlan.loadLater.filter(({ reasons, path: reference }) => (
    Array.isArray(reasons) && reasons.length > 0
      && !quarantined.has(reference)
      && !basePaths.has(reference)
  ));
  const orderedCandidates = routedLater
    .map((reference) => enrichReference(reference, skillRoot, activation.priorityByPath))
    .sort(compareReferencePriority);
  const capabilityRouteCandidates = descriptorsForMatchedRoutes({
    activation,
    routeKind: "capability",
    selectorIds: capabilities,
    skillRoot
  });
  const surfaceRouteCandidates = descriptorsForMatchedRoutes({
    activation,
    routeKind: "surface",
    selectorIds: surfaces,
    skillRoot
  });
  const capabilityPaths = new Set(capabilityRouteCandidates.map(({ path: reference }) => reference));
  const contributingSurfaceCandidates = capabilityRouteCandidates.length === 0
    ? surfaceRouteCandidates
    : surfaceRouteCandidates.filter(({ path: reference }) => (
      !capabilityPaths.has(reference) && !basePaths.has(reference)
    ));
  const matchedRouteCandidates = mergeReferenceCandidates(
    capabilityRouteCandidates,
    contributingSurfaceCandidates
  );
  const reusedBaseCandidates = matchedRouteCandidates.filter(({ path: reference }) => basePaths.has(reference));
  const routeCandidates = matchedRouteCandidates.filter(({ path: reference }) => !basePaths.has(reference));
  const selected = selectWithinCumulativeBudget({
    basePlan,
    candidates: matchedRouteCandidates.length > 0 ? routeCandidates : orderedCandidates,
    maximumLoadNow: activation.contract.maximumLoadNow,
    targetEstimatedTokens: activation.contract.cumulativeEstimatedTokenTarget
  });
  const reusesEveryMatchedRoute = matchedRouteCandidates.length > 0
    && reusedBaseCandidates.length === matchedRouteCandidates.length;
  if (selected.length === 0 && !reusesEveryMatchedRoute) {
    activationFailure(
      "KNOWLEDGE_ACTIVATION_INVALID",
      "No specialist reference applies to the exact confirmed selector."
    );
  }

  const selectedPaths = new Set(selected.map(({ path: reference }) => reference));
  const loadLaterByPath = new Map();
  for (const candidate of [...routeCandidates, ...orderedCandidates]) {
    if (!basePaths.has(candidate.path) && !selectedPaths.has(candidate.path) && !loadLaterByPath.has(candidate.path)) {
      loadLaterByPath.set(candidate.path, candidate);
    }
  }
  const loadLater = [...loadLaterByPath.values()]
    .sort(compareReferencePriority)
    .map(stripPriority);
  const deferredCatalog = orderedDeferredCatalog(routedPlan, skillRoot);
  const reusedBasePaths = reusedBaseCandidates.map(({ path: reference }) => reference).sort(compareUtf8);
  const selectedRouteIds = matchedRouteCandidates.length === 0
    ? ["fallback:ordered-applicable-reference"]
    : [...new Set([...reusedBaseCandidates, ...selected].flatMap(({ routeIds = [] }) => routeIds))].sort(compareUtf8);
  const selectionPreimage = {
    schemaVersion: "1.0.0",
    mode: routedPlan.mode,
    baseProfileDigest,
    routedProfileDigest: routedPlan.profileDigest,
    capabilities,
    surfaces,
    routeIds: selectedRouteIds,
    reusedBasePaths
  };
  const selectionDigest = domainHash("programmable.knowledge-activation-selection.v1", selectionPreimage);
  const profilePreimage = {
    schemaVersion: "1.0.0",
    baseProfileDigest,
    routedProfileDigest: routedPlan.profileDigest,
    selectionDigest,
    activationContractSha256: activation.sha256,
    reusedBasePaths,
    selected: selected.map(stripPriority),
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
    loadNow: selected.map(stripPriority),
    loadLater,
    deferredCatalog,
    knowledgeActivation: {
      path: "references/knowledge-activation-v1.json",
      sha256: activation.sha256,
      routeIds: selectedRouteIds,
      ...(reusedBasePaths.length === 0 ? {} : { reusedBasePaths }),
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
  const unknowns = compactGroups({
    capabilities: result.unknownCapabilities,
    surfaces: result.unknownSurfaces
  });
  return {
    schemaVersion: "1.0.0",
    kind: result.kind,
    mode: result.mode,
    selectors: compactGroups({
      packs: result.packs,
      capabilities: result.capabilities,
      surfaces: result.surfaces,
      registryProjects: result.registryProjects.map(({ id }) => id)
    }),
    ...(Object.keys(unknowns).length === 0 ? {} : { unknowns }),
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
      automaticAdverseDecision: result.automaticAdverseDecision,
      knowledgeActivation: {
        path: result.knowledgeActivation.path,
        sha256: result.knowledgeActivation.sha256,
        routeIds: compactRouteIds(result.knowledgeActivation.routeIds),
        ...(result.knowledgeActivation.reusedBasePaths === undefined
          ? {}
          : { reusedBasePaths: result.knowledgeActivation.reusedBasePaths }),
        maximumLoadNow: result.knowledgeActivation.maximumLoadNow
      }
    }),
    profileDigest: result.profileDigest,
    loadNow: result.loadNow.map(compactLoadNow),
    routedLater: compactReferenceInventory(routedLater),
    deferredCatalog: compactReferenceInventory(deferredCatalog),
    contextBudget,
    fullOutputInstruction: "Rerun without --brief."
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

function compactRouteIds(values) {
  if (values.length <= 4) return values;
  return {
    count: values.length,
    sha256: hashJson(values)
  };
}

function compactGroups(groups) {
  return Object.fromEntries(Object.entries(groups)
    .filter(([, values]) => values.length > 0)
    .map(([name, values]) => [name, compactIds(values)]));
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
  const routing = loadKnowledgeRouting({ skillRoot });
  validateActivationContract(contract, skillRoot, routing);
  const priorityByPath = new Map(contract.ordering.map((entry) => [toReferencePath(entry.path), entry]));
  const routeSelectionsByKey = new Map(contract.routeSelections.map((entry) => [routeKey(entry.routeKind, entry.routeId), entry]));
  return {
    contract,
    priorityByPath,
    routeSelectionsByKey,
    routing,
    sha256: crypto.createHash("sha256").update(source).digest("hex")
  };
}

function validateActivationContract(contract, skillRoot, routing) {
  if (
    contract?.schemaVersion !== "1.1.0"
    || contract?.kind !== "programmable-knowledge-activation"
    || contract?.selectionSemantics !== "confirmed-route-specialists-up-to-two"
    || contract?.maximumLoadNow !== 2
    || contract?.cumulativeEstimatedTokenTarget !== 8000
    || !Array.isArray(contract.routeSelections)
    || contract.routeSelections.length < 1
    || !Array.isArray(contract.ordering)
    || contract.ordering.length < 1
    || !Array.isArray(contract.quarantinedReferences)
    || !contract.quarantinedReferences.includes("programmable-fee-policy-v2.md")
  ) activationContractFailure("Activation contract identity or policy is invalid.");

  const identities = new Set();
  const expectedRouteKeys = new Set([
    ...routing.capabilityRoutes.map(({ id }) => routeKey("capability", id)),
    ...routing.surfaceRoutes.map(({ id }) => routeKey("surface", id))
  ]);
  const coveredRouteKeys = new Set();
  const references = new Set(contract.quarantinedReferences);
  for (const selection of contract.routeSelections) {
    const selectionRouteKey = routeKey(selection?.routeKind, selection?.routeId);
    if (
      !exactKeys(selection, ["id", "order", "reason", "reference", "routeId", "routeKind", "stage"])
      || !idPattern.test(selection.id ?? "")
      || identities.has(selection.id)
      || !new Set(["capability", "surface"]).has(selection.routeKind)
      || !idPattern.test(selection.routeId ?? "")
      || !expectedRouteKeys.has(selectionRouteKey)
      || coveredRouteKeys.has(selectionRouteKey)
      || !validPriority(selection)
      || typeof selection.reference !== "string"
      || contract.quarantinedReferences.includes(selection.reference)
      || typeof selection.reason !== "string"
      || selection.reason.length < 24
      || selection.reason.length > 300
    ) activationContractFailure("Activation route selection is invalid.");
    identities.add(selection.id);
    coveredRouteKeys.add(selectionRouteKey);
    references.add(selection.reference);
  }
  if (coveredRouteKeys.size !== expectedRouteKeys.size) {
    activationContractFailure("Activation route coverage is incomplete.");
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

function descriptorsForMatchedRoutes({ activation, routeKind, selectorIds, skillRoot }) {
  const routes = routeKind === "capability"
    ? activation.routing.capabilityRoutes
    : activation.routing.surfaceRoutes;
  const byPath = new Map();
  for (const selectorId of selectorIds) {
    const matched = routes
      .filter(({ matches }) => matches.includes(selectorId))
      .map((route) => ({
        route,
        selection: activation.routeSelectionsByKey.get(routeKey(routeKind, route.id))
      }))
      .sort((left, right) => comparePriority(left.selection, right.selection));
    if (matched.length === 0) continue;
    const { route, selection } = matched[0];
    const routeId = routeKey(routeKind, route.id);
    if (selection === undefined) activationContractFailure(`Activation route selection is unavailable: ${routeId}.`);
    const descriptor = {
      ...referenceDescriptor(selection.reference, skillRoot),
      reasons: [
        `activation-route:${routeId}`,
        `${routeKind}:${selectorId}`
      ].sort(compareUtf8),
      routeIds: [routeId],
      stage: selection.stage,
      order: selection.order
    };
    const existing = byPath.get(descriptor.path);
    if (existing === undefined) {
      byPath.set(descriptor.path, descriptor);
      continue;
    }
    const primary = compareReferencePriority(descriptor, existing) < 0 ? descriptor : existing;
    byPath.set(descriptor.path, {
      ...primary,
      reasons: [...new Set([...existing.reasons, ...descriptor.reasons])].sort(compareUtf8),
      routeIds: [...new Set([...existing.routeIds, ...descriptor.routeIds])].sort(compareUtf8)
    });
  }
  return [...byPath.values()].sort(compareReferencePriority);
}

function mergeReferenceCandidates(...candidateGroups) {
  const byPath = new Map();
  for (const descriptor of candidateGroups.flat()) {
    const existing = byPath.get(descriptor.path);
    if (existing === undefined) {
      byPath.set(descriptor.path, descriptor);
      continue;
    }
    const primary = compareReferencePriority(descriptor, existing) < 0 ? descriptor : existing;
    byPath.set(descriptor.path, {
      ...primary,
      reasons: [...new Set([...existing.reasons, ...descriptor.reasons])].sort(compareUtf8),
      routeIds: [...new Set([...existing.routeIds, ...descriptor.routeIds])].sort(compareUtf8)
    });
  }
  return [...byPath.values()].sort(compareReferencePriority);
}

function selectWithinCumulativeBudget({ basePlan, candidates, maximumLoadNow, targetEstimatedTokens }) {
  const baseBriefBytes = Buffer.byteLength(renderInitialBrief(basePlan));
  const reservedOutputEstimatedTokens = Math.ceil((maximumBriefBytes - 1) / 4);
  let cumulativeEstimatedTokens = basePlan.contextBudget.contentEstimatedTokens
    + Math.ceil(baseBriefBytes / 4)
    + reservedOutputEstimatedTokens;
  const selected = [];
  for (const candidate of candidates) {
    if (selected.length >= maximumLoadNow) break;
    if (cumulativeEstimatedTokens + candidate.estimatedTokens >= targetEstimatedTokens) continue;
    selected.push(candidate);
    cumulativeEstimatedTokens += candidate.estimatedTokens;
  }
  return selected;
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

function stripPriority({ stage: _stage, order: _order, routeIds: _routeIds, ...reference }) {
  return reference;
}

function compareReferencePriority(left, right) {
  return left.stage - right.stage || left.order - right.order || compareUtf8(left.path, right.path);
}

function comparePriority(left, right) {
  if (left === undefined) return 1;
  if (right === undefined) return -1;
  return left.stage - right.stage || left.order - right.order || compareUtf8(left.id, right.id);
}

function validPriority(value) {
  return Number.isSafeInteger(value.stage) && value.stage > 0
    && Number.isSafeInteger(value.order) && value.order > 0;
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

function routeKey(routeKind, routeId) {
  return `${String(routeKind)}:${String(routeId)}`;
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
