#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const metadataPath = path.join(repositoryRoot, "config", "plugin.json");

const outputs = Object.freeze({
  codex: path.join(repositoryRoot, ".codex-plugin", "plugin.json"),
  claude: path.join(repositoryRoot, ".claude-plugin", "plugin.json"),
  marketplace: path.join(repositoryRoot, ".claude-plugin", "marketplace.json")
});

const exactMetadataKeys = Object.freeze([
  "capabilities",
  "category",
  "defaultPrompt",
  "description",
  "developerName",
  "displayName",
  "keywords",
  "license",
  "longDescription",
  "name",
  "repository",
  "schemaVersion",
  "shortDescription",
  "version"
]);

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function loadMetadata() {
  const source = fs.readFileSync(metadataPath, "utf8");
  const metadata = JSON.parse(source);
  if (source !== canonicalJson(metadata)) throw new Error("config/plugin.json must be canonical JSON");
  if (metadata.schemaVersion !== "1.0.0") throw new Error("unsupported plugin metadata schema");
  if (JSON.stringify(Object.keys(metadata).sort()) !== JSON.stringify(exactMetadataKeys)) {
    throw new Error("plugin metadata keys differ from the closed schema");
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(metadata.name)) throw new Error("plugin name must be kebab-case");
  if (!/^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u.test(metadata.version)) {
    throw new Error("plugin version must be stable semver");
  }
  for (const key of ["displayName", "description", "shortDescription", "longDescription", "developerName", "category", "license", "repository"]) {
    if (typeof metadata[key] !== "string" || metadata[key].length === 0) throw new Error(`plugin ${key} is missing`);
  }
  for (const key of ["capabilities", "defaultPrompt", "keywords"]) {
    if (!Array.isArray(metadata[key]) || metadata[key].length === 0 || metadata[key].some((item) => typeof item !== "string" || item.length === 0)) {
      throw new Error(`plugin ${key} must be a non-empty string array`);
    }
  }
  if (!metadata.defaultPrompt.some((prompt) => prompt.includes("$programmable-v4-hook-builder"))) {
    throw new Error("default prompt must invoke the canonical skill");
  }
  return metadata;
}

function buildOutputs(metadata) {
  const shared = {
    name: metadata.name,
    version: metadata.version,
    description: metadata.description,
    author: { name: metadata.developerName },
    license: metadata.license,
    keywords: metadata.keywords,
    skills: "./skills/"
  };
  return new Map([
    [outputs.codex, canonicalJson({
      ...shared,
      interface: {
        displayName: metadata.displayName,
        shortDescription: metadata.shortDescription,
        longDescription: metadata.longDescription,
        developerName: metadata.developerName,
        category: metadata.category,
        capabilities: metadata.capabilities,
        defaultPrompt: metadata.defaultPrompt
      }
    })],
    [outputs.claude, canonicalJson({ displayName: metadata.displayName, ...shared })],
    [outputs.marketplace, canonicalJson({
      name: metadata.name,
      version: metadata.version,
      owner: { name: metadata.developerName },
      metadata: {
        description: metadata.longDescription,
        repository: metadata.repository
      },
      plugins: [{
        name: metadata.name,
        source: "./",
        description: metadata.description
      }]
    })]
  ]);
}

function writeAtomically(target, contents) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.tmp-${process.pid}`);
  if (fs.existsSync(temporary)) throw new Error(`refusing to reuse temporary file ${temporary}`);
  try {
    fs.writeFileSync(temporary, contents, { encoding: "utf8", flag: "wx", mode: 0o644 });
    fs.renameSync(temporary, target);
  } catch (error) {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
    throw error;
  }
}

function main(argv) {
  if (argv.length !== 1 || !["--check", "--write"].includes(argv[0])) {
    throw new Error("Usage: generate-plugin-manifests.mjs --check|--write");
  }
  const expected = buildOutputs(loadMetadata());
  if (argv[0] === "--write") {
    for (const [target, contents] of expected) writeAtomically(target, contents);
  }
  for (const [target, contents] of expected) {
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`plugin output must be a regular file: ${target}`);
    if (fs.readFileSync(target, "utf8") !== contents) throw new Error(`generated plugin manifest drift: ${target}`);
  }
  process.stdout.write(`${JSON.stringify({ status: "PLUGIN_MANIFESTS_VALID", version: loadMetadata().version, outputs: [...expected.keys()].map((target) => path.relative(repositoryRoot, target)) })}\n`);
}

try {
  main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
