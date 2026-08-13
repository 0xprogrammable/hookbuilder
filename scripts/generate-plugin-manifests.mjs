#!/usr/bin/env node

import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const metadataPath = path.join(repositoryRoot, "config", "plugin.json");
const packagePath = path.join(repositoryRoot, "package.json");

const outputs = Object.freeze({
  codex: path.join(repositoryRoot, ".codex-plugin", "plugin.json"),
  codexMarketplace: path.join(repositoryRoot, ".agents", "plugins", "marketplace.json"),
  claude: path.join(repositoryRoot, ".claude-plugin", "plugin.json"),
  claudeMarketplace: path.join(repositoryRoot, ".claude-plugin", "marketplace.json")
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
  "mcpServers",
  "name",
  "repository",
  "schemaVersion",
  "shortDescription",
  "version"
]);
const excludedPayloadDirectories = new Set(["broadcast", "cache", "coverage", "node_modules", "out"]);

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function loadMetadata() {
  const source = fs.readFileSync(metadataPath, "utf8");
  const metadata = JSON.parse(source);
  const packageSource = fs.readFileSync(packagePath, "utf8");
  const packageDocument = JSON.parse(packageSource);
  if (source !== canonicalJson(metadata)) throw new Error("config/plugin.json must be canonical JSON");
  if (packageSource !== canonicalJson(packageDocument)) throw new Error("package.json must be canonical JSON");
  if (metadata.schemaVersion !== "1.0.0") throw new Error("unsupported plugin metadata schema");
  if (JSON.stringify(Object.keys(metadata).sort()) !== JSON.stringify(exactMetadataKeys)) {
    throw new Error("plugin metadata keys differ from the closed schema");
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(metadata.name)) throw new Error("plugin name must be kebab-case");
  if (!/^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u.test(metadata.version)) {
    throw new Error("plugin version must be stable semver");
  }
  if (metadata.version !== packageDocument.version) {
    throw new Error("package.json version must match canonical config/plugin.json version");
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
  if (metadata.defaultPrompt.length > 3 || metadata.defaultPrompt.some((prompt) => prompt.length > 128)) {
    throw new Error("plugin default prompts must contain at most three entries of at most 128 characters");
  }
  if (metadata.mcpServers !== "./.mcp.json") {
    throw new Error("plugin mcpServers must point to the repository-local .mcp.json companion");
  }
  return metadata;
}

function buildOutputs(metadata) {
  const sharedIdentity = {
    name: metadata.name,
    version: metadata.version,
    description: metadata.description,
    author: { name: metadata.developerName },
    license: metadata.license,
    keywords: metadata.keywords
  };
  const codexManifest = canonicalJson({
    ...sharedIdentity,
    skills: "./skills/",
    mcpServers: metadata.mcpServers,
    interface: {
      displayName: metadata.displayName,
      shortDescription: metadata.shortDescription,
      longDescription: metadata.longDescription,
      developerName: metadata.developerName,
      category: metadata.category,
      capabilities: metadata.capabilities,
      defaultPrompt: metadata.defaultPrompt
    }
  });
  const pluginPayloadRoot = path.join(repositoryRoot, "plugins", metadata.name);
  const pluginPayloadManifest = path.join(pluginPayloadRoot, ".codex-plugin", "plugin.json");
  return new Map([
    [outputs.codex, codexManifest],
    [outputs.codexMarketplace, canonicalJson({
      name: "programmable",
      interface: { displayName: metadata.developerName },
      plugins: [{
        name: metadata.name,
        source: {
          source: "local",
          path: `./plugins/${metadata.name}`
        },
        policy: {
          installation: "AVAILABLE",
          authentication: "ON_INSTALL"
        },
        category: metadata.category
      }]
    })],
    [outputs.claude, canonicalJson({
      displayName: metadata.displayName,
      ...sharedIdentity,
      skills: "./skills/"
    })],
    [outputs.claudeMarketplace, canonicalJson({
      name: metadata.name,
      version: metadata.version,
      owner: { name: metadata.developerName },
      description: metadata.longDescription,
      plugins: [{
        name: metadata.name,
        displayName: metadata.displayName,
        version: metadata.version,
        source: "./skills/programmable-v4-hook-builder",
        description: metadata.description,
        author: { name: metadata.developerName },
        repository: metadata.repository,
        license: metadata.license,
        keywords: metadata.keywords,
        category: metadata.category,
        skills: "./",
        strict: false
      }]
    })],
    [pluginPayloadManifest, codexManifest]
  ]);
}

function walkRegularFiles(directory, { excludeTransient = false } = {}) {
  if (!fs.existsSync(directory)) throw new Error(`plugin payload source is missing: ${directory}`);
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const absolutePath = path.join(directory, entry.name);
    const stat = fs.lstatSync(absolutePath);
    if (stat.isSymbolicLink()) throw new Error(`plugin payload source must not contain symlinks: ${absolutePath}`);
    if (stat.isDirectory() && excludeTransient && excludedPayloadDirectories.has(entry.name)) continue;
    if (stat.isDirectory()) files.push(...walkRegularFiles(absolutePath, { excludeTransient }));
    else if (stat.isFile()) files.push(absolutePath);
    else throw new Error(`plugin payload source must contain only regular files and directories: ${absolutePath}`);
  }
  return files;
}

function buildPayload(metadata, manifests) {
  const payloadRoot = path.join(repositoryRoot, "plugins", metadata.name);
  const expectedParent = path.join(repositoryRoot, "plugins");
  if (path.dirname(payloadRoot) !== expectedParent || path.basename(payloadRoot) !== metadata.name) {
    throw new Error("refusing to resolve plugin payload outside the repository plugins directory");
  }
  const files = new Map();
  const mirrors = [];
  const addMirror = (source, target) => {
    const stat = fs.lstatSync(source);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`plugin payload source must be a regular file: ${source}`);
    const contents = fs.readFileSync(source);
    files.set(target, contents);
    mirrors.push({ source, target });
  };
  const addTree = (sourceRoot, targetRoot) => {
    for (const source of walkRegularFiles(sourceRoot, { excludeTransient: true })) {
      addMirror(source, path.join(targetRoot, path.relative(sourceRoot, source)));
    }
  };

  const payloadManifest = path.join(payloadRoot, ".codex-plugin", "plugin.json");
  files.set(payloadManifest, Buffer.from(manifests.get(payloadManifest), "utf8"));
  mirrors.push({ source: outputs.codex, target: payloadManifest });
  addMirror(path.join(repositoryRoot, ".mcp.json"), path.join(payloadRoot, ".mcp.json"));
  addTree(path.join(repositoryRoot, "mcp"), path.join(payloadRoot, "mcp"));
  addTree(path.join(repositoryRoot, "skills"), path.join(payloadRoot, "skills"));
  return { files, mirrors, payloadRoot };
}

function sha256(contents) {
  return crypto.createHash("sha256").update(contents).digest("hex");
}

function payloadDigest(payload) {
  const hash = crypto.createHash("sha256");
  for (const [target, contents] of [...payload.files].sort(([left], [right]) => left.localeCompare(right))) {
    hash.update(path.relative(payload.payloadRoot, target).split(path.sep).join("/"));
    hash.update("\0");
    hash.update(contents);
  }
  return hash.digest("hex");
}

function resetPayload(payloadRoot) {
  if (fs.existsSync(payloadRoot)) {
    const stat = fs.lstatSync(payloadRoot);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`plugin payload root must be a regular directory: ${payloadRoot}`);
    }
    fs.rmSync(payloadRoot, { recursive: true, force: true });
  }
}

function verifyPayload(payload) {
  const actualFiles = walkRegularFiles(payload.payloadRoot);
  const actualRelative = actualFiles
    .map((file) => path.relative(payload.payloadRoot, file).split(path.sep).join("/"))
    .sort();
  const expectedRelative = [...payload.files.keys()]
    .map((file) => path.relative(payload.payloadRoot, file).split(path.sep).join("/"))
    .sort();
  if (JSON.stringify(actualRelative) !== JSON.stringify(expectedRelative)) {
    throw new Error("generated plugin payload file inventory differs from canonical sources");
  }
  for (const [target, expected] of payload.files) {
    const actual = fs.readFileSync(target);
    if (!actual.equals(expected)) throw new Error(`generated plugin payload drift: ${target}`);
  }
  for (const { source, target } of payload.mirrors) {
    const sourceContents = fs.readFileSync(source);
    const targetContents = fs.readFileSync(target);
    if (sha256(sourceContents) !== sha256(targetContents) || !sourceContents.equals(targetContents)) {
      throw new Error(`generated plugin payload does not byte-match canonical source: ${target}`);
    }
  }
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
  const metadata = loadMetadata();
  const expected = buildOutputs(metadata);
  const payload = buildPayload(metadata, expected);
  if (argv[0] === "--write") {
    resetPayload(payload.payloadRoot);
    for (const [target, contents] of expected) writeAtomically(target, contents);
    for (const [target, contents] of payload.files) {
      if (expected.has(target)) continue;
      writeAtomically(target, contents);
    }
  }
  for (const [target, contents] of expected) {
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`plugin output must be a regular file: ${target}`);
    if (fs.readFileSync(target, "utf8") !== contents) throw new Error(`generated plugin manifest drift: ${target}`);
  }
  verifyPayload(payload);
  process.stdout.write(`${JSON.stringify({
    status: "PLUGIN_MANIFESTS_VALID",
    version: metadata.version,
    outputs: [...expected.keys()].map((target) => path.relative(repositoryRoot, target)),
    payload: {
      root: path.relative(repositoryRoot, payload.payloadRoot),
      files: payload.files.size,
      sha256: payloadDigest(payload),
      sourceByteVerified: true
    }
  })}\n`);
}

try {
  main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
