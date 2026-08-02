#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { TextDecoder } from "node:util";
import { KnowledgeRouterError, planKnowledge } from "./knowledge-router-core.mjs";
import { canonicalJson } from "./template-catalog-core.mjs";

const strictUtf8 = new TextDecoder("utf-8", { fatal: true });

try {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    process.stdout.write(help());
  } else {
    const options = parseArgs(args);
    const templatePlan = options.templatePlan === null ? null : readTemplatePlan(options.templatePlan);
    const result = planKnowledge({
      mode: options.mode,
      templatePlan,
      packs: options.packs,
      capabilities: options.capabilities,
      surfaces: options.surfaces
    });
    process.stdout.write(`${canonicalJson({ schemaVersion: "1.0.0", ok: true, command: "context", result })}\n`);
  }
} catch (error) {
  const code = error instanceof KnowledgeRouterError ? error.code : "KNOWLEDGE_ROUTER_FAILED";
  const output = {
    schemaVersion: "1.0.0",
    ok: false,
    command: "context",
    error: {
      code,
      message: error instanceof Error ? error.message : String(error)
    }
  };
  if (error instanceof KnowledgeRouterError && error.details !== undefined) output.error.details = error.details;
  process.stdout.write(`${canonicalJson(output)}\n`);
  process.exitCode = code === "USAGE_ERROR" || code === "KNOWLEDGE_MODE_INVALID" || code === "KNOWLEDGE_INPUT_INVALID" || code === "KNOWLEDGE_PACK_INVALID" ? 2 : 1;
}

function parseArgs(args) {
  const options = { mode: null, templatePlan: null, packs: [], capabilities: [], surfaces: [] };
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
    } else {
      usageError(`Unknown argument: ${argument}.`);
    }
  }
  if (options.mode === null) usageError("context requires --mode <mode>.");
  return options;
}

function readTemplatePlan(candidate) {
  const target = path.resolve(candidate);
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch {
    throw new KnowledgeRouterError("TEMPLATE_PLAN_INVALID", `Template plan does not exist: ${candidate}.`);
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > 1_048_576) {
    throw new KnowledgeRouterError("TEMPLATE_PLAN_INVALID", "Template plan must be a real bounded JSON file, not a symbolic link.");
  }
  try {
    return JSON.parse(strictUtf8.decode(fs.readFileSync(target)));
  } catch {
    throw new KnowledgeRouterError("TEMPLATE_PLAN_INVALID", "Template plan must be valid UTF-8 JSON.");
  }
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
    "Usage: knowledge-router.mjs --mode <explore|preflight|prototype|repair|review|submit|handoff> [--template-plan <programmable-template.json>] [--pack <catalog-pack-id>]... [--capability <id>]... [--surface <id>]...",
    "",
    "Return the smallest deterministic local reference profile for one builder task.",
    "",
    "Options:",
    "  --mode <mode>           Select the current builder mode.",
    "  --template-plan <path>  Derive exact capabilities and surfaces from one current template plan.",
    "  --pack <id>             Expand one catalog pack into its exact capabilities and surfaces; repeat as needed.",
    "  --capability <id>       Add an explicit known or owner-defined capability; repeat as needed.",
    "  --surface <id>          Add an explicit project surface; repeat as needed.",
    "  --help                  Show this help without reading files or using the network.",
    "",
    "Unknown capabilities are preserved and routed to architecture review; they never cause an automatic rejection.",
    "The command reads bundled local references only and never uses the network or changes a project.",
    ""
  ].join("\n");
}
