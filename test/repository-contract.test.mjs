import assert from "node:assert/strict";
import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  assertInsideRepository,
  isInside,
  safeRawGitArguments
} from "../skills/programmable-v4-hook-builder/scripts/repository-root.mjs";
import { parseBoundedLosslessJson } from "../skills/programmable-v4-hook-builder/scripts/github-public-source-core.mjs";
import {
  HOOKBUILDER_LEGACY_APPLICANT_BASE_BRANCH,
  HOOKBUILDER_LEGACY_APPLICANT_PULL_REQUESTS
} from "../skills/programmable-v4-hook-builder/scripts/registry-intake-contract.mjs";
import { assertMirroredFileMode } from "../scripts/plugin-payload-mode-core.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, "..");
const expectedTopLevel = [
  ".agents", ".claude-plugin", ".codex-plugin", ".editorconfig", ".gitattributes", ".github", ".gitignore", ".mcp.json",
  "AGENTS.md", "CHANGELOG.md", "CODE_OF_CONDUCT.md", "CONTRIBUTING.md", "GOVERNANCE.md", "LICENSE",
  "NOTICE.md", "README.md", "SECURITY.md", "SUPPORT.md", "assets", "config", "docs", "evals",
  "mcp", "package-lock.json", "package.json", "plugins", "scripts", "skills", "submissions", "test"
];
const forbiddenTransientDirectories = new Set(["node_modules", "coverage", "broadcast", "cache", "out"]);
const ignoredHostMetadataFiles = new Set([".DS_Store"]);

function visibleDirectoryRows(directory, rootDirectory = repositoryRoot) {
  const rows = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    if (directory === rootDirectory && entry.name === ".git") continue;
    const absolutePath = path.join(directory, entry.name);
    const stat = fs.lstatSync(absolutePath);
    if (ignoredHostMetadataFiles.has(entry.name) && stat.isFile()) continue;
    const relativePath = path.relative(rootDirectory, absolutePath).split(path.sep).join("/");
    rows.push({ absolutePath, relativePath, stat });
  }
  return rows;
}

function walk(directory, rootDirectory = repositoryRoot) {
  const rows = [];
  for (const row of visibleDirectoryRows(directory, rootDirectory)) {
    rows.push(row);
    if (
      row.stat.isDirectory()
      && !row.stat.isSymbolicLink()
      && !forbiddenTransientDirectories.has(path.basename(row.relativePath))
    ) rows.push(...walk(row.absolutePath, rootDirectory));
  }
  return rows;
}

test("repository containment accepts an in-root ..x name and rejects a real parent escape", (t) => {
  const container = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-containment-"));
  t.after(() => fs.rmSync(container, { recursive: true, force: true }));
  const repository = path.join(container, "repository");
  const insideDirectory = path.join(repository, "..x-project");
  const insideFile = path.join(insideDirectory, "artifact.json");
  const outsideFile = path.join(container, "outside.json");
  fs.mkdirSync(insideDirectory, { recursive: true });
  fs.writeFileSync(insideFile, "{}\n");
  fs.writeFileSync(outsideFile, "{}\n");

  assert.equal(isInside(repository, insideFile), true);
  assert.equal(assertInsideRepository(repository, insideFile), fs.realpathSync(insideFile));
  assert.equal(isInside(repository, outsideFile), false);
  assert.throws(
    () => assertInsideRepository(repository, outsideFile),
    /path resolves outside repository/u
  );
});

test("repository shape ignores only regular macOS metadata files at every depth", (t) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-repository-shape-"));
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  fs.mkdirSync(path.join(fixtureRoot, "nested"), { recursive: true });
  fs.writeFileSync(path.join(fixtureRoot, ".DS_Store"), "host metadata\n");
  fs.writeFileSync(path.join(fixtureRoot, "nested", ".DS_Store"), "host metadata\n");
  fs.writeFileSync(path.join(fixtureRoot, "nested", "kept.txt"), "repository content\n");
  fs.writeFileSync(path.join(fixtureRoot, "unexpected.txt"), "unexpected repository content\n");

  assert.deepEqual(
    visibleDirectoryRows(fixtureRoot, fixtureRoot).map(({ relativePath }) => relativePath),
    ["nested", "unexpected.txt"]
  );
  assert.deepEqual(
    walk(fixtureRoot, fixtureRoot).map(({ relativePath }) => relativePath),
    ["nested", "nested/kept.txt", "unexpected.txt"]
  );

  fs.rmSync(path.join(fixtureRoot, ".DS_Store"));
  fs.mkdirSync(path.join(fixtureRoot, ".DS_Store"));
  fs.writeFileSync(path.join(fixtureRoot, ".DS_Store", "not-hidden.txt"), "unexpected repository content\n");
  assert.deepEqual(
    walk(fixtureRoot, fixtureRoot).map(({ relativePath }) => relativePath),
    [".DS_Store", ".DS_Store/not-hidden.txt", "nested", "nested/kept.txt", "unexpected.txt"]
  );
});

test("repository has one closed top-level product structure and one generated skill mirror", () => {
  const actual = visibleDirectoryRows(repositoryRoot).map(({ relativePath }) => relativePath).sort();
  assert.deepEqual(actual, [...expectedTopLevel].sort());
  const skillFiles = walk(repositoryRoot).filter(({ relativePath }) => relativePath.endsWith("/SKILL.md"));
  assert.deepEqual(skillFiles.map(({ relativePath }) => relativePath), [
    "plugins/programmable-v4-builder/skills/programmable-v4-hook-builder/SKILL.md",
    "skills/programmable-v4-hook-builder/SKILL.md"
  ]);
});

test("repository contains no symlink, transient directory, oversized file, secret, or bot configuration", () => {
  const rows = walk(repositoryRoot);
  const secretPatterns = [
    /-----BEGIN (?:EC |RSA |OPENSSH )?PRIVATE KEY-----/u,
    /\bgh[opusr]_[A-Za-z0-9]{24,}\b/u,
    /\bsk-(?:ant|proj)-[A-Za-z0-9_-]{16,}\b/u
  ];
  for (const row of rows) {
    assert.equal(row.stat.isSymbolicLink(), false, row.relativePath);
    if (row.stat.isDirectory()) assert.equal(forbiddenTransientDirectories.has(path.basename(row.relativePath)), false, row.relativePath);
    if (!row.stat.isFile()) continue;
    assert.ok(row.stat.size <= 1_000_000, `oversized file ${row.relativePath}`);
    const contents = fs.readFileSync(row.absolutePath);
    if (contents.includes(0)) continue;
    const text = contents.toString("utf8");
    for (const pattern of secretPatterns) assert.equal(pattern.test(text), false, `credential-like value in ${row.relativePath}`);
  }
  assert.equal(fs.existsSync(path.join(repositoryRoot, ".github", "dependabot.yml")), false);
});

test("every repository JSON file is valid UTF-8 with no duplicate object keys", () => {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const jsonFiles = walk(repositoryRoot).filter(({ stat, relativePath }) => (
    stat.isFile() && relativePath.toLowerCase().endsWith(".json")
  ));
  assert.ok(jsonFiles.length > 0);
  for (const file of jsonFiles) {
    assert.doesNotThrow(
      () => parseBoundedLosslessJson(decoder.decode(fs.readFileSync(file.absolutePath))),
      file.relativePath
    );
  }
  assert.throws(
    () => parseBoundedLosslessJson('{"outer":{"id":1,"id":2}}'),
    /duplicate key/u
  );
});

test("canonical config version and generated package identities agree", () => {
  const packageDocument = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8"));
  const packageLock = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "package-lock.json"), "utf8"));
  const metadata = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "config", "plugin.json"), "utf8"));
  const codex = JSON.parse(fs.readFileSync(path.join(repositoryRoot, ".codex-plugin", "plugin.json"), "utf8"));
  const codexMarketplace = JSON.parse(fs.readFileSync(path.join(repositoryRoot, ".agents", "plugins", "marketplace.json"), "utf8"));
  const claude = JSON.parse(fs.readFileSync(path.join(repositoryRoot, ".claude-plugin", "plugin.json"), "utf8"));
  const marketplace = JSON.parse(fs.readFileSync(path.join(repositoryRoot, ".claude-plugin", "marketplace.json"), "utf8"));
  const payloadRoot = path.join(repositoryRoot, "plugins", metadata.name);
  const payloadCodex = JSON.parse(fs.readFileSync(path.join(payloadRoot, ".codex-plugin", "plugin.json"), "utf8"));
  const openAiInterface = fs.readFileSync(path.join(repositoryRoot, "skills", "programmable-v4-hook-builder", "agents", "openai.yaml"), "utf8");
  const candidate = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "skills", "programmable-v4-hook-builder", "assets", "templates", "release-candidate.example.json"), "utf8"));
  assert.equal(packageDocument.name, "@programmable/v4-builder-repository");
  assert.equal(packageDocument.private, true);
  assert.equal(packageDocument.license, "MIT");
  assert.equal(packageDocument.engines.node, ">=24");
  assert.equal(packageDocument.packageManager, "npm@11.16.0");
  assert.equal(packageDocument.repository.url, "git+https://github.com/0xprogrammable/hookbuilder.git");
  assert.equal(packageDocument.bugs.url, "https://github.com/0xprogrammable/hookbuilder/issues");
  assert.equal(packageDocument.homepage, "https://github.com/0xprogrammable/hookbuilder#readme");
  assert.equal(Object.hasOwn(packageDocument, "dependencies"), false);
  assert.equal(Object.hasOwn(packageDocument, "devDependencies"), false);
  assert.equal(metadata.version, "0.11.0");
  assert.equal(packageLock.name, packageDocument.name);
  assert.equal(packageLock.version, packageDocument.version);
  assert.equal(packageLock.packages[""].name, packageDocument.name);
  assert.equal(packageLock.packages[""].version, packageDocument.version);
  assert.equal(metadata.version, packageDocument.version);
  assert.equal(codex.version, packageDocument.version);
  assert.equal(codexMarketplace.name, "programmable");
  assert.deepEqual(codexMarketplace.plugins, [{
    name: metadata.name,
    source: { source: "local", path: `./plugins/${metadata.name}` },
    policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
    category: metadata.category
  }]);
  assert.equal(claude.version, packageDocument.version);
  assert.equal(marketplace.version, packageDocument.version);
  assert.deepEqual(marketplace.plugins, [{
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
  }]);
  const openAiDefaultPrompt = openAiInterface.match(/^\s*default_prompt:\s*(".*")$/mu);
  assert.ok(openAiDefaultPrompt, "agents/openai.yaml default_prompt missing");
  assert.equal(JSON.parse(openAiDefaultPrompt[1]), metadata.defaultPrompt[0]);
  assert.equal(candidate.releaseVersion, packageDocument.version);
  assert.equal(codex.skills, "./skills/");
  assert.equal(codex.mcpServers, metadata.mcpServers);
  assert.deepEqual(payloadCodex, codex);
  assert.equal(fs.readFileSync(path.join(payloadRoot, ".mcp.json"), "utf8"), fs.readFileSync(path.join(repositoryRoot, ".mcp.json"), "utf8"));
  assert.equal(claude.skills, "./skills/");
  assert.equal(Object.hasOwn(claude, "mcpServers"), false);
});

test("plugin metadata advertises the full project surface and canonical Submit a Launch handoff", () => {
  const metadata = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "config", "plugin.json"), "utf8"));
  const openAiInterface = fs.readFileSync(
    path.join(repositoryRoot, "skills", "programmable-v4-hook-builder", "agents", "openai.yaml"),
    "utf8"
  );
  const combinedDescriptions = [
    metadata.description,
    metadata.shortDescription,
    metadata.longDescription
  ].join(" ");
  for (const projectShape of ["hooks", "tokens", "apps", "games", "services", "standalone settlement"]) {
    assert.match(combinedDescriptions, new RegExp(projectShape, "iu"), projectShape);
  }
  assert.match(metadata.defaultPrompt[0], /^Use \$programmable-v4-hook-builder /u);
  assert.match(metadata.defaultPrompt[0], /Submit a Launch/u);
  assert.ok(metadata.defaultPrompt[0].length <= 128);
  assert.equal((metadata.defaultPrompt[0].match(/[.!?]/gu) ?? []).length, 1);
  const openAiDefaultPrompt = openAiInterface.match(/^\s*default_prompt:\s*(".*")$/mu);
  assert.ok(openAiDefaultPrompt);
  assert.equal(JSON.parse(openAiDefaultPrompt[1]), metadata.defaultPrompt[0]);
});

test("global skill boundaries apply v4 mechanics conditionally and distinguish disclosed trust", () => {
  const skill = fs.readFileSync(
    path.join(repositoryRoot, "skills", "programmable-v4-hook-builder", "SKILL.md"),
    "utf8"
  );
  assert.match(
    skill,
    /description: Use only when the user asks to .*complete Programmable or Uniswap v4 project; this includes architecture or brainstorming that explicitly continues into implementation\. Do not use for explanation-only or brainstorming-only questions;/u
  );
  assert.match(skill, /Continue design into implementation\./u);
  assert.match(skill, /Start v4 with 14 permissions disabled;/u);
  assert.match(skill, /canonical v4 covers four direction\/exactness quadrants/u);
  assert.match(skill, /Disclose privileged mint\/seizure\/fee\/pause\/upgrade\/payout powers\./u);
  assert.match(skill, /Escalate novel\/value-bearing ambiguity/u);
  assert.match(skill, /node "\$BUILDER_CLI" policy/u);
  assert.match(skill, /Use every `build` Rule ID from `0xprogrammable\/submit-launch`; add none/u);
  assert.match(skill, /If unavailable, keep source\s+`POLICY_UNRESOLVED` and block only submit\/approval\/launch/u);
  assert.match(skill, /Before materializing read no other reference/u);
  assert.match(skill, /Active workspaces may\s+run one `LOCAL_ONLY` offline check/u);
  assert.match(skill, /Only exact-byte `PROJECT_PREFLIGHT_VALID` completes Autopilot/u);
  assert.match(skill, /Fix inputs and rematerialize/u);
  assert.match(skill, /Missing catalog\/profile never justifies refusal/u);
  assert.match(skill, /policy gates\s+launch, never source/iu);
  assert.doesNotMatch(skill, /hidden mint,\s*confiscation, blacklist, fee, pause, upgrade or payout-redirection power/u);
});

test("plugin manifests are generated from canonical metadata and package version", () => {
  const result = childProcess.spawnSync(
    process.execPath,
    [path.join(repositoryRoot, "scripts", "generate-plugin-manifests.mjs"), "--check"],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "PLUGIN_MANIFESTS_VALID");
  assert.equal(report.version, "0.11.0");
  assert.deepEqual(report.outputs, [
    ".codex-plugin/plugin.json",
    ".agents/plugins/marketplace.json",
    ".claude-plugin/plugin.json",
    ".claude-plugin/marketplace.json",
    "plugins/programmable-v4-builder/.codex-plugin/plugin.json"
  ]);
  assert.equal(report.payload.root, "plugins/programmable-v4-builder");
  assert.ok(report.payload.files > 300);
  assert.match(report.payload.sha256, /^[0-9a-f]{64}$/u);
  assert.equal(report.payload.sourceByteVerified, true);
  assert.equal(report.payload.sourceModeVerified, true);
  assert.deepEqual(report.payload.portableSkill, {
    files: 627,
    bytes: 8_800_607,
    repositoryOnlyFiles: 105,
    repositoryOnlyBytes: 3_115_466,
    repositorySourcesVerified: true
  });
});

test("plugin mirror mode verification rejects an executable-bit downgrade", (t) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-plugin-mode-"));
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  const source = path.join(fixtureRoot, "source.mjs");
  const target = path.join(fixtureRoot, "target.mjs");
  fs.writeFileSync(source, "#!/usr/bin/env node\n", { mode: 0o755 });
  fs.writeFileSync(target, "#!/usr/bin/env node\n", { mode: 0o644 });

  assert.throws(
    () => assertMirroredFileMode(source, target),
    /mode differs from canonical source/u
  );
  fs.chmodSync(target, 0o755);
  assert.equal(assertMirroredFileMode(source, target), 0o755);
});

test("generated Codex plugin payload starts its MCP server without package.json", () => {
  const payloadRoot = path.join(repositoryRoot, "plugins", "programmable-v4-builder");
  const payloadManifest = JSON.parse(fs.readFileSync(
    path.join(payloadRoot, ".codex-plugin", "plugin.json"),
    "utf8"
  ));
  assert.equal(fs.existsSync(path.join(payloadRoot, "package.json")), false);

  const initialize = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "payload-regression", version: "1" }
    }
  };
  const result = childProcess.spawnSync(
    process.execPath,
    [path.join(payloadRoot, "mcp", "server.mjs")],
    {
      cwd: payloadRoot,
      encoding: "utf8",
      env: { HOME: process.env.HOME, LANG: "C.UTF-8", PATH: process.env.PATH },
      input: `${JSON.stringify(initialize)}\n`,
      maxBuffer: 1024 * 1024,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5_000
    }
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  const messages = result.stdout.trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0].result.serverInfo, {
    name: payloadManifest.name,
    version: payloadManifest.version
  });
});

test("plugin manifest generation fails closed on package version skew", (t) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-plugin-version-skew-"));
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  for (const directory of [
    "scripts",
    "config",
    ".codex-plugin",
    ".agents/plugins",
    ".claude-plugin",
    "skills/programmable-v4-hook-builder/scripts"
  ]) {
    fs.mkdirSync(path.join(fixtureRoot, directory), { recursive: true });
  }
  for (const relativePath of [
    "scripts/generate-plugin-manifests.mjs",
    "scripts/plugin-payload-mode-core.mjs",
    "skills/programmable-v4-hook-builder/scripts/portable-package-manifest-core.mjs",
    "skills/programmable-v4-hook-builder/scripts/strict-json-core.mjs",
    "config/plugin.json",
    ".codex-plugin/plugin.json",
    ".agents/plugins/marketplace.json",
    ".claude-plugin/plugin.json",
    ".claude-plugin/marketplace.json"
  ]) {
    fs.copyFileSync(path.join(repositoryRoot, relativePath), path.join(fixtureRoot, relativePath));
  }
  const packageDocument = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8"));
  packageDocument.version = "0.5.2";
  fs.writeFileSync(path.join(fixtureRoot, "package.json"), `${JSON.stringify(packageDocument, null, 2)}\n`);

  const result = childProcess.spawnSync(
    process.execPath,
    [path.join(fixtureRoot, "scripts", "generate-plugin-manifests.mjs"), "--check"],
    { cwd: fixtureRoot, encoding: "utf8", shell: false, stdio: ["ignore", "pipe", "pipe"] }
  );
  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /package\.json version must match canonical config\/plugin\.json version/u);
});

test("every GitHub Action is pinned to an immutable commit", () => {
  const workflows = walk(path.join(repositoryRoot, ".github", "workflows")).filter(({ stat }) => stat.isFile());
  assert.ok(workflows.length >= 1);
  for (const workflow of workflows) {
    const contents = fs.readFileSync(workflow.absolutePath, "utf8");
    for (const match of contents.matchAll(/^\s*uses:\s*([^\s#]+).*$/gmu)) {
      if (match[1].startsWith("./")) continue;
      assert.match(match[1], /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)?@[0-9a-f]{40}$/u, `${workflow.relativePath}: ${match[1]}`);
    }
  }
});

test("release rehearsal is read-only, main-only, exact-revision bound, and preserves the complete output", () => {
  const workflow = fs.readFileSync(path.join(repositoryRoot, ".github", "workflows", "release-rehearsal.yml"), "utf8");
  assert.match(workflow, /^on:\n  workflow_dispatch:\n/mu);
  assert.doesNotMatch(workflow, /^\s*(?:push|pull_request|pull_request_target|schedule):/mu);
  assert.match(workflow, /^permissions:\n  contents: read$/mu);
  assert.match(workflow, /^  group: release-rehearsal-\$\{\{ github\.ref \}\}$/mu);
  assert.match(workflow, /^  cancel-in-progress: false$/mu);
  assert.match(workflow, /^    if: github\.ref == 'refs\/heads\/main'$/mu);
  assert.match(workflow, /^          ref: \$\{\{ github\.sha \}\}$/mu);
  assert.match(workflow, /^          fetch-depth: 0$/mu);
  assert.match(workflow, /^          persist-credentials: false$/mu);
  assert.match(workflow, /test "\$\(git rev-parse HEAD\)" = "\$EXPECTED_REVISION"/u);
  assert.match(workflow, /test "\$\(git rev-parse refs\/remotes\/origin\/main\)" = "\$EXPECTED_REVISION"/u);
  assert.match(workflow, /npm run release:candidate -- --tag "\$RELEASE_TAG" --output-dir "\$RELEASE_OUTPUT"/u);
  assert.match(workflow, /path: \$\{\{ steps\.release\.outputs\.output \}\}/u);
  assert.match(workflow, /if-no-files-found: error/u);
  assert.match(workflow, /compression-level: 0/u);
  assert.doesNotMatch(workflow, /(?:contents|packages|actions|attestations): write/u);
  assert.doesNotMatch(workflow, /\$\{\{ secrets\.|gh release|git push|git tag/u);
});

test("every CI analysis job checks out and verifies the exact pull-request head", () => {
  const workflow = fs.readFileSync(path.join(repositoryRoot, ".github", "workflows", "ci.yml"), "utf8");
  const exactRevisionExpression = "${{ github.event_name == 'pull_request' && github.event.pull_request.head.sha || github.sha }}";
  const plannedRevisionExpression = "${{ needs.plan.outputs.head_sha }}";
  const trustedRevisionExpression = "${{ needs.plan.outputs.trusted_revision }}";
  assert.doesNotMatch(workflow, /^\s*pull_request_target:/mu);
  assert.match(workflow, /permissions:\n  contents: read\n/u);
  for (const requiredJobName of [
    "    name: Applicant gate\n",
    "    name: Platform/profile gate\n",
    "    name: Repository and skill / Node ${{ matrix.node }}\n",
    "    name: Internal / reference fee kernel / ${{ matrix.kernel }}\n",
    "    name: Reference fee kernel\n",
    "    name: CodeQL\n"
  ]) assert.ok(workflow.includes(requiredJobName), requiredJobName.trim());
  const checkoutSteps = workflow.match(/^\s*uses: actions\/checkout@[0-9a-f]{40}.*\n\s*with:\n(?:\s{10}.*\n)+/gmu) ?? [];
  assert.equal(checkoutSteps.length, 10);
  for (const step of checkoutSteps) {
    assert.match(step, /^\s*uses: actions\/checkout@[0-9a-f]{40}/mu);
    assert.ok(
      step.includes(`          ref: ${exactRevisionExpression}\n`)
      || step.includes(`          ref: ${plannedRevisionExpression}\n`)
      || step.includes(`          ref: ${trustedRevisionExpression}\n`)
    );
    assert.ok(step.includes("          persist-credentials: false"));
  }

  assert.equal([
    ...workflow.matchAll(/^\s*- name: Verify (?:exact revision|protected control-plane revision|protected gate revision)$/gmu)
  ].length, checkoutSteps.length);
  assert.equal([
    ...workflow.matchAll(/^\s*run: test "\$\(git rev-parse HEAD\)" = "\$EXPECTED_REVISION"$/gmu)
  ].length, checkoutSteps.length);
  assert.ok(workflow.includes(`          EXPECTED_REVISION: ${exactRevisionExpression}\n`));
  assert.ok(workflow.includes(`          EXPECTED_REVISION: ${plannedRevisionExpression}\n`));
  assert.ok(workflow.includes(`          EXPECTED_REVISION: ${trustedRevisionExpression}\n`));
});

test("trusted-base intake routing rejects every new Hookbuilder application without touching candidate code", () => {
  const workflow = fs.readFileSync(path.join(repositoryRoot, ".github", "workflows", "intake-routing.yml"), "utf8");
  assert.match(workflow, /^\s*pull_request_target:$/mu);
  assert.match(workflow, /^\s*branches: \[main, "release\/\*"\]$/mu);
  assert.match(workflow, /^\s*- "submissions\/requests\/\*\.json"$/mu);
  assert.match(workflow, /^permissions: \{\}$/mu);
  assert.match(workflow, /^\s*name: Hookbuilder intake route$/mu);
  assert.match(workflow, /https:\/\/github\.com\/0xprogrammable\/submit-launch/u);
  assert.match(workflow, /^\s*exit 1$/mu);
  assert.match(workflow, /^\s*BASE_REF: \$\{\{ github\.event\.pull_request\.base\.ref \}\}$/mu);
  assert.match(workflow, /if test "\$BASE_REF" != main/u);
  assert.match(workflow, /Retarget an allowed legacy continuation to Hookbuilder main/u);
  assert.doesNotMatch(workflow, /^\s*uses:/mu);
  assert.doesNotMatch(workflow, /actions\/checkout|head\.sha|github\.token|secrets\.|pull-requests:\s*write/u);
  assert.doesNotMatch(workflow, /name: (?:Applicant gate|Platform\/profile gate)/u);
  assert.match(workflow, /never make this path-filtered context required/u);
  assert.match(workflow, /Applicant gate remains the authoritative merge boundary/u);

  const legacy = workflow.match(/^\s*LEGACY_APPLICANT_PULL_REQUESTS: "([0-9 ]+)"$/mu);
  assert.ok(legacy, "legacy pull-request list missing");
  assert.deepEqual(
    legacy[1].split(" ").map(Number),
    HOOKBUILDER_LEGACY_APPLICANT_PULL_REQUESTS
  );

  const codeowners = fs.readFileSync(path.join(repositoryRoot, ".github", "CODEOWNERS"), "utf8");
  const support = fs.readFileSync(path.join(repositoryRoot, "SUPPORT.md"), "utf8");
  const publicGuide = fs.readFileSync(path.join(repositoryRoot, "docs", "PUBLIC_GITHUB_PR_BETA.md"), "utf8");
  assert.match(codeowners, /^\.github\/workflows\/\*\* @0xprogrammable$/mu);
  assert.match(codeowners, /^scripts\/ci\/\*\* @0xprogrammable$/mu);
  assert.match(codeowners, /^submissions\/requests\/\*\* @0xprogrammable$/mu);
  assert.match(support, /0xprogrammable\/submit-launch/u);
  assert.match(support, /against Hookbuilder `main` only/u);
  assert.match(publicGuide, /canonical public review path for every completed one-off Programmable project/u);
  assert.match(publicGuide, /Every generic project then uses/u);
  assert.match(publicGuide, /The first submit call is read-only/u);
  assert.match(publicGuide, /Draft PR against `0xprogrammable\/submit-launch:main`/u);
  assert.equal(HOOKBUILDER_LEGACY_APPLICANT_BASE_BRANCH, "main");
  for (const pullRequest of HOOKBUILDER_LEGACY_APPLICANT_PULL_REQUESTS) {
    assert.match(support, new RegExp(`#${pullRequest}(?:,| and|\\.)`, "u"));
  }
});

test("raw Git permits only the exact recursive bound-tree enumeration shape", () => {
  const revision = "0123456789abcdef0123456789abcdef01234567";
  const accepted = ["-C", "/tmp/example", "ls-tree", "-r", "-z", "--full-tree", revision, "--", "."];
  assert.doesNotThrow(() => safeRawGitArguments(accepted));

  for (const rejected of [
    ["-C", "/tmp/example", "ls-tree", "-r", "-z", "--full-tree", "HEAD", "--", "."],
    ["-C", "/tmp/example", "ls-tree", "-r", "-z", "--full-tree", `${revision}^{tree}`, "--", "."],
    ["-C", "/tmp/example", "ls-tree", "-r", "-z", "--full-tree", revision, "--", ":/"],
    ["-C", "/tmp/example", "ls-tree", "-r", "-z", "--full-tree", revision, "--", "./"],
    ["-C", "/tmp/example", "ls-tree", "-r", "-z", "--full-tree", revision, "--", ".", "src"],
    ["-C", "/tmp/example", "ls-tree", "-r", "--full-tree", revision, "--", "."],
    ["-C", "/tmp/example", "ls-tree", "-r", "-z", revision, "--", "."],
    ["-C", "/tmp/example", "ls-tree", "-r", "-z", "--full-tree", "--name-only", revision, "--", "."],
    ["-C", "/tmp/example", "ls-tree", "-r", "-t", "-z", "--full-tree", revision, "--", "."],
    ["-C", "/tmp/example", "ls-tree", "-z", "-r", "--full-tree", revision, "--", "."]
  ]) {
    assert.throws(() => safeRawGitArguments(rejected), /Raw Git ls-tree requires/u);
  }
});

test("raw Git exposes only the exact read-only control paths needed for output containment", () => {
  for (const accepted of [
    ["-C", "/tmp/example", "rev-parse", "--absolute-git-dir"],
    ["-C", "/tmp/example", "rev-parse", "--git-common-dir"],
    ["-C", "/tmp/example", "rev-parse", "--git-path", "objects"]
  ]) {
    assert.doesNotThrow(() => safeRawGitArguments(accepted));
  }
  for (const rejected of [
    ["-C", "/tmp/example", "rev-parse", "--git-path", "hooks"],
    ["-C", "/tmp/example", "rev-parse", "--git-path", "objects", "extra"],
    ["-C", "/tmp/example", "rev-parse", "--path-format=absolute", "--git-common-dir"],
    ["-C", "/tmp/example", "rev-parse", "--local-env-vars"]
  ]) {
    assert.throws(() => safeRawGitArguments(rejected), /permits only exact Git-control paths/u);
  }
});

test("historical V1 reference-kernel assets remain byte-for-byte frozen", () => {
  const v1Root = path.join(
    repositoryRoot,
    "skills",
    "programmable-v4-hook-builder",
    "assets",
    "reference-kernels",
    "programmable-volume-fee-v1"
  );
  const files = walk(v1Root)
    .filter(({ stat }) => stat.isFile())
    .sort((left, right) => left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0);
  const digest = crypto.createHash("sha256");
  for (const file of files) {
    const relativePath = path.relative(v1Root, file.absolutePath).split(path.sep).join("/");
    digest.update(relativePath, "utf8");
    digest.update(Buffer.from([0]));
    digest.update(fs.readFileSync(file.absolutePath));
    digest.update(Buffer.from([0]));
  }
  assert.equal(digest.digest("hex"), "dc57941d575adad3ccf5edfa71eeebbce62bdd3c7691e2bb7a73608baf8d9ebd");
});

test("CI deterministically covers both Programmable fee reference kernels", () => {
  const workflow = fs.readFileSync(path.join(repositoryRoot, ".github", "workflows", "ci.yml"), "utf8");
  const planner = fs.readFileSync(path.join(repositoryRoot, "scripts", "ci", "plan-applicant-fast-lane.mjs"), "utf8");
  const releaseEvidenceCore = fs.readFileSync(path.join(repositoryRoot, "scripts", "release-evidence-core.mjs"), "utf8");
  assert.match(workflow, /^\s*branches: \[main, "release\/\*"\]$/mu);
  assert.match(workflow, /^\s*CI_ROUTING_REF: \$\{\{ github\.event_name == 'pull_request' && github\.base_ref \|\| github\.ref_name \}\}$/mu);
  assert.doesNotMatch(workflow, /--ref "\$\{\{/u);
  assert.match(workflow, /Preserve exhaustive checks while a protected base predates routing outputs/u);
  assert.match(workflow, /ROUTED_REPOSITORY_NODES='\[22,24\]'/u);
  assert.match(workflow, /ROUTED_REFERENCE_KERNEL_REQUIRED=true/u);
  assert.match(workflow, /ROUTED_CODEQL_REQUIRED=true/u);
  assert.match(workflow, /ROUTED_PLATFORM_LANE_REQUIRED=true/u);
  assert.match(planner, /baseRef: options\.ref/u);
  assert.match(planner, /HOOKBUILDER_APPLICANT_BASE_INVALID/u);
  const repositoryJobStart = workflow.indexOf("  repository:\n");
  const repositoryJobEnd = workflow.indexOf("\n  reference-kernel:\n", repositoryJobStart);
  assert.ok(repositoryJobStart >= 0 && repositoryJobEnd > repositoryJobStart, "repository job boundary missing");
  const repositoryJob = workflow.slice(repositoryJobStart, repositoryJobEnd);
  assert.match(repositoryJob, /^\s*uses: foundry-rs\/foundry-toolchain@908c540300062bd5a7e473851cdb4282204cee09 # v1$/mu);
  assert.match(repositoryJob, /^\s*version: v1\.7\.1$/mu);
  assert.match(repositoryJob, /^\s*mkdir -p -- "\$RUNNER_TEMP\/programmable-foundry-bootstrap"$/mu);
  assert.match(repositoryJob, /^\s*forge build --use 0\.8\.26 --root "\$RUNNER_TEMP\/programmable-foundry-bootstrap"$/mu);
  assert.match(repositoryJob, /^\s*name: Repository and skill \/ Node \$\{\{ matrix\.node \}\}$/mu);
  assert.match(repositoryJob, /^\s*if: \$\{\{ needs\.plan\.outputs\.platform_lane_required == 'true' \}\}$/mu);
  assert.match(repositoryJob, /^\s*node: \$\{\{ fromJSON\(needs\.plan\.outputs\.repository_nodes\) \}\}$/mu);
  assert.match(repositoryJob, /name: Verify portable Skill compatibility on Node 22/u);
  assert.match(repositoryJob, /^\s*if: matrix\.node == 22$/mu);
  assert.ok(repositoryJob.includes("node skills/programmable-v4-hook-builder/scripts/cli.mjs context --mode autopilot --brief"));
  assert.ok(repositoryJob.includes("node skills/programmable-v4-hook-builder/scripts/verify-skill.mjs --installed"));
  assert.equal((repositoryJob.match(/^\s*if: matrix\.node == 24$/gmu) ?? []).length, 5);
  const foundryInstall = repositoryJob.indexOf("Install Foundry");
  const compilerPreload = repositoryJob.indexOf("Preload the portable-test Solidity compiler");
  const repositoryGate = repositoryJob.indexOf("run: npm test");
  assert.ok(foundryInstall >= 0 && foundryInstall < compilerPreload && compilerPreload < repositoryGate);
  const kernelJobStart = workflow.indexOf("  reference-kernel:\n");
  const kernelJobEnd = workflow.indexOf("\n  reference-kernel-required:\n", kernelJobStart);
  assert.ok(kernelJobStart >= 0 && kernelJobEnd > kernelJobStart, "reference-kernel job boundary missing");
  const kernelJob = workflow.slice(kernelJobStart, kernelJobEnd);
  assert.match(kernelJob, /^\s*matrix: \$\{\{ fromJSON\(needs\.plan\.outputs\.reference_kernel_matrix\) \}\}$/mu);
  assert.match(kernelJob, /needs\.plan\.outputs\.platform_lane_required == 'true'/u);
  assert.match(kernelJob, /needs\.plan\.outputs\.reference_kernel_required == 'true'/u);
  assert.match(planner, /import \{ RELEASE_KERNELS \} from "\.\.\/release-evidence-core\.mjs"/u);
  assert.match(planner, /lockfile: `\$\{sourcePath\}\/package-lock\.json`/u);
  const kernelRoot = "skills/programmable-v4-hook-builder/assets/reference-kernels";
  for (const version of ["v1", "v2"]) {
    const workdir = `${kernelRoot}/programmable-volume-fee-${version}`;
    assert.ok(fs.existsSync(path.join(repositoryRoot, workdir, "package-lock.json")), `${version} lockfile missing`);
    assert.ok(fs.existsSync(path.join(repositoryRoot, workdir, "foundry.toml")), `${version} Foundry profile missing`);
    assert.match(releaseEvidenceCore, new RegExp(`sourcePath: "${workdir.replaceAll("/", "\\/")}"`, "u"), `${version} release workdir missing`);
  }

  assert.match(kernelJob, /^\s*working-directory: \$\{\{ matrix\.workdir \}\}$/mu);
  assert.match(kernelJob, /^\s*cache-dependency-path: \$\{\{ matrix\.lockfile \}\}$/mu);
  assert.match(kernelJob, /^\s*run: npm ci --ignore-scripts$/mu);
  assert.match(kernelJob, /^\s*version: v1\.7\.1$/mu);
  assert.match(kernelJob, /^\s*run: forge fmt --check$/mu);
  assert.match(kernelJob, /^\s*run: forge build$/mu);
  assert.match(kernelJob, /^\s*run: forge test -vvv --no-match-test '\^\(testFuzz\|invariant\)'$/mu);
  assert.match(kernelJob, /^\s*run: forge test -vvv --match-test '\^testFuzz' --fuzz-runs 10000$/mu);
  assert.match(kernelJob, /^\s*FOUNDRY_INVARIANT_DEPTH: "256"$/mu);
  assert.match(kernelJob, /^\s*FOUNDRY_INVARIANT_RUNS: "1000"$/mu);
  assert.match(kernelJob, /^\s*run: forge test -vvv --match-test '\^invariant'$/mu);
  assert.match(kernelJob, /^\s*run: forge test -vvv --gas-report --no-match-test '\^\(testFuzz\|invariant\)'$/mu);
  assert.match(kernelJob, /^\s*python-version: "3\.12"$/mu);
  assert.doesNotMatch(kernelJob, /^\s*cache: pip$/mu);
  assert.match(kernelJob, /^\s*run: python -m pip install --disable-pip-version-check slither-analyzer==0\.11\.5$/mu);
  assert.match(kernelJob, /^\s*run: slither \. --exclude-dependencies --filter-paths 'node_modules\|test'$/mu);
  assert.equal([...workflow.matchAll(/^\s*run: npm ci --ignore-scripts$/gmu)].length, 2);

  const requiredJobStart = workflow.indexOf("  reference-kernel-required:\n", kernelJobEnd);
  const requiredJobEnd = workflow.indexOf("\n  security-static:\n", requiredJobStart);
  assert.ok(requiredJobStart >= 0 && requiredJobEnd > requiredJobStart, "reference-kernel required-check aggregator boundary missing");
  const requiredJob = workflow.slice(requiredJobStart, requiredJobEnd);
  assert.match(requiredJob, /^\s*name: Reference fee kernel$/mu);
  assert.match(requiredJob, /^\s*needs: \[plan, reference-kernel\]$/mu);
  assert.match(requiredJob, /^\s*if: \$\{\{ always\(\) && needs\.plan\.outputs\.platform_lane_required == 'true' \}\}$/mu);
  assert.match(requiredJob, /^\s*REQUIRED: \$\{\{ needs\.plan\.outputs\.reference_kernel_required \}\}$/mu);
  assert.match(requiredJob, /^\s*MATRIX_RESULT: \$\{\{ needs\.reference-kernel\.result \}\}$/mu);
  assert.match(requiredJob, /if test "\$REQUIRED" = true; then[\s\S]*test "\$MATRIX_RESULT" = success[\s\S]*test "\$MATRIX_RESULT" = skipped/u);
  assert.equal([...workflow.matchAll(/^\s*name: Reference fee kernel$/gmu)].length, 1);

  const securityJobStart = requiredJobEnd + 1;
  const uploadJobStart = workflow.indexOf("\n  codeql-upload:\n", securityJobStart);
  const codeqlJobStart = workflow.indexOf("\n  codeql:\n", uploadJobStart);
  const platformGateStart = workflow.indexOf("\n  platform-profile-gate:\n", codeqlJobStart);
  assert.ok(uploadJobStart > securityJobStart && codeqlJobStart > uploadJobStart && platformGateStart > codeqlJobStart);
  const securityJob = workflow.slice(securityJobStart, uploadJobStart);
  const uploadJob = workflow.slice(uploadJobStart, codeqlJobStart);
  const codeqlJob = workflow.slice(codeqlJobStart, platformGateStart);
  assert.match(securityJob, /^\s*name: Internal \/ static security$/mu);
  assert.match(securityJob, /needs\.plan\.outputs\.platform_lane_required == 'true'/u);
  assert.match(securityJob, /github\.event_name != 'push'/u);
  assert.match(securityJob, /^\s*contents: read$/mu);
  assert.doesNotMatch(securityJob, /security-events: write/u);
  assert.match(securityJob, /^\s*persist-credentials: false$/mu);
  assert.match(securityJob, /^\s*upload: never$/mu);
  assert.match(uploadJob, /github\.event_name == 'push'/u);
  assert.match(uploadJob, /needs\.plan\.outputs\.platform_lane_required == 'true'/u);
  assert.match(uploadJob, /^\s*security-events: write$/mu);
  assert.match(uploadJob, /^\s*persist-credentials: false$/mu);
  assert.match(codeqlJob, /^\s*name: CodeQL$/mu);
  assert.match(codeqlJob, /^\s*needs: \[plan, applicant-gate, security-static, codeql-upload\]$/mu);
  assert.match(codeqlJob, /^\s*permissions: \{\}$/mu);
  assert.match(codeqlJob, /needs\.plan\.result != 'success'/u);
  assert.match(codeqlJob, /needs\.applicant-gate\.result != 'success'/u);
  assert.match(codeqlJob, /test "\$PLAN_RESULT" = success/u);
  assert.match(codeqlJob, /test "\$APPLICANT_GATE_RESULT" = success/u);
  assert.match(codeqlJob, /Aggregate the routed static-security lane/u);
});

test("relative Markdown links resolve inside the repository", () => {
  const markdownFiles = walk(repositoryRoot).filter(({ stat, relativePath }) => stat.isFile() && relativePath.endsWith(".md"));
  for (const file of markdownFiles) {
    const source = fs.readFileSync(file.absolutePath, "utf8");
    for (const match of source.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/gu)) {
      let target = match[1].trim();
      if (target.startsWith("<") && target.endsWith(">")) target = target.slice(1, -1);
      if (/^(?:https?:|mailto:|#)/u.test(target)) continue;
      target = target.split("#", 1)[0].split("?", 1)[0];
      if (target.length === 0) continue;
      const resolved = path.resolve(path.dirname(file.absolutePath), decodeURIComponent(target));
      const relative = path.relative(repositoryRoot, resolved);
      const outside = relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
      assert.equal(outside, false, `${file.relativePath}: ${target}`);
      assert.equal(fs.existsSync(resolved), true, `${file.relativePath}: ${target}`);
    }
  }
});

test("official adoption record binds the reviewed source heads", () => {
  const record = fs.readFileSync(path.join(repositoryRoot, "docs", "UNISWAP_MASTER_SKILL_ADOPTION.md"), "utf8");
  for (const commit of [
    "a0da460b1becfe920330adfab5d11f2f3f63863a",
    "46c6834698c48bc4a463a86d8420f4eb1d7f3b75",
    "3245c3cb99c48fa1dc2459c3b60abc37d4294aba",
    "7da5210f2c81a700820a6b4f585264233d91f349",
    "1e30c3265f3cfb818ed912833f3e65630c8b3490",
    "9660491dc662fea76c2f8565c2f7ba2abf6e8840"
  ]) assert.ok(record.includes(commit), commit);
});

test("release archives use safe deterministic modes and canonical scoped npm PURLs", () => {
  const source = fs.readFileSync(path.join(repositoryRoot, "scripts", "generate-release-artifacts.mjs"), "utf8");
  const evidenceCore = fs.readFileSync(path.join(repositoryRoot, "scripts", "release-evidence-core.mjs"), "utf8");
  const candidateSource = fs.readFileSync(path.join(repositoryRoot, "scripts", "prepare-release-candidate.mjs"), "utf8");
  assert.match(source, /"tar\.umask=0022"/u);
  assert.doesNotMatch(source, /"tar\.umask=0000"/u);
  assert.match(source, /parseBoundedStrictJsonBytes/u);
  assert.doesNotMatch(`${source}\n${evidenceCore}\n${candidateSource}`, /localeCompare/u);
  assert.match(evidenceCore, /return `%40\$\{encodeURIComponent\(name\.slice\(1, separator\)\)\}\/\$\{encodeURIComponent\(name\.slice\(separator \+ 1\)\)\}`/u);
});

test("release output containment rejects an in-repository ..x directory and permits a real parent path", (t) => {
  const script = path.join(repositoryRoot, "scripts", "generate-release-artifacts.mjs");
  const evidenceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "release-evidence-probe-"));
  t.after(() => fs.rmSync(evidenceRoot, { recursive: true, force: true }));
  const evidence = path.join(evidenceRoot, "evidence.json");
  fs.writeFileSync(evidence, "{}\n");
  const inside = childProcess.spawnSync(
    process.execPath,
    [
      script,
      "--tag", "v0.11.0",
      "--output-dir", path.join(repositoryRoot, "..x-release-output"),
      "--kernel-evidence", evidence
    ],
    { cwd: repositoryRoot, encoding: "utf8", shell: false, stdio: ["ignore", "pipe", "pipe"] }
  );
  assert.notEqual(inside.status, 0);
  assert.match(inside.stderr, /--output-dir must be outside the repository/u);

  const outside = fs.mkdtempSync(path.join(path.dirname(repositoryRoot), "release-output-parent-"));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.writeFileSync(path.join(outside, "sentinel"), "keep non-empty\n");
  const escaped = childProcess.spawnSync(
    process.execPath,
    [script, "--tag", "v0.11.0", "--output-dir", outside, "--kernel-evidence", evidence],
    { cwd: repositoryRoot, encoding: "utf8", shell: false, stdio: ["ignore", "pipe", "pipe"] }
  );
  assert.notEqual(escaped.status, 0);
  assert.doesNotMatch(escaped.stderr, /--output-dir must be outside the repository/u);
});

test("release candidate preparation is local-only and exposes its safety contract", () => {
  const script = path.join(repositoryRoot, "scripts", "prepare-release-candidate.mjs");
  const result = childProcess.spawnSync(process.execPath, [script, "--help"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    shell: false,
    stdio: ["ignore", "pipe", "pipe"]
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /three clean host installations/u);
  assert.match(result.stdout, /operator-selected policy digest can validate signatures but cannot independently clear a release gate/u);
  assert.match(result.stdout, /performs no push, tag, release, deployment, signing, submission, or other external write/u);

  const source = fs.readFileSync(script, "utf8");
  assert.match(source, /"--kernel-evidence-out", kernelEvidencePath/u);
  assert.equal([...source.matchAll(/"--kernel-evidence", kernelEvidencePath/gmu)].length, 2);
  assert.match(source, /"release-artifacts-two-build-reproducibility"/u);
  assert.doesNotMatch(source, /"--kernel-check"/u);
  assert.doesNotMatch(source, /"--kernel",/u);
  assert.match(source, /\["skill", "publish", "--dry-run"\]/u);
  assert.match(source, /"verify-release-checksums"/u);
  assert.match(source, /"verify-extracted-release-archive"/u);
  assert.match(source, /LOCAL_INFRASTRUCTURE_AND_PACKAGING_REHEARSAL_VERIFIED/u);
  assert.doesNotMatch(source, /LOCAL_RELEASE_CANDIDATE_VERIFIED/u);
  assert.match(source, /releaseCandidate: false/u);
  assert.match(source, /externalEvidenceVerification = verifyExternalEvidenceBundle\(\{/u);
  assert.match(source, /evidencePath: options\.externalEvidencePath \?\? null/u);
  assert.match(source, /operatorSelectedPolicySha256: options\.externalEvidenceOperatorPolicySha256 \?\? null/u);
  assert.match(source, /externalEvidenceVerification,/u);
  assert.match(source, /modelEvalState: modelEvidence\?\.status === "VERIFIED_EXTERNAL_EVIDENCE" \? "EXTERNALLY_VERIFIED" : "EXTERNAL_BLOCKED"/u);
  assert.match(source, /requiredExecutionKind: "REAL_REPOSITORY_E2E"/u);
  assert.match(source, /requiredVerdict: "PASS"/u);
  assert.match(source, /requiredSourceBinding: \{ commit, tree, skillTree \}/u);
  assert.match(source, /evidence: modelEvidence\?\.status === "VERIFIED_EXTERNAL_EVIDENCE" \? modelEvidence : null/u);
  assert.match(source, /const externalEvidenceArguments = options\.externalEvidencePath \? \[\s+"--external-evidence", options\.externalEvidencePath,\s+"--external-evidence-operator-policy-sha256", options\.externalEvidenceOperatorPolicySha256\s+\] : \[\];/u);
  assert.match(source, /if \(\(values\.externalEvidencePath === undefined\) !== \(values\.externalEvidenceOperatorPolicySha256 === undefined\)\) \{\s+fail\("--external-evidence and --external-evidence-operator-policy-sha256 must be provided together"\);/u);
  assert.match(source, /externallyVerifiedGateIds: externalEvidenceVerification\.verifiedGateIds/u);
  assert.match(source, /signatureValidExternalEvidenceGateIds: externalEvidenceVerification\.signatureValidGateIds/u);
  for (const blocker of [
    "REAL_MODEL_TIERS_AND_INDEPENDENT_JUDGE",
    "TRUSTED_SEPARATE_UID_OR_CONTAINER_SANDBOX",
    "PUBLIC_COMPARABLE_REPOSITORY_E2E_POPULATION",
    "INDEPENDENT_NOVEL_HOLDOUT_AND_PRIOR_RELEASE_COMPARATOR",
    "FORK_RPC_FOR_FORK_DEPENDENT_CASES",
    "INSTALLED_HOST_NATURAL_LANGUAGE_TO_SUBMISSION"
  ]) assert.match(source, new RegExp(blocker, "u"), blocker);
  assert.doesNotMatch(source, /\["skill", "publish", "--tag"/u);
  assert.doesNotMatch(source, /\["release", "create"/u);
  assert.doesNotMatch(source, /\["push"/u);
});
