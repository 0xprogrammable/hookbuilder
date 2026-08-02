#!/usr/bin/env node

import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseCliOrExit } from "./cli-args.mjs";
import {
  isSafeGitReference,
  isSupportedGitHubRepositoryUrl,
  parseCanonicalProvenanceScalar,
  validateAgainstSchema
} from "./submission-core.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const canonicalSkillRoot = path.resolve(scriptDirectory, "..");
const errors = [];
const { options } = parseCliOrExit({
  command: "verify-skill.mjs",
  usage: "verify-skill.mjs [--installed] [--skill-root <path> --untrusted-data]",
  summary: "Validate the portable skill package, bundled resources and deterministic tooling.",
  options: [
    { name: "--installed", key: "installed", type: "boolean", description: "Run the portable installed-package checks without repository-coupled fixtures." },
    { name: "--skill-root", key: "skillRoot", type: "value", valueName: "path", description: "Validate a skill package at this path." },
    { name: "--untrusted-data", key: "untrustedData", type: "boolean", description: "Treat the selected package as data and do not execute its scripts or tests." }
  ],
  positionals: { min: 0, max: 0 }
});
const installedMode = options.installed;
const untrustedDataMode = options.untrustedData;
if (installedMode && untrustedDataMode) {
  console.error("verify-skill.mjs: --installed and --untrusted-data cannot be combined");
  process.exit(2);
}
let skillRoot = canonicalSkillRoot;
if (options.skillRoot) {
  const requestedRoot = path.resolve(options.skillRoot);
  try {
    skillRoot = resolveSkillRootWithoutSymlinks(requestedRoot);
  } catch (error) {
    console.error(`verify-skill.mjs: ${error.message}`);
    process.exit(2);
  }
}
if (skillRoot !== canonicalSkillRoot && !untrustedDataMode) {
  console.error("verify-skill.mjs: a non-canonical --skill-root requires --untrusted-data");
  process.exit(2);
}
const packageTree = walk(skillRoot);
const packageSymlinks = packageTree
  .filter((entry) => entry.stat.isSymbolicLink())
  .map((entry) => `symbolic links are not allowed: ${relative(entry.path)}`);
if (packageSymlinks.length > 0) {
  for (const error of [...new Set(packageSymlinks)].sort()) console.error(`- ${error}`);
  process.exit(1);
}
const transientDirectories = packageTree
  .filter((entry) => entry.stat.isDirectory() && isForbiddenPortableDirectory(relative(entry.path)))
  .map((entry) => relative(entry.path));
if (transientDirectories.length > 0) {
  for (const directory of [...new Set(transientDirectories)].sort()) {
    console.error(`- transient build or staging directory is not portable: ${directory}`);
  }
  process.exit(1);
}
const packageEntriesByPath = new Map(packageTree.map((entry) => [relative(entry.path), entry]));
const packageEntries = packageTree.filter((entry) => entry.stat.isFile());
const packageFiles = packageEntries.map((entry) => entry.path);

const required = [
  "SKILL.md",
  "LICENSE.txt",
  "THIRD_PARTY_NOTICES.md",
  "agents/openai.yaml",
  "references/agent-entry-and-application.md",
  "references/application-api.schema.json",
  "references/build-profiles.md",
  "references/compatibility-standard.md",
  "references/intake-playbook.md",
  "references/knowledge-routing.json",
  "references/companion-manifests.md",
  "references/companion-manifest-v2.schema.json",
  "references/deployment-snapshot.json",
  "references/github-public-source-contract-v1.json",
  "references/github-public-source-contract-v1.schema.json",
  "references/github-application-journey.md",
  "references/official-launchpad-deployments.json",
  "references/official-model-patterns.md",
  "references/output-contract.md",
  "references/programmable-fee-policy.md",
  "references/public-pr-application.schema.json",
  "references/routing-and-discovery.md",
  "references/runtime-assets-v1.schema.json",
  "references/runtime-assets.md",
  "references/scenario-matrix.md",
  "references/security-and-evidence.md",
  "references/standard-fee-kernel.md",
  "references/submission-workflow.md",
  "references/submission.schema.json",
  "references/upstream-sources.json",
  "references/upstream-sources.md",
  "references/upgrades-and-release.md",
  "references/v4-sdk-integration.md",
  "references/v4-hook-lego.md",
  "references/v4-liquidity-and-state.md",
  "references/v4-protocol-mechanics.md",
  "references/workflow.md",
  "references/template-catalog.md",
  "assets/build-profiles/catalog.json",
  "assets/examples/README.md",
  "assets/examples/dynamic-lp-fee.json",
  "assets/examples/managed-usdc-quote.json",
  "assets/examples/transparent-pool-scoped-fee.json",
  "assets/examples/unsafe-hidden-curve.json",
  "assets/templates/submission.example.json",
  "assets/templates/no-hook-architecture.example.json",
  "assets/templates/token-mechanics.example.json",
  "assets/templates/runtime-assets.example.json",
  "assets/templates/companion-closure-workflow.yml",
  "assets/templates/companion-manifest-v2.example.json",
  "assets/templates/deployment-evidence.example.json",
  "assets/templates/dependency-lock.example.json",
  "assets/templates/gate-status.example.json",
  "assets/templates/release-candidate.example.json",
  "assets/templates/PROPOSAL.md",
  "assets/templates/THREAT_MODEL.md",
  "assets/templates/TEST_PLAN.md",
  "assets/templates/EVIDENCE.md",
  "assets/templates/lifecycle/installed-state.TEST-ONLY.example.json",
  "assets/templates/lifecycle/migration-current-document.example.json",
  "assets/templates/lifecycle/migration-proposal.example.json",
  "assets/templates/lifecycle/release-candidate.critical-hotfix.caller-declared.example.json",
  "assets/templates/lifecycle/release-history.caller-declared.example.json",
  "assets/templates/lifecycle/signed-update.TEST-ONLY.example.json",
  "assets/templates/lifecycle/trusted-pin.TEST-ONLY.example.json",
  "assets/starter-catalog/catalog.json",
  "assets/reference-kernels/programmable-volume-fee-v1/README.md",
  "assets/reference-kernels/programmable-volume-fee-v1/SECURITY_PROPERTIES.md",
  "assets/reference-kernels/programmable-volume-fee-v1/evidence/fee-conformance-evidence.example.json",
  "assets/reference-kernels/programmable-volume-fee-v1/foundry.toml",
  "assets/reference-kernels/programmable-volume-fee-v1/package-lock.json",
  "assets/reference-kernels/programmable-volume-fee-v1/package.json",
  "assets/reference-kernels/programmable-volume-fee-v1/remappings.txt",
  "assets/reference-kernels/programmable-volume-fee-v1/src/ProgrammableVolumeFeeHookFactoryV1.sol",
  "assets/reference-kernels/programmable-volume-fee-v1/src/ProgrammableVolumeFeeHookV1.sol",
  "assets/reference-kernels/programmable-volume-fee-v1/test/MockReferenceToken.sol",
  "assets/reference-kernels/programmable-volume-fee-v1/test/ProgrammableVolumeFeeHookV1.t.sol",
  "scripts/build-info-core.mjs",
  "scripts/build-profile-core.mjs",
  "scripts/build-profile.mjs",
  "scripts/build-review-target.mjs",
  "scripts/builder-lifecycle-core.mjs",
  "scripts/builder-lifecycle.mjs",
  "scripts/builder-template-contract.mjs",
  "scripts/cli-args.mjs",
  "scripts/cli-central-base.mjs",
  "scripts/cli-central-package.mjs",
  "scripts/companion-manifest-contract.mjs",
  "scripts/cli-github-source.mjs",
  "scripts/cli-local-draft.mjs",
  "scripts/cli-output-dir.mjs",
  "scripts/cli-prepare-pr.mjs",
  "scripts/cli-review-target.mjs",
  "scripts/cli-runtime.mjs",
  "scripts/cli.mjs",
  "scripts/check-upstream-drift.mjs",
  "scripts/closure-report-core.mjs",
  "scripts/deployment-core.mjs",
  "scripts/example-materializer-core.mjs",
  "scripts/fee-conformance-core.mjs",
  "scripts/fee-conformance.mjs",
  "scripts/generate-public-pr-application-schema.mjs",
  "scripts/github-exact-object-resolver.mjs",
  "scripts/github-public-source-core.mjs",
  "scripts/github-application-core.mjs",
  "scripts/github-application.mjs",
  "scripts/knowledge-router-core.mjs",
  "scripts/knowledge-router.mjs",
  "scripts/materialize-example.mjs",
  "scripts/metadata-core.mjs",
  "scripts/official-launchpad-core.mjs",
  "scripts/package-dependency-contract.mjs",
  "scripts/project-surfaces-core.mjs",
  "scripts/public-claims-core.mjs",
  "scripts/repository-root.mjs",
  "scripts/resolve-deployment.mjs",
  "scripts/review-target-contract.mjs",
  "scripts/review-target-core.mjs",
  "scripts/runtime-assets-core.mjs",
  "scripts/scaffold-submission.mjs",
  "scripts/submission-core.mjs",
  "scripts/template-catalog-core.mjs",
  "scripts/template-catalog.mjs",
  "scripts/test/application-api-schema.test.mjs",
  "scripts/test/build-info.test.mjs",
  "scripts/test/build-profile.test.mjs",
  "scripts/test/builder-lifecycle.test.mjs",
  "scripts/test/cli-central-base.test.mjs",
  "scripts/test/cli-central-package.test.mjs",
  "scripts/test/companion-manifest-v2.test.mjs",
  "scripts/test/cli-entry.test.mjs",
  "scripts/test/cli-output-dir.test.mjs",
  "scripts/test/cli-prepare-pr.test.mjs",
  "scripts/test/cli.test.mjs",
  "scripts/test/cross-chain-policy.test.mjs",
  "scripts/test/example-materializer.test.mjs",
  "scripts/test/github-exact-object-resolver.test.mjs",
  "scripts/test/github-public-source-core.test.mjs",
  "scripts/test/golden-scenarios.test.mjs",
  "scripts/test/fee-conformance.test.mjs",
  "scripts/test/github-application.test.mjs",
  "scripts/test/knowledge-router.test.mjs",
  "scripts/test/official-launchpad.test.mjs",
  "scripts/test/package-dependency-contract.test.mjs",
  "scripts/test/policy-bundle.test.mjs",
  "scripts/test/project-surfaces.test.mjs",
  "scripts/test/public-claims.test.mjs",
  "scripts/test/review-target-contract.test.mjs",
  "scripts/test/review-target.test.mjs",
  "scripts/test/runtime-assets-core.test.mjs",
  "scripts/test/schema-security.test.mjs",
  "scripts/test/submission.test.mjs",
  "scripts/test/template-catalog.test.mjs",
  "scripts/test/upstream-drift.test.mjs",
  "scripts/test/verify-package-build-info.test.mjs",
  "scripts/test/verify-skill-static.test.mjs",
  "scripts/validate-submission.mjs",
  "scripts/verify-package.mjs",
  "scripts/verify-skill.mjs",
  "scripts/doctor.mjs"
];

for (const relativePath of required) {
  const entry = packageEntriesByPath.get(relativePath);
  if (!entry?.stat.isFile()) errors.push(`missing ${relativePath}`);
}

const packageBytes = packageEntries.reduce((total, entry) => total + entry.stat.size, 0);
if (packageFiles.length > 256) errors.push(`portable package has ${packageFiles.length} files; keep it at or below 256`);
if (packageBytes > 8_000_000) errors.push(`portable package is ${packageBytes} bytes; keep it at or below 8000000`);
for (const entry of packageEntries) {
  if (entry.stat.size > 1_000_000) errors.push(`${relative(entry.path)} exceeds the 1000000-byte per-file limit`);
}
if (errors.length > 0) failWithErrors(errors);

const skill = read("SKILL.md");
const rawSkillLineCount = skill.split("\n").length;
let lineCount = rawSkillLineCount;
const frontmatter = skill.match(/^---\n([\s\S]*?)\n---\n/);
let parsedSkillFrontmatter = null;
if (!frontmatter) {
  errors.push("SKILL.md frontmatter is missing");
} else {
  const parsed = parseCanonicalYamlMapping(frontmatter[1], "SKILL.md frontmatter", {
    name: { type: "string", required: true },
    description: { type: "string", required: true },
    license: { type: "string" },
    metadata: {
      type: "mapping",
      fields: installedMode
        ? {
            "github-path": { type: "provenance-string" },
            "github-pinned": { type: "provenance-string" },
            "github-ref": { type: "provenance-string" },
            "github-repo": { type: "provenance-string" },
            "github-tree-sha": { type: "provenance-string" },
            "local-path": { type: "provenance-string" }
          }
        : {
            "short-description": { type: "string" }
          }
    }
  }, {
    childIndentation: installedMode ? 4 : 2
  });
  parsedSkillFrontmatter = parsed;
  errors.push(...parsed.errors);
  if (parsed.errors.length === 0) {
    // gh skill adds installer provenance to frontmatter. Keep the instruction
    // budget identical before and after installation instead of charging those
    // trusted metadata lines against the portable skill body.
    if (installedMode && Object.hasOwn(parsed.value, "metadata")) {
      lineCount -= Object.keys(parsed.value.metadata).length + 1;
    }
    const packageName = path.basename(skillRoot);
    const declaredName = parsed.value.name;
    if (declaredName !== packageName) errors.push(`SKILL.md name must match the package directory: expected ${packageName}`);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(declaredName) || declaredName.length > 64) {
      errors.push("SKILL.md frontmatter: name must be 1-64 characters of lowercase letters, digits and single hyphens");
    }
    if (parsed.value.description.length > 1024 || /[<>]/.test(parsed.value.description)) {
      errors.push("SKILL.md frontmatter: description must be at most 1024 characters and may not contain angle brackets");
    }
    if (installedMode && Object.hasOwn(parsed.value, "metadata")) {
      errors.push(...validateInstalledProvenance(parsed.value.metadata, declaredName));
    }
  }
}
if (lineCount > 500) errors.push(`SKILL.md has ${lineCount} instruction lines; keep the portable instructions below 500`);

for (const textPath of packageFiles.filter((entry) => /\.(?:json|md|mjs|js|ts|sol|toml|txt|ya?ml|sh)$/i.test(entry))) {
  const source = fs.readFileSync(textPath, "utf8");
  const portableSource = installedMode && relative(textPath) === "SKILL.md"
    ? redactInstalledLocalPathForPortableScan(source, parsedSkillFrontmatter)
    : source;
  const localFileScheme = ["file", "://"].join("");
  const macHome = ["", "Users", "[A-Za-z0-9._-]+", ""].join("/");
  const linuxHome = ["", "home", "[A-Za-z0-9._-]+", ""].join("/");
  const windowsHome = ["[A-Za-z]:", "Users", "[^\\\\\\s]+", ""].join("\\\\");
  const localPathPatterns = [
    new RegExp(macHome),
    new RegExp(linuxHome),
    new RegExp(windowsHome)
  ];
  if (portableSource.includes(localFileScheme) || localPathPatterns.some((pattern) => pattern.test(portableSource))) {
    errors.push(`${relative(textPath)}: portable package contains a local filesystem path`);
  }
}

const interfaceConfig = read("agents/openai.yaml");
const parsedInterface = parseCanonicalYamlMapping(interfaceConfig, "agents/openai.yaml", {
  interface: {
    type: "mapping",
    required: true,
    fields: {
      display_name: { type: "quoted-string", required: true },
      short_description: { type: "quoted-string", required: true },
      icon_small: { type: "quoted-string" },
      icon_large: { type: "quoted-string" },
      brand_color: { type: "quoted-string" },
      default_prompt: { type: "quoted-string", required: true }
    }
  }
});
errors.push(...parsedInterface.errors);
if (parsedInterface.errors.length === 0) {
  const interfaceValues = parsedInterface.value.interface;
  if (!interfaceValues.default_prompt.includes("$programmable-v4-hook-builder")) {
    errors.push("agents/openai.yaml: default_prompt must invoke $programmable-v4-hook-builder");
  }
  if (interfaceValues.short_description.length < 25 || interfaceValues.short_description.length > 64) {
    errors.push("agents/openai.yaml: short_description must be 25-64 characters");
  }
}

for (const markdownPath of packageFiles.filter((entry) => entry.endsWith(".md"))) {
  const source = fs.readFileSync(markdownPath, "utf8");
  for (const match of source.matchAll(/!?\[[^\]]*]\(([^)]+)\)/g)) {
    const target = match[1].trim();
    if (!target || target.startsWith("#") || /^https?:\/\//.test(target) || target.startsWith("mailto:")) continue;
    const pathOnly = decodeURIComponent(target.split("#", 1)[0].split("?", 1)[0]);
    const absolute = path.resolve(path.dirname(markdownPath), pathOnly);
    if (!isInside(skillRoot, absolute) || !packageEntriesByPath.has(relative(absolute))) {
      errors.push(`${relative(markdownPath)}: missing or escaping link ${target}`);
    }
  }
}

try {
  const candidateSchema = JSON.parse(read("references/submission.schema.json"));
  const schema = untrustedDataMode
    ? JSON.parse(fs.readFileSync(path.join(canonicalSkillRoot, "references", "submission.schema.json"), "utf8"))
    : candidateSchema;
  const example = JSON.parse(read("assets/templates/submission.example.json"));
  const schemaFindings = validateAgainstSchema(example, schema);
  for (const finding of schemaFindings) errors.push(`template ${finding.path}: ${finding.message}`);
  const legacyNoHookExample = JSON.parse(read("assets/templates/no-hook-architecture.example.json"));
  const legacyNoHookSubmission = structuredClone(example);
  legacyNoHookSubmission.noHookArchitecture = legacyNoHookExample;
  const legacyNoHookFindings = validateAgainstSchema(legacyNoHookSubmission, schema);
  for (const finding of legacyNoHookFindings) errors.push(`legacy no-hook template ${finding.path}: ${finding.message}`);
  const tokenMechanicsExample = JSON.parse(read("assets/templates/token-mechanics.example.json"));
  const tokenMechanicsSubmission = structuredClone(example);
  tokenMechanicsSubmission.tokenMechanics = tokenMechanicsExample;
  const tokenMechanicsFindings = validateAgainstSchema(tokenMechanicsSubmission, schema);
  for (const finding of tokenMechanicsFindings) errors.push(`token mechanics template ${finding.path}: ${finding.message}`);
} catch (error) {
  errors.push(`schema or template JSON: ${error.message}`);
}

try {
  const runtimeSchema = JSON.parse(read("references/runtime-assets-v1.schema.json"));
  const runtimeExample = JSON.parse(read("assets/templates/runtime-assets.example.json"));
  const runtimeFindings = validateAgainstSchema(runtimeExample, runtimeSchema);
  for (const finding of runtimeFindings) errors.push(`runtime asset template ${finding.path}: ${finding.message}`);
} catch (error) {
  errors.push(`runtime asset schema or template JSON: ${error.message}`);
}

validateStarterCatalogClosure(errors);
validateKnowledgeRoutingClosure(errors);
validateLocalModuleClosure(errors);

try {
  const sources = JSON.parse(read("references/upstream-sources.json"));
  scanPins(sources, "$", errors);
} catch (error) {
  errors.push(`upstream-sources.json: ${error.message}`);
}

try {
  const deploymentSnapshot = JSON.parse(read("references/deployment-snapshot.json"));
  scanPins(deploymentSnapshot.source, "$.deploymentSnapshot.source", errors);
  const ids = new Set();
  for (const record of deploymentSnapshot.records ?? []) {
    if (ids.has(record.id)) errors.push(`deployment-snapshot.json: duplicate record id ${record.id}`);
    ids.add(record.id);
  }
} catch (error) {
  errors.push(`deployment-snapshot.json: ${error.message}`);
}

for (const script of walk(path.join(skillRoot, "scripts")).filter((entry) => entry.stat.isFile() && entry.path.endsWith(".mjs")).map((entry) => entry.path)) {
  const result = childProcess.spawnSync(process.execPath, ["--check", script], { encoding: "utf8", shell: false });
  if (result.status !== 0) errors.push(`${relative(script)}: ${result.stderr.trim()}`);
}

const testDirectory = path.join(skillRoot, "scripts", "test");
if (!untrustedDataMode) {
  const testFiles = fs.readdirSync(testDirectory)
    .filter((name) => name.endsWith(".test.mjs") && (!installedMode || name === "cli.test.mjs"))
    .sort()
    .map((name) => path.join(testDirectory, name));
  const tests = childProcess.spawnSync(process.execPath, ["--test", ...testFiles], { encoding: "utf8", shell: false });
  if (tests.status !== 0) errors.push(`deterministic tests failed:\n${tests.stdout}${tests.stderr}`.trim());
}

if (errors.length > 0) {
  failWithErrors(errors);
}

if (untrustedDataMode) {
  console.log(`Validated candidate skill structure, schema, links, Git pin shapes and script syntax without executing candidate scripts or tests; SKILL.md has ${lineCount} lines.`);
} else {
  console.log(`Validated portable skill structure, schema, links, Git pin shapes, deterministic CLI checks${installedMode ? "" : " and repository fixture tests"} and ${lineCount}-line SKILL.md.`);
}

function scanPins(value, currentPath, pinErrors) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => scanPins(entry, `${currentPath}[${index}]`, pinErrors));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (/(commit|revision|sourceCommit|sourceTree)$/i.test(key) && child !== null && (typeof child !== "string" || !/^[a-fA-F0-9]{40}$/.test(child))) {
      pinErrors.push(`${currentPath}.${key}: expected an exact 40-character Git object id`);
    }
    scanPins(child, `${currentPath}.${key}`, pinErrors);
  }
}

function validateStarterCatalogClosure(findings) {
  const catalogRelativePath = "assets/starter-catalog/catalog.json";
  let catalog;
  try {
    catalog = JSON.parse(read(catalogRelativePath));
  } catch (error) {
    findings.push(`${catalogRelativePath}: ${error.message}`);
    return;
  }
  if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) {
    findings.push(`${catalogRelativePath}: expected an object`);
    return;
  }
  if (catalog.schemaVersion !== "1.0.0" || catalog.kind !== "programmable-starter-catalog") {
    findings.push(`${catalogRelativePath}: unsupported schemaVersion or kind`);
  }
  if (!Array.isArray(catalog.entries) || catalog.entries.length === 0) {
    findings.push(`${catalogRelativePath}: entries must be a non-empty array`);
    return;
  }

  const listedPaths = new Set();
  const listedIds = new Map();
  for (const [index, entry] of catalog.entries.entries()) {
    const label = `${catalogRelativePath}: entries[${index}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      findings.push(`${label} must be an object`);
      continue;
    }
    if (typeof entry.id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.id)) {
      findings.push(`${label}.id must be kebab-case`);
    } else if (listedIds.has(entry.id)) {
      findings.push(`${label}.id duplicates ${entry.id}`);
    } else {
      listedIds.set(entry.id, entry.kind);
    }
    if (entry.kind !== "starter" && entry.kind !== "pack") {
      findings.push(`${label}.kind must be starter or pack`);
      continue;
    }
    const expectedPrefix = entry.kind === "starter" ? "starters/" : "packs/";
    if (!isSafeCatalogMemberPath(entry.path, expectedPrefix)) {
      findings.push(`${label}.path must be a normalized ${expectedPrefix} JSON path`);
      continue;
    }
    if (listedPaths.has(entry.path)) {
      findings.push(`${label}.path duplicates ${entry.path}`);
      continue;
    }
    listedPaths.add(entry.path);
    const memberRelativePath = `assets/starter-catalog/${entry.path}`;
    const memberEntry = packageEntriesByPath.get(memberRelativePath);
    if (!memberEntry?.stat.isFile()) {
      findings.push(`${catalogRelativePath}: missing catalog member ${memberRelativePath}`);
      continue;
    }
    if (typeof entry.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(entry.sha256)) {
      findings.push(`${label}.sha256 must be a lowercase SHA-256 digest`);
    } else {
      const actualDigest = crypto.createHash("sha256").update(fs.readFileSync(memberEntry.path)).digest("hex");
      if (actualDigest !== entry.sha256) {
        findings.push(`${catalogRelativePath}: digest mismatch for ${memberRelativePath}`);
      }
    }
    try {
      const member = JSON.parse(fs.readFileSync(memberEntry.path, "utf8"));
      if (member.id !== entry.id || member.kind !== entry.kind || member.schemaVersion !== "1.0.0") {
        findings.push(`${catalogRelativePath}: identity mismatch for ${memberRelativePath}`);
      }
    } catch (error) {
      findings.push(`${memberRelativePath}: ${error.message}`);
    }
  }

  for (const mandatoryId of catalog.mandatoryPacks ?? []) {
    if (listedIds.get(mandatoryId) !== "pack") {
      findings.push(`${catalogRelativePath}: mandatory pack ${mandatoryId} is not a listed pack`);
    }
  }

  const actualMemberPaths = packageEntries
    .map((entry) => relative(entry.path))
    .filter((entryPath) => /^assets\/starter-catalog\/(?:packs|starters)\/[^/]+\.json$/.test(entryPath))
    .map((entryPath) => entryPath.slice("assets/starter-catalog/".length));
  for (const memberPath of actualMemberPaths) {
    if (!listedPaths.has(memberPath)) {
      findings.push(`${catalogRelativePath}: unlisted catalog member assets/starter-catalog/${memberPath}`);
    }
  }
}

function validateKnowledgeRoutingClosure(findings) {
  const routingRelativePath = "references/knowledge-routing.json";
  let routing;
  try {
    routing = JSON.parse(read(routingRelativePath));
  } catch (error) {
    findings.push(`${routingRelativePath}: ${error.message}`);
    return;
  }
  if (
    routing?.schemaVersion !== "1.0.0"
    || routing?.kind !== "programmable-knowledge-routing"
    || routing?.policy?.selectionSemantics !== "minimum-sufficient-progressive-context"
    || routing?.policy?.unknownCapabilityOutcome !== "preserve-and-route-to-architecture-review"
    || routing?.policy?.automaticAdverseDecision !== false
    || routing?.policy?.networkAccess !== "forbidden"
    || routing?.policy?.estimatedTokenAlgorithm !== "ceil-utf8-bytes-divided-by-four"
  ) {
    findings.push(`${routingRelativePath}: identity or non-adverse offline policy is invalid`);
  }

  const expectedModes = ["explore", "handoff", "preflight", "prototype", "repair", "review", "submit"];
  const actualModes = Object.keys(routing?.modes ?? {}).sort();
  if (actualModes.length !== expectedModes.length || actualModes.some((mode, index) => mode !== expectedModes[index])) {
    findings.push(`${routingRelativePath}: exactly seven builder modes are required`);
  }
  const references = [];
  for (const [mode, profile] of Object.entries(routing?.modes ?? {})) {
    if (!Array.isArray(profile?.initial) || profile.initial.length < 1 || !Array.isArray(profile?.later)) {
      findings.push(`${routingRelativePath}: mode ${mode} is incomplete`);
      continue;
    }
    references.push(...profile.initial);
    for (const deferred of profile.later) {
      if (typeof deferred?.trigger !== "string" || deferred.trigger.length < 12 || deferred.trigger.length > 500) {
        findings.push(`${routingRelativePath}: mode ${mode} has an invalid deferred trigger`);
      }
      references.push(deferred?.reference);
    }
  }
  for (const [label, routes] of [
    ["capability", routing?.capabilityRoutes],
    ["surface", routing?.surfaceRoutes]
  ]) {
    if (!Array.isArray(routes) || routes.length < 1 || routes.length > 64) {
      findings.push(`${routingRelativePath}: ${label} routes are invalid`);
      continue;
    }
    const routeIds = new Set();
    for (const route of routes) {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(route?.id ?? "") || routeIds.has(route?.id)) {
        findings.push(`${routingRelativePath}: ${label} route identity is invalid`);
      }
      routeIds.add(route?.id);
      if (!Array.isArray(route?.matches) || route.matches.length < 1 || !Array.isArray(route?.references) || route.references.length < 1) {
        findings.push(`${routingRelativePath}: ${label} route ${route?.id ?? "unknown"} is incomplete`);
      }
      for (const id of route?.matches ?? []) {
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) findings.push(`${routingRelativePath}: ${label} route ${route?.id ?? "unknown"} has an unsafe match id`);
      }
      references.push(...(route?.references ?? []));
    }
  }
  if (!Array.isArray(routing?.unknownCapabilityReferences) || routing.unknownCapabilityReferences.length < 1) {
    findings.push(`${routingRelativePath}: unknown capability fallback is missing`);
  } else {
    references.push(...routing.unknownCapabilityReferences);
  }
  for (const reference of references) {
    if (typeof reference !== "string" || !/^[a-z0-9]+(?:[-.][a-z0-9]+)*\.(?:md|json)$/.test(reference)) {
      findings.push(`${routingRelativePath}: unsafe reference ${String(reference)}`);
      continue;
    }
    const target = `references/${reference}`;
    if (!packageEntriesByPath.get(target)?.stat.isFile()) findings.push(`${routingRelativePath}: missing routed reference ${target}`);
  }
}

function validateLocalModuleClosure(findings) {
  // Validate the portable runtime modules. Tests deliberately contain hostile
  // import-like fixture strings and repository-relative integration imports;
  // their own required-file closure is enforced by the explicit list above.
  const modulePaths = packageFiles.filter((entry) => /^scripts\/[^/]+\.mjs$/.test(relative(entry)));
  const specifierPattern = /(?:\bfrom\s*|\bimport\s*\()\s*["'](\.{1,2}\/[^"']+)["']/g;
  for (const modulePath of modulePaths) {
    const source = fs.readFileSync(modulePath, "utf8");
    for (const match of source.matchAll(specifierPattern)) {
      const target = path.resolve(path.dirname(modulePath), match[1]);
      if (!isInside(skillRoot, target)) {
        findings.push(`${relative(modulePath)}: local module import escapes the skill: ${match[1]}`);
        continue;
      }
      const importedPath = relative(target);
      if (!packageEntriesByPath.get(importedPath)?.stat.isFile()) {
        findings.push(`${relative(modulePath)}: missing local module import ${importedPath}`);
      }
    }
  }
}

function isSafeCatalogMemberPath(candidate, expectedPrefix) {
  if (typeof candidate !== "string" || !candidate.startsWith(expectedPrefix) || !candidate.endsWith(".json")) {
    return false;
  }
  if (candidate.includes("\\") || path.posix.isAbsolute(candidate)) return false;
  const segments = candidate.split("/");
  return segments.length === 2 && segments.every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function parseCanonicalYamlMapping(source, documentName, shape, { childIndentation = 2 } = {}) {
  const findings = [];
  const result = Object.create(null);
  const seenRootKeys = new Set();
  const seenChildKeys = new Map();
  let activeMapping = null;

  for (const [index, line] of source.split("\n").entries()) {
    const lineNumber = index + 1;
    if (line === "") continue;
    if (line.includes("\t") || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(line)) {
      findings.push(`${documentName}: line ${lineNumber} contains unsupported whitespace or control characters`);
      continue;
    }

    const indentation = line.match(/^ */)[0].length;
    if (indentation !== 0 && indentation !== childIndentation) {
      findings.push(`${documentName}: line ${lineNumber} must use zero or ${childIndentation} spaces of indentation`);
      continue;
    }
    const content = line.slice(indentation);
    const pair = content.match(/^([A-Za-z_][A-Za-z0-9_-]*):(.*)$/);
    if (!pair) {
      findings.push(`${documentName}: line ${lineNumber} is outside the supported YAML mapping subset`);
      continue;
    }

    const [, key, remainder] = pair;
    const parentShape = indentation === 0 ? shape : activeMapping?.field?.fields;
    const parentValue = indentation === 0 ? result : activeMapping?.value;
    const seenKeys = indentation === 0 ? seenRootKeys : seenChildKeys.get(activeMapping?.key);
    if (!parentShape || !parentValue || !seenKeys) {
      findings.push(`${documentName}: line ${lineNumber} has no valid parent mapping`);
      continue;
    }
    if (seenKeys.has(key)) {
      findings.push(`${documentName}: line ${lineNumber} duplicates key ${key}`);
      continue;
    }
    seenKeys.add(key);

    if (!Object.hasOwn(parentShape, key)) {
      findings.push(`${documentName}: line ${lineNumber} contains unsupported key ${key}`);
      continue;
    }
    const field = parentShape[key];

    if (field.type === "mapping") {
      if (indentation !== 0 || remainder !== "") {
        findings.push(`${documentName}: line ${lineNumber} requires ${key} to be a block mapping`);
        continue;
      }
      const value = Object.create(null);
      parentValue[key] = value;
      seenChildKeys.set(key, new Set());
      activeMapping = { key, field, value };
      continue;
    }

    if (!remainder.startsWith(" ") || remainder.length === 1 || remainder !== ` ${remainder.slice(1).trim()}`) {
      findings.push(`${documentName}: line ${lineNumber} requires one scalar value after ${key}:`);
      continue;
    }
    const scalar = parseCanonicalYamlString(remainder.slice(1), field.type);
    if (!scalar.ok) {
      findings.push(`${documentName}: line ${lineNumber} ${scalar.error}`);
      continue;
    }
    parentValue[key] = scalar.value;
    if (indentation === 0) activeMapping = null;
  }

  for (const [key, field] of Object.entries(shape)) {
    if (field.required && !Object.hasOwn(result, key)) {
      findings.push(`${documentName}: missing required key ${key}`);
    }
    if (field.type !== "mapping" || !Object.hasOwn(result, key)) continue;
    if (Object.keys(result[key]).length === 0) {
      findings.push(`${documentName}: mapping ${key} may not be empty`);
    }
    for (const [childKey, childField] of Object.entries(field.fields)) {
      if (childField.required && !Object.hasOwn(result[key], childKey)) {
        findings.push(`${documentName}: missing required key ${key}.${childKey}`);
      }
    }
  }

  return { value: result, errors: findings };
}

function validateInstalledProvenance(metadata, declaredName) {
  const findings = [];
  const keys = Object.keys(metadata).sort();
  const remoteRequired = ["github-path", "github-ref", "github-repo", "github-tree-sha"];
  const remoteAllowed = [...remoteRequired, "github-pinned"].sort();
  const isLocalProfile = keys.length === 1 && keys[0] === "local-path";
  const isRemoteProfile = keys.every((key) => remoteAllowed.includes(key))
    && remoteRequired.every((key) => keys.includes(key));

  if (!isLocalProfile && !isRemoteProfile) {
    findings.push(
      "SKILL.md frontmatter: installed metadata must be exactly local-path or the GitHub repository, ref, tree and path provenance fields"
    );
    return findings;
  }

  if (isLocalProfile) {
    const localPath = metadata["local-path"];
    findings.push(...validateProvenanceScalar("local-path", localPath, 4096));
    if (!path.posix.isAbsolute(localPath) && !path.win32.isAbsolute(localPath)) {
      findings.push("SKILL.md frontmatter: metadata.local-path must be an absolute filesystem path");
    }
    return findings;
  }

  for (const key of keys) {
    findings.push(...validateProvenanceScalar(key, metadata[key], key === "github-path" ? 1024 : 2048));
  }

  const githubPath = metadata["github-path"];
  const pathSegments = githubPath.split("/");
  if (
    githubPath.startsWith("/")
    || githubPath.endsWith("/")
    || githubPath.includes("\\")
    || pathSegments.some((segment) => segment === "" || segment === "." || segment === "..")
    || pathSegments.at(-1) !== declaredName
  ) {
    findings.push("SKILL.md frontmatter: metadata.github-path must be a normalized relative path ending in the skill name");
  }

  if (!isSupportedGitHubRepositoryUrl(metadata["github-repo"])) {
    findings.push("SKILL.md frontmatter: metadata.github-repo must be a canonical HTTPS GitHub repository URL");
  }
  if (!isSafeGitReference(metadata["github-ref"])) {
    findings.push("SKILL.md frontmatter: metadata.github-ref is not a bounded Git reference");
  }
  if (Object.hasOwn(metadata, "github-pinned") && !isSafeGitReference(metadata["github-pinned"])) {
    findings.push("SKILL.md frontmatter: metadata.github-pinned is not a bounded Git reference");
  }
  if (!/^[0-9a-f]{40}$/.test(metadata["github-tree-sha"])) {
    findings.push("SKILL.md frontmatter: metadata.github-tree-sha must be a lowercase 40-character Git object id");
  }

  return findings;
}

function validateProvenanceScalar(key, value, maximumBytes) {
  const findings = [];
  if (Buffer.byteLength(value, "utf8") > maximumBytes) {
    findings.push(`SKILL.md frontmatter: metadata.${key} exceeds the ${maximumBytes}-byte provenance limit`);
  }
  if (
    /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value)
    || [...value].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint >= 0xd800 && codePoint <= 0xdfff;
    })
  ) {
    findings.push(`SKILL.md frontmatter: metadata.${key} contains control, bidirectional or invalid Unicode characters`);
  }
  return findings;
}

function redactInstalledLocalPathForPortableScan(source, parsedFrontmatter) {
  if (
    !parsedFrontmatter
    || parsedFrontmatter.errors.length > 0
    || !Object.hasOwn(parsedFrontmatter.value, "metadata")
    || !Object.hasOwn(parsedFrontmatter.value.metadata, "local-path")
  ) {
    return source;
  }
  const block = source.match(/^---\n[\s\S]*?\n---\n/);
  if (!block) return source;
  const redactedBlock = block[0].replace(
    /^ {4}local-path:.*$/mu,
    "    local-path: installed-provenance"
  );
  return `${redactedBlock}${source.slice(block[0].length)}`;
}

function parseCanonicalYamlString(source, type) {
  if (type === "provenance-string") return parseCanonicalProvenanceScalar(source);
  if (source.startsWith('"')) {
    try {
      const value = JSON.parse(source);
      if (typeof value !== "string") return { ok: false, error: "requires a string value" };
      if (value.length === 0) return { ok: false, error: "requires a non-empty string value" };
      return { ok: true, value };
    } catch {
      return { ok: false, error: "contains an invalid double-quoted string" };
    }
  }
  if (type === "quoted-string") {
    return { ok: false, error: "requires a double-quoted string value" };
  }
  if (
    !/^[A-Za-z]/.test(source)
    || /^(?:null|true|false|yes|no|on|off)$/i.test(source)
    || /[\[\]{}]/.test(source)
    || /(?:^|\s)[!&*|>@`]/.test(source)
    || /(?:^|\s)#/.test(source)
    || /:\s|:$/.test(source)
  ) {
    return { ok: false, error: "contains a non-canonical plain string" };
  }
  return { ok: true, value: source };
}

function read(relativePath) {
  return fs.readFileSync(path.join(skillRoot, relativePath), "utf8");
}

function walk(directory) {
  const directoryStat = lstatOrNull(directory);
  if (!directoryStat || !directoryStat.isDirectory() || directoryStat.isSymbolicLink()) return [];
  const entries = [];
  for (const name of fs.readdirSync(directory)) {
    const target = path.join(directory, name);
    const stat = fs.lstatSync(target);
    entries.push({ path: target, stat });
    if (stat.isDirectory() && !stat.isSymbolicLink()) entries.push(...walk(target));
  }
  return entries;
}

function isForbiddenPortableDirectory(relativePath) {
  const fixedNames = new Set([".git", "node_modules", "out", "cache", "broadcast", "coverage"]);
  return relativePath.split("/").some((segment) => (
    fixedNames.has(segment)
    || /^\.[A-Za-z0-9._-]+\.(?:stage|tmp)-[0-9]+$/.test(segment)
  ));
}

function lstatOrNull(target) {
  try {
    return fs.lstatSync(target);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return null;
    throw error;
  }
}

function resolveSkillRootWithoutSymlinks(requestedRoot) {
  const trustedContainerInput = path.dirname(path.dirname(requestedRoot));
  const trustedContainerStat = lstatOrNull(trustedContainerInput);
  if (!trustedContainerStat?.isDirectory() || trustedContainerStat.isSymbolicLink()) {
    throw new Error(`skill root container is not a real directory: ${trustedContainerInput}`);
  }
  const trustedContainer = fs.realpathSync(trustedContainerInput);
  const relativeRoot = path.relative(trustedContainerInput, requestedRoot);
  if (relativeRoot === "" || relativeRoot.startsWith("..") || path.isAbsolute(relativeRoot)) {
    throw new Error(`skill root is not inside its trusted container: ${requestedRoot}`);
  }

  const segments = relativeRoot.split(path.sep);
  let current = trustedContainer;
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    const stat = lstatOrNull(current);
    const displayPath = segments.slice(0, index + 1).join("/");
    if (!stat) throw new Error(`skill root is not a directory: ${requestedRoot}`);
    if (stat.isSymbolicLink()) {
      if (index === segments.length - 1) throw new Error(`skill root may not be a symbolic link: ${requestedRoot}`);
      throw new Error(`skill root path contains a symbolic link: ${displayPath}`);
    }
    if (!stat.isDirectory()) throw new Error(`skill root path component is not a directory: ${displayPath}`);
  }
  return current;
}

function failWithErrors(messages) {
  for (const error of [...new Set(messages)].sort()) console.error(`- ${error}`);
  process.exit(1);
}

function relative(target) {
  return path.relative(skillRoot, target).replaceAll(path.sep, "/");
}

function isInside(parent, child) {
  const result = path.relative(parent, child);
  return result === "" || (!result.startsWith("..") && !path.isAbsolute(result));
}
