#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  TemplateCatalogError,
  canonicalJson,
  listTemplateCatalog,
  loadTemplateCatalog,
  materializeTemplate,
  parseCustomCapability,
  parseLocalTag,
  showTemplateDefinition
} from "./template-catalog-core.mjs";

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

try {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    process.stdout.write(help());
  } else {
    const command = args[0];
    const catalog = loadTemplateCatalog({ skillRoot });
    if (command === "list") {
      const options = parseList(args.slice(1));
      emitSuccess(command, {
        catalogDigest: catalog.catalogDigest,
        entries: listTemplateCatalog(catalog, options)
      });
    } else if (command === "show") {
      const id = parseShow(args.slice(1));
      emitSuccess(command, {
        catalogDigest: catalog.catalogDigest,
        definition: showTemplateDefinition(catalog, id)
      });
    } else if (command === "materialize") {
      const options = parseMaterialize(args.slice(1));
      const result = materializeTemplate({
        catalog,
        starterId: options.starterId,
        packIds: options.packIds,
        customCapabilities: options.customCapabilities,
        localTags: options.localTags,
        targetDirectory: options.targetDirectory
      });
      emitSuccess(command, result);
    } else {
      usageError(`Unknown command: ${command}.`);
    }
  }
} catch (error) {
  const code = error instanceof TemplateCatalogError ? error.code : "TEMPLATE_CATALOG_FAILED";
  const output = {
    schemaVersion: "1.0.0",
    ok: false,
    error: {
      code,
      message: error instanceof Error ? error.message : String(error)
    }
  };
  if (error instanceof TemplateCatalogError && error.details !== undefined) {
    output.error.details = error.details;
  }
  process.stdout.write(`${canonicalJson(output)}\n`);
  process.exitCode = code === "USAGE_ERROR" ? 2 : 1;
}

function parseList(args) {
  let kind = null;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") {
      process.stdout.write(listHelp());
      process.exit(0);
    }
    if (argument === "--kind") {
      if (kind !== null) usageError("--kind may be provided only once.");
      kind = requireValue(args, ++index, "--kind");
      continue;
    }
    usageError(`Unknown list argument: ${argument}.`);
  }
  return { kind };
}

function parseShow(args) {
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(showHelp());
    process.exit(0);
  }
  if (args.length !== 1 || args[0].startsWith("-")) {
    usageError("show requires exactly one catalog id.");
  }
  return args[0];
}

function parseMaterialize(args) {
  const options = {
    starterId: null,
    packIds: [],
    customCapabilities: [],
    localTags: [],
    targetDirectory: null
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") {
      process.stdout.write(materializeHelp());
      process.exit(0);
    }
    if (argument === "--starter") {
      if (options.starterId !== null) usageError("--starter may be provided only once.");
      options.starterId = requireValue(args, ++index, "--starter");
      continue;
    }
    if (argument === "--pack") {
      options.packIds.push(requireValue(args, ++index, "--pack"));
      continue;
    }
    if (argument === "--custom-capability") {
      options.customCapabilities.push(parseCustomCapability(requireValue(args, ++index, "--custom-capability")));
      continue;
    }
    if (argument === "--local-tag") {
      options.localTags.push(parseLocalTag(requireValue(args, ++index, "--local-tag")));
      continue;
    }
    if (argument === "--target") {
      if (options.targetDirectory !== null) usageError("--target may be provided only once.");
      options.targetDirectory = requireValue(args, ++index, "--target");
      continue;
    }
    usageError(`Unknown materialize argument: ${argument}.`);
  }
  if (options.starterId === null) usageError("materialize requires --starter <id>.");
  if (options.targetDirectory === null) usageError("materialize requires --target <new-directory>.");
  return options;
}

function requireValue(args, index, option) {
  const value = args[index];
  if (value === undefined || value.startsWith("--")) usageError(`${option} requires a value.`);
  return value;
}

function emitSuccess(command, result) {
  process.stdout.write(`${canonicalJson({
    schemaVersion: "1.0.0",
    ok: true,
    command,
    result
  })}\n`);
}

function usageError(message) {
  throw new TemplateCatalogError("USAGE_ERROR", message);
}

function help() {
  return [
    "Usage: template-catalog.mjs <command> [options]",
    "",
    "Local deterministic starter and capability-pack catalog. It performs no Git or network action.",
    "",
    "Commands:",
    "  list         List starters and capability packs.",
    "  show         Show one complete catalog definition.",
    "  materialize  Create one new local template directory.",
    "",
    "Run template-catalog.mjs <command> --help for command options.",
    ""
  ].join("\n");
}

function listHelp() {
  return [
    "Usage: template-catalog.mjs list [--kind starter|pack]",
    "",
    "List catalog accelerators in deterministic id order.",
    ""
  ].join("\n");
}

function showHelp() {
  return [
    "Usage: template-catalog.mjs show <id>",
    "",
    "Show one hash-bound starter or capability-pack definition.",
    ""
  ].join("\n");
}

function materializeHelp() {
  return [
    "Usage: template-catalog.mjs materialize --starter <id> --target <new-directory>",
    "       [--pack <id>]... [--custom-capability <id>=<visible-label>]... [--local-tag <slug>]...",
    "",
    "Create planning templates in one exact target directory that does not already exist.",
    "--target names the new plan directory itself, not a parent into which another folder is added.",
    "Dependencies and mandatory packs are included automatically.",
    "Unknown capabilities remain owner-defined and route to architecture review.",
    "Local tags are safe owner-provided discovery labels; they do not require catalog membership or imply provider support.",
    "No Git, network, submission, deployment or publication action occurs.",
    ""
  ].join("\n");
}
