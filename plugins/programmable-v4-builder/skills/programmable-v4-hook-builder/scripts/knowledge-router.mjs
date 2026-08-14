#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  activateConfirmedKnowledge,
  renderActivatedContext,
  renderContextBrief
} from "./knowledge-activation-core.mjs";
import { describeKnowledgeSelectors, KnowledgeRouterError, planKnowledge } from "./knowledge-router-core.mjs";
import { openOfflineRegistry, RegistryDiscoveryError, showRegistryProject } from "./registry-discovery-core.mjs";
import { canonicalJson } from "./template-catalog-core.mjs";
import { parseBoundedStrictJsonBytes } from "./strict-json-core.mjs";

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const maximumTemplatePlanBytes = 1_048_576;

try {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    process.stdout.write(args.includes("--json") ? `${helpJson()}\n` : help());
  } else {
    const options = parseArgs(args);
    const templatePlanInput = options.templatePlan === null
      ? { templatePlan: null, templatePlanSplitReview: null }
      : await readTemplatePlan(options.templatePlan);
    const registryProjectInput = await loadRegistryProjects(options.registryProjects);
    const planInput = {
      mode: options.mode,
      templatePlan: templatePlanInput.templatePlan,
      templatePlanSplitReview: templatePlanInput.templatePlanSplitReview,
      packs: options.packs,
      capabilities: options.capabilities,
      surfaces: options.surfaces,
      registryProjects: registryProjectInput.registryProjects,
      registryProjectSplitReview: registryProjectInput.registryProjectSplitReview,
      skillRoot
    };
    const routedPlan = planKnowledge(planInput);
    if (options.activateConfirmed) {
      const basePlan = planKnowledge({ mode: options.mode, skillRoot });
      const result = activateConfirmedKnowledge({
        basePlan,
        routedPlan,
        baseProfileDigest: options.baseProfileDigest,
        explicitCapabilities: options.capabilities,
        explicitSurfaces: options.surfaces,
        skillRoot
      });
      process.stdout.write(options.brief
        ? renderContextBrief(result, { basePlan })
        : renderActivatedContext(result, { basePlan }));
    } else {
      if (options.baseProfileDigest !== null) usageError("--base-profile-digest requires --activate-confirmed.");
      process.stdout.write(options.brief
        ? renderContextBrief(routedPlan)
        : `${canonicalJson({ schemaVersion: "1.0.0", ok: true, command: "context", result: routedPlan })}\n`);
    }
  }
} catch (error) {
  const code = error instanceof KnowledgeRouterError || error instanceof RegistryDiscoveryError
    ? error.code
    : "KNOWLEDGE_ROUTER_FAILED";
  const output = {
    schemaVersion: "1.0.0",
    ok: false,
    command: "context",
    error: {
      code,
      message: error instanceof Error ? error.message : String(error)
    }
  };
  if ((error instanceof KnowledgeRouterError || error instanceof RegistryDiscoveryError) && error.details !== undefined) output.error.details = error.details;
  process.stdout.write(`${canonicalJson(output)}\n`);
  process.exitCode = code === "USAGE_ERROR" || code === "KNOWLEDGE_MODE_INVALID" || code === "KNOWLEDGE_INPUT_INVALID" || code === "KNOWLEDGE_PACK_INVALID" || code === "KNOWLEDGE_ROUTE_FAMILY_AMBIGUOUS" || code === "KNOWLEDGE_ACTIVATION_INVALID" || code === "KNOWLEDGE_ACTIVATION_BASE_MISMATCH" || code === "REGISTRY_QUERY_INVALID" ? 2 : 1;
}

function parseArgs(args) {
  const options = {
    mode: null,
    templatePlan: null,
    packs: [],
    capabilities: [],
    surfaces: [],
    registryProjects: [],
    activateConfirmed: false,
    baseProfileDigest: null,
    brief: false
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--mode") {
      if (options.mode !== null) usageError("--mode may be provided only once.");
      options.mode = requireValue(args, ++index, "--mode");
    } else if (argument === "--template-plan") {
      if (options.templatePlan !== null) usageError("--template-plan may be provided only once.");
      options.templatePlan = requireValue(args, ++index, "--template-plan");
    } else if (argument === "--capability") {
      options.capabilities.push(requireValue(args, ++index, "--capability"));
    } else if (argument === "--pack") {
      options.packs.push(requireValue(args, ++index, "--pack"));
    } else if (argument === "--surface") {
      options.surfaces.push(requireValue(args, ++index, "--surface"));
    } else if (argument === "--registry-project") {
      options.registryProjects.push(requireValue(args, ++index, "--registry-project"));
    } else if (argument === "--activate-confirmed") {
      if (options.activateConfirmed) usageError("--activate-confirmed may be provided only once.");
      options.activateConfirmed = true;
    } else if (argument === "--base-profile-digest") {
      if (options.baseProfileDigest !== null) usageError("--base-profile-digest may be provided only once.");
      options.baseProfileDigest = requireValue(args, ++index, "--base-profile-digest");
    } else if (argument === "--brief") {
      if (options.brief) usageError("--brief may be provided only once.");
      options.brief = true;
    } else {
      usageError(`Unknown argument: ${argument}.`);
    }
  }
  if (options.mode === null) usageError("context requires --mode <mode>.");
  if (options.activateConfirmed && options.baseProfileDigest === null) {
    usageError("--activate-confirmed requires --base-profile-digest <digest>.");
  }
  return options;
}

async function loadRegistryProjects(ids) {
  if (ids.length === 0) return { registryProjects: [], registryProjectSplitReview: null };
  if (new Set(ids).size !== ids.length) {
    throw new KnowledgeRouterError("KNOWLEDGE_INPUT_INVALID", "--registry-project requires unique project ids.");
  }
  const sortedIds = [...ids].sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
  if (sortedIds.length > 20) {
    return {
      registryProjects: [],
      registryProjectSplitReview: { ids: sortedIds }
    };
  }
  const session = openOfflineRegistry({ skillRoot });
  const projects = [];
  for (const id of sortedIds) {
    const record = await showRegistryProject(session, id);
    const summary = session.index.records.find((candidate) => candidate.id === id);
    projects.push({
      capabilities: record.capabilities,
      id,
      recordSha256: summary.sha256,
      status: record.status,
      surfaces: record.surfaces
    });
  }
  return { registryProjects: projects, registryProjectSplitReview: null };
}

async function readTemplatePlan(candidate) {
  const target = path.resolve(candidate);
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch {
    throw new KnowledgeRouterError("TEMPLATE_PLAN_INVALID", `Template plan does not exist: ${candidate}.`);
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2) {
    throw new KnowledgeRouterError("TEMPLATE_PLAN_INVALID", "Template plan must be a real JSON file, not a symbolic link.");
  }
  if (stat.size > maximumTemplatePlanBytes) {
    const sourceSha256 = await streamFileSha256(target, stat.size);
    return {
      templatePlan: null,
      templatePlanSplitReview: {
        byteLength: stat.size,
        maximumBytes: maximumTemplatePlanBytes,
        reason: "size-overflow",
        sourceSha256
      }
    };
  }
  try {
    return {
      templatePlan: parseBoundedStrictJsonBytes(fs.readFileSync(target), {
        maxSourceBytes: maximumTemplatePlanBytes
      }),
      templatePlanSplitReview: null
    };
  } catch {
    throw new KnowledgeRouterError("TEMPLATE_PLAN_INVALID", "Template plan must be valid UTF-8 JSON.");
  }
}

async function streamFileSha256(target, expectedBytes) {
  const hash = crypto.createHash("sha256");
  let byteLength = 0;
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0);
  try {
    for await (const chunk of fs.createReadStream(target, { flags })) {
      byteLength += chunk.length;
      hash.update(chunk);
    }
  } catch {
    throw new KnowledgeRouterError("TEMPLATE_PLAN_INVALID", "Template plan changed or became unreadable during source hashing.");
  }
  if (byteLength !== expectedBytes) {
    throw new KnowledgeRouterError("TEMPLATE_PLAN_INVALID", "Template plan changed during source hashing.");
  }
  return `sha256:${hash.digest("hex")}`;
}

function requireValue(args, index, option) {
  const value = args[index];
  if (value === undefined || value.startsWith("--")) usageError(`${option} requires a value.`);
  return value;
}

function usageError(message) {
  throw new KnowledgeRouterError("USAGE_ERROR", message);
}

function help() {
  return [
    "Usage: knowledge-router.mjs --mode <explore|autopilot|preflight|prototype|repair|review|submit|handoff> [selectors] [--brief] [--activate-confirmed --base-profile-digest <digest>]",
    "",
    "Return the smallest local reference profile for the confirmed task.",
    "",
    "Options:",
    "  --mode <mode>           Required task phase.",
    "  --template-plan <path>  Derive selectors from one current plan.",
    "  --pack|--capability|--surface <id>  Add a confirmed selector; repeat as needed.",
    "  --registry-project <id> Add bundled Registry discovery context.",
    "  --brief                 Return a complete bounded routing brief below 2,500 bytes.",
    "  --activate-confirmed    Load exactly one specialist delta for exact confirmed selectors.",
    "  --base-profile-digest <digest>  Bind activation to the consumed mode-only profile.",
    "",
    "Examples:",
    "  context --mode autopilot --brief",
    "  context --mode autopilot --capability <confirmed-id> --activate-confirmed --base-profile-digest <digest> --brief",
    "",
    "Use --help --json for every exact selectable id and reserved routing family.",
    "Use templates list --filter <text> before selecting a pack.",
    "Unknown owner-defined kebab-case capabilities remain eligible for architecture review.",
    "Over 256 direct ids return HOLD_SPLIT_REVIEW; no materialization or adverse decision occurs.",
    "Bundled local reads only; no network or project writes.",
    ""
  ].join("\n");
}

function helpJson() {
  return canonicalJson({ schemaVersion: "1.0.0", ok: true, command: "context-help", result: {
    modes: ["explore", "autopilot", "preflight", "prototype", "repair", "review", "submit", "handoff"],
    ...describeKnowledgeSelectors({ skillRoot }),
    note: "Routing-family ids are reserved and are not selectable project ids."
  } });
}
