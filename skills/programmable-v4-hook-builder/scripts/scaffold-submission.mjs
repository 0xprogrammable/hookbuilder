#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { TextDecoder } from "node:util";
import {
  builderTemplateFromPlan,
  manualBuilderTemplate
} from "./builder-template-contract.mjs";
import { parseCliOrExit } from "./cli-args.mjs";
import { hasForbiddenInvisibleOrBidi } from "./metadata-core.mjs";
import { assertInsideRepository, resolveRepositoryRoot } from "./repository-root.mjs";

const MAX_MODEL_ID_LENGTH = 64;
const MAX_MODEL_NAME_LENGTH = 80;
const MAX_TEMPLATE_PLAN_BYTES = 1_000_000;
const templateFiles = ["PROPOSAL.md", "THREAT_MODEL.md", "TEST_PLAN.md", "EVIDENCE.md"];
const strictUtf8 = new TextDecoder("utf-8", { fatal: true });
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(scriptDirectory, "..");
const templateRoot = path.join(skillRoot, "assets", "templates");
const { options, positionals } = parseCliOrExit({
  command: "scaffold-submission.mjs",
  usage: "scaffold-submission.mjs <model-id> [--repository-root <path>] [--name <display-name>] [--destination <path>] [--template-plan <programmable-template.json>]",
  summary: "Create one isolated Programmable hook proposal package without changing the model registry.",
  options: [
    { name: "--repository-root", key: "repositoryRoot", type: "value", valueName: "path", description: "Use this Git worktree instead of the current directory." },
    { name: "--name", key: "modelName", type: "value", valueName: "display-name", description: "Set a human-readable model name of at most 80 characters." },
    { name: "--destination", key: "destination", type: "value", valueName: "path", description: "Create the package under this in-repository directory." },
    { name: "--template-plan", key: "templatePlan", type: "value", valueName: "programmable-template.json", description: "Bind one materialized catalog plan into the generated submission; omit for explicit manual/null provenance." }
  ],
  positionals: { min: 1, max: 1, names: ["model-id"] }
});
const modelId = positionals[0];
validateModelId(modelId);
const displayName = normalizeModelName(options.modelName, modelId);

let repositoryRoot;
try {
  repositoryRoot = resolveRepositoryRoot(options.repositoryRoot);
} catch (error) {
  fail(error.message);
}
let destinationRoot = path.resolve(options.destination ?? path.join(repositoryRoot, "submissions"));
try {
  destinationRoot = assertInsideRepository(repositoryRoot, destinationRoot, { allowMissing: true });
} catch (error) {
  fail(error.message);
}

let destination = path.join(destinationRoot, modelId);
try {
  destination = assertInsideRepository(repositoryRoot, destination, { allowMissing: true });
} catch (error) {
  fail(error.message);
}
if (fs.existsSync(destination)) fail(`destination already exists: ${path.relative(repositoryRoot, destination)}`);

let builderTemplate = manualBuilderTemplate();
if (options.templatePlan !== null) {
  try {
    const templatePlanPath = assertInsideRepository(repositoryRoot, path.resolve(options.templatePlan));
    builderTemplate = readBuilderTemplatePlan(templatePlanPath);
  } catch (error) {
    fail(`cannot load template plan: ${error.message}`);
  }
}

let renderedPackage;
try {
  renderedPackage = preloadPackage(modelId, displayName, builderTemplate);
} catch (error) {
  fail(`cannot load scaffold resources: ${error.message}`);
}

try {
  writePackageAtomically({ destinationRoot, destination, modelId, renderedPackage });
} catch (error) {
  fail(error.message);
}

console.log(`Created ${path.relative(repositoryRoot, destination)} without changing the launch-model registry.`);

function validateModelId(value) {
  if (value.length > MAX_MODEL_ID_LENGTH) {
    fail(`model id must be at most ${MAX_MODEL_ID_LENGTH} characters`);
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    fail("model id must use lowercase kebab-case");
  }
}

function normalizeModelName(value, id) {
  if (value === null) return id.split("-").map((word) => word[0].toUpperCase() + word.slice(1)).join(" ");
  if (hasForbiddenInvisibleOrBidi(value)) {
    fail("model name must not contain invisible, control, private-use, noncharacter or bidirectional formatting characters");
  }
  const normalized = value.trim();
  if (normalized.length === 0) fail("model name must not be empty");
  if (normalized.length > MAX_MODEL_NAME_LENGTH) {
    fail(`model name must be at most ${MAX_MODEL_NAME_LENGTH} characters`);
  }
  return normalized;
}

function preloadPackage(id, name, builderTemplate) {
  const rendered = new Map();
  for (const file of templateFiles) {
    const source = fs.readFileSync(path.join(templateRoot, file), "utf8");
    if (source.length === 0) throw new Error(`${file} is empty`);
    rendered.set(
      file,
      source
        .replaceAll("{{MODEL_ID}}", id)
        .replaceAll("{{MODEL_NAME}}", name)
        .replaceAll("{{MODEL_SUMMARY}}", "Describe the model in one concrete sentence before implementation begins.")
    );
  }

  const submission = JSON.parse(fs.readFileSync(path.join(templateRoot, "submission.example.json"), "utf8"));
  if (!submission || typeof submission !== "object" || Array.isArray(submission) || !submission.model || typeof submission.model !== "object") {
    throw new Error("submission.example.json is not a valid submission template");
  }
  submission.$schema = "urn:programmable:v4-hook-submission:1.5.0";
  submission.model.id = id;
  submission.model.name = name;
  submission.model.category = categoryForTemplate(builderTemplate);
  submission.builderTemplate = builderTemplate;
  submission.publicMetadata.localDiscoveryTags = builderTemplate.source === "catalog"
    ? [...builderTemplate.templateSelection.ownerProvidedLocalTags]
    : [];
  rendered.set("submission.json", `${JSON.stringify(submission, null, 2)}\n`);
  return rendered;
}

function categoryForTemplate(builderTemplate) {
  if (builderTemplate.source !== "catalog") return "other";
  return ({
    "ordinary-launch": "permissionless-token",
    "custom-token-standard-fee-hook": "permissionless-token-with-mechanics",
    "custom-hook": "custom-hook-project",
    "blank-custom": "other"
  })[builderTemplate.templateSelection.starterId] ?? "other";
}

function readBuilderTemplatePlan(filePath) {
  if (path.basename(filePath) !== "programmable-template.json") {
    throw new Error("--template-plan must point to a materialized programmable-template.json");
  }
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > MAX_TEMPLATE_PLAN_BYTES) {
    throw new Error("template plan must be a bounded regular file");
  }
  const bytes = fs.readFileSync(filePath);
  let source;
  try {
    source = strictUtf8.decode(bytes);
  } catch {
    throw new Error("template plan is not valid UTF-8");
  }
  if (source.startsWith("\ufeff")) throw new Error("template plan has a forbidden byte-order mark");
  let plan;
  try {
    plan = JSON.parse(source);
  } catch {
    throw new Error("template plan is not valid JSON");
  }
  return builderTemplateFromPlan(plan);
}

function writePackageAtomically({ destinationRoot: root, destination: target, modelId: id, renderedPackage: files }) {
  fs.mkdirSync(root, { recursive: true });
  const lockPath = path.join(root, `.${id}.scaffold.lock`);
  let lock = null;
  let staging = null;
  try {
    try {
      lock = fs.openSync(lockPath, "wx");
    } catch (error) {
      if (error.code === "EEXIST") throw new Error(`another scaffold operation is already creating ${id}`);
      throw error;
    }
    if (fs.existsSync(target)) throw new Error(`destination already exists: ${path.relative(repositoryRoot, target)}`);

    staging = fs.mkdtempSync(path.join(root, `.${id}.staging-`));
    for (const [file, contents] of files) {
      fs.writeFileSync(path.join(staging, file), contents, { flag: "wx" });
    }
    if (fs.existsSync(target)) throw new Error(`destination already exists: ${path.relative(repositoryRoot, target)}`);
    fs.renameSync(staging, target);
    staging = null;
  } finally {
    if (staging && fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
    if (lock !== null) fs.closeSync(lock);
    if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
  }
}

function fail(message) {
  console.error(`scaffold-submission: ${message}`);
  process.exit(2);
}
