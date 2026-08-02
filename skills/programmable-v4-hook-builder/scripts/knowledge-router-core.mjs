import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { builderTemplateFromPlan } from "./builder-template-contract.mjs";
import { canonicalJson, loadTemplateCatalog } from "./template-catalog-core.mjs";

const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const referencePattern = /^[a-z0-9]+(?:[-.][a-z0-9]+)*\.(?:md|json)$/u;
const coreDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultSkillRoot = path.resolve(coreDirectory, "..");

export class KnowledgeRouterError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "KnowledgeRouterError";
    this.code = code;
    this.details = details;
  }
}

export function loadKnowledgeRouting({ skillRoot = defaultSkillRoot } = {}) {
  const resolvedSkillRoot = path.resolve(skillRoot);
  const routingPath = path.join(resolvedSkillRoot, "references", "knowledge-routing.json");
  let routing;
  try {
    routing = JSON.parse(fs.readFileSync(routingPath, "utf8"));
  } catch (error) {
    fail("KNOWLEDGE_ROUTING_UNAVAILABLE", `Cannot load knowledge routing: ${error.message}`);
  }
  validateRouting(routing, resolvedSkillRoot);
  return routing;
}

export function planKnowledge({
  mode,
  templatePlan = null,
  capabilities = [],
  surfaces = [],
  skillRoot = defaultSkillRoot
}) {
  const resolvedSkillRoot = path.resolve(skillRoot);
  const routing = loadKnowledgeRouting({ skillRoot: resolvedSkillRoot });
  if (!Object.hasOwn(routing.modes, mode)) {
    fail("KNOWLEDGE_MODE_INVALID", `Unsupported mode ${mode}.`, { supportedModes: Object.keys(routing.modes) });
  }

  const catalog = loadTemplateCatalog({ skillRoot: resolvedSkillRoot });
  const knownCapabilityIds = new Set(catalog.definitions.flatMap((definition) => definition.capabilities));
  const knownSurfaceIds = new Set(catalog.definitions.flatMap((definition) => definition.projectSurfaces));
  const selectedCapabilities = new Set(normalizeIds(capabilities, "capability"));
  const routedCapabilities = new Set(selectedCapabilities);
  const selectedSurfaces = new Set(normalizeIds(surfaces, "surface"));
  const sources = [];

  if (templatePlan !== null) {
    let builderTemplate;
    try {
      builderTemplate = builderTemplateFromPlan(templatePlan);
    } catch (error) {
      fail("TEMPLATE_PLAN_INVALID", error.message);
    }
    const selection = builderTemplate.templateSelection;
    for (const capability of selection.selectedCapabilityIds) selectedCapabilities.add(capability);
    for (const capability of selection.customCapabilities) {
      selectedCapabilities.add(capability.id);
      routedCapabilities.add(capability.id);
    }
    // Default evidence and metadata packs deliberately list every surface they
    // can review. They do not mean every project actually contains those
    // surfaces, so route from the starter plus caller-requested packs only.
    const selectedDefinitions = [selection.starterId, ...selection.requestedPackIds].map((id) => catalog.byId.get(id));
    for (const definition of selectedDefinitions) {
      for (const capability of definition.capabilities) routedCapabilities.add(capability);
      // The blank starter deliberately lists every possible surface. Until a
      // capability or explicit surface selects one, those are options rather
      // than actual project boundaries and must not load the whole library.
      if (definition.id !== "blank-custom") {
        for (const surface of definition.projectSurfaces) selectedSurfaces.add(surface);
      }
    }
    sources.push({
      kind: "template-plan",
      starterId: selection.starterId,
      selectedPackIds: [...selection.selectedPackIds],
      selectionDigest: selection.selectionDigest
    });
  }
  if (capabilities.length > 0) sources.push({ kind: "explicit-capabilities", count: capabilities.length });
  if (surfaces.length > 0) sources.push({ kind: "explicit-surfaces", count: surfaces.length });
  if (sources.length === 0) sources.push({ kind: "mode-only" });

  const capabilityList = [...selectedCapabilities].sort(compareUtf8);
  const surfaceList = [...selectedSurfaces].sort(compareUtf8);
  const unknownCapabilities = capabilityList.filter((id) => !knownCapabilityIds.has(id));
  const unknownSurfaces = surfaceList.filter((id) => !knownSurfaceIds.has(id));
  const selectedReferences = new Map();

  for (const reference of routing.modes[mode].initial) {
    addReference(selectedReferences, reference, `mode:${mode}`);
  }
  for (const route of routing.capabilityRoutes) {
    const matched = route.matches.filter((id) => routedCapabilities.has(id));
    if (matched.length === 0) continue;
    for (const reference of route.references) {
      addReference(selectedReferences, reference, `capability:${matched.join(",")}`);
    }
  }
  for (const route of routing.surfaceRoutes) {
    const matched = route.matches.filter((id) => selectedSurfaces.has(id));
    if (matched.length === 0) continue;
    for (const reference of route.references) {
      addReference(selectedReferences, reference, `surface:${matched.join(",")}`);
    }
  }
  if (unknownCapabilities.length > 0 || unknownSurfaces.length > 0) {
    for (const reference of routing.unknownCapabilityReferences) {
      addReference(selectedReferences, reference, "novel-capability:architecture-review");
    }
  }

  const loadNow = [...selectedReferences].map(([reference, reasons]) => {
    const filePath = path.join(resolvedSkillRoot, "references", reference);
    const bytes = fs.statSync(filePath).size;
    return {
      path: `references/${reference}`,
      reasons: [...reasons].sort(compareUtf8),
      bytes,
      estimatedTokens: Math.ceil(bytes / 4)
    };
  });
  const loadNowPaths = new Set(loadNow.map(({ path: reference }) => reference));
  const loadLater = routing.modes[mode].later
    .filter(({ reference }) => !loadNowPaths.has(`references/${reference}`))
    .map(({ reference, trigger }) => ({ path: `references/${reference}`, trigger }));
  const totalBytes = loadNow.reduce((total, reference) => total + reference.bytes, 0);
  const estimatedTokens = loadNow.reduce((total, reference) => total + reference.estimatedTokens, 0);
  const targetInitialTokens = routing.policy.targetInitialTokens;
  const profilePreimage = {
    mode,
    capabilities: capabilityList,
    surfaces: surfaceList,
    loadNow: loadNow.map(({ path: reference }) => reference)
  };

  return {
    schemaVersion: "1.0.0",
    kind: "programmable-knowledge-plan",
    mode,
    sources,
    capabilities: capabilityList,
    surfaces: surfaceList,
    unknownCapabilities,
    unknownSurfaces,
    reviewRoute: unknownCapabilities.length > 0 || unknownSurfaces.length > 0
      ? "architecture-review-required"
      : "selected-profile",
    automaticAdverseDecision: false,
    loadNow,
    loadLater,
    contextBudget: {
      totalBytes,
      estimatedTokens,
      targetInitialTokens,
      status: estimatedTokens <= targetInitialTokens ? "within-target" : "expanded-required-context",
      estimation: routing.policy.estimatedTokenAlgorithm
    },
    profileDigest: crypto.createHash("sha256").update(canonicalJson(profilePreimage)).digest("hex"),
    networkAccessed: false
  };
}

function validateRouting(routing, skillRoot) {
  if (
    routing?.schemaVersion !== "1.0.0"
    || routing?.kind !== "programmable-knowledge-routing"
    || routing?.policy?.selectionSemantics !== "minimum-sufficient-progressive-context"
    || routing?.policy?.unknownCapabilityOutcome !== "preserve-and-route-to-architecture-review"
    || routing?.policy?.automaticAdverseDecision !== false
    || routing?.policy?.networkAccess !== "forbidden"
    || routing?.policy?.estimatedTokenAlgorithm !== "ceil-utf8-bytes-divided-by-four"
    || !Number.isSafeInteger(routing?.policy?.targetInitialTokens)
    || routing.policy.targetInitialTokens < 1000
    || routing.policy.targetInitialTokens > 100000
  ) fail("KNOWLEDGE_ROUTING_INVALID", "Knowledge-routing identity or policy is invalid.");

  const allReferences = new Set();
  if (!isPlainObject(routing.modes) || Object.keys(routing.modes).length !== 7) {
    fail("KNOWLEDGE_ROUTING_INVALID", "Knowledge routing must define the seven builder modes.");
  }
  for (const mode of ["explore", "preflight", "prototype", "repair", "review", "submit", "handoff"]) {
    const profile = routing.modes[mode];
    if (!isPlainObject(profile) || !Array.isArray(profile.initial) || !Array.isArray(profile.later)) {
      fail("KNOWLEDGE_ROUTING_INVALID", `Mode ${mode} is incomplete.`);
    }
    for (const reference of profile.initial) allReferences.add(requireReference(reference));
    for (const item of profile.later) {
      if (!isPlainObject(item) || typeof item.trigger !== "string" || item.trigger.length < 12 || item.trigger.length > 500) {
        fail("KNOWLEDGE_ROUTING_INVALID", `Mode ${mode} has an invalid deferred trigger.`);
      }
      allReferences.add(requireReference(item.reference));
    }
  }
  for (const [label, routes] of [["capability", routing.capabilityRoutes], ["surface", routing.surfaceRoutes]]) {
    if (!Array.isArray(routes) || routes.length < 1 || routes.length > 64) {
      fail("KNOWLEDGE_ROUTING_INVALID", `${label} routes are invalid.`);
    }
    const routeIds = new Set();
    for (const route of routes) {
      if (!isPlainObject(route) || !idPattern.test(route.id ?? "") || routeIds.has(route.id)) {
        fail("KNOWLEDGE_ROUTING_INVALID", `${label} route identity is invalid.`);
      }
      routeIds.add(route.id);
      normalizeIds(route.matches, `${label} route match`);
      if (!Array.isArray(route.references) || route.references.length < 1) {
        fail("KNOWLEDGE_ROUTING_INVALID", `${label} route ${route.id} has no references.`);
      }
      for (const reference of route.references) allReferences.add(requireReference(reference));
    }
  }
  if (!Array.isArray(routing.unknownCapabilityReferences) || routing.unknownCapabilityReferences.length < 1) {
    fail("KNOWLEDGE_ROUTING_INVALID", "Unknown-capability references are missing.");
  }
  for (const reference of routing.unknownCapabilityReferences) allReferences.add(requireReference(reference));
  for (const reference of allReferences) {
    const target = path.join(skillRoot, "references", reference);
    let stat;
    try {
      stat = fs.lstatSync(target);
    } catch {
      fail("KNOWLEDGE_ROUTING_INVALID", `Knowledge reference is missing: ${reference}.`);
    }
    if (!stat.isFile() || stat.isSymbolicLink() || fs.realpathSync(target) !== target) {
      fail("KNOWLEDGE_ROUTING_INVALID", `Knowledge reference is not a real bundled file: ${reference}.`);
    }
  }
}

function addReference(selected, reference, reason) {
  const reasons = selected.get(reference) ?? new Set();
  reasons.add(reason);
  selected.set(reference, reasons);
}

function normalizeIds(values, label) {
  if (!Array.isArray(values) || values.length > 256) fail("KNOWLEDGE_INPUT_INVALID", `${label} list is invalid.`);
  const normalized = [];
  const seen = new Set();
  for (const value of values) {
    if (typeof value !== "string" || value.length > 120 || !idPattern.test(value)) {
      fail("KNOWLEDGE_INPUT_INVALID", `${label} must use lowercase kebab-case ids.`);
    }
    if (seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
  }
  return normalized.sort(compareUtf8);
}

function requireReference(value) {
  if (typeof value !== "string" || !referencePattern.test(value)) {
    fail("KNOWLEDGE_ROUTING_INVALID", `Unsafe knowledge reference: ${String(value)}.`);
  }
  return value;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function compareUtf8(left, right) {
  return Buffer.from(left, "utf8").compare(Buffer.from(right, "utf8"));
}

function fail(code, message, details = undefined) {
  throw new KnowledgeRouterError(code, message, details);
}
