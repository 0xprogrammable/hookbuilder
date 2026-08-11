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

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, "..");
const expectedTopLevel = [
  ".agents", ".claude-plugin", ".codex-plugin", ".editorconfig", ".gitattributes", ".github", ".gitignore", ".mcp.json",
  "AGENTS.md", "CHANGELOG.md", "CODE_OF_CONDUCT.md", "CONTRIBUTING.md", "GOVERNANCE.md", "LICENSE",
  "NOTICE.md", "README.md", "SECURITY.md", "SUPPORT.md", "assets", "config", "docs", "evals",
  "mcp", "package-lock.json", "package.json", "plugins", "scripts", "skills", "submissions", "test"
];
const forbiddenTransientDirectories = new Set(["node_modules", "coverage", "broadcast", "cache", "out"]);

function walk(directory) {
  const rows = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    if (directory === repositoryRoot && entry.name === ".git") continue;
    const absolutePath = path.join(directory, entry.name);
    const relativePath = path.relative(repositoryRoot, absolutePath).split(path.sep).join("/");
    const stat = fs.lstatSync(absolutePath);
    rows.push({ absolutePath, relativePath, stat });
    if (
      stat.isDirectory()
      && !stat.isSymbolicLink()
      && !forbiddenTransientDirectories.has(entry.name)
    ) rows.push(...walk(absolutePath));
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

test("repository has one closed top-level product structure and one generated skill mirror", () => {
  const actual = fs.readdirSync(repositoryRoot).filter((name) => name !== ".git").sort();
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

test("version and plugin identities agree across canonical and generated packages", () => {
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
  assert.equal(packageDocument.engines.node, ">=20");
  assert.equal(packageDocument.packageManager, "npm@11.16.0");
  assert.equal(packageDocument.repository.url, "git+https://github.com/0xprogrammable/hookbuilder.git");
  assert.equal(packageDocument.bugs.url, "https://github.com/0xprogrammable/hookbuilder/issues");
  assert.equal(packageDocument.homepage, "https://github.com/0xprogrammable/hookbuilder#readme");
  assert.equal(Object.hasOwn(packageDocument, "dependencies"), false);
  assert.equal(Object.hasOwn(packageDocument, "devDependencies"), false);
  assert.equal(packageDocument.version, "0.5.1");
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
  assert.match(skill, /For v4 start with all 14 permissions disabled\./u);
  assert.match(skill, /For canonical v4 classify all four\s+direction\/exactness quadrants\./u);
  assert.match(skill, /Prove supported and pre-effects rejection for unsupported ones\./u);
  assert.match(skill, /Hidden mint, seizure, fee, pause, upgrade or payout redirection conflicts/u);
  assert.match(skill, /disclosed powers require review/iu);
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
  assert.equal(report.version, "0.5.1");
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
});

test("plugin manifest generation fails closed on package version skew", (t) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-plugin-version-skew-"));
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  for (const directory of ["scripts", "config", ".codex-plugin", ".agents/plugins", ".claude-plugin"]) {
    fs.mkdirSync(path.join(fixtureRoot, directory), { recursive: true });
  }
  for (const relativePath of [
    "scripts/generate-plugin-manifests.mjs",
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
  assert.match(result.stderr, /plugin metadata version must match package\.json/u);
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
    "    name: Internal / repository and skill / Node ${{ matrix.node }}\n",
    "    name: Internal / reference fee kernel / ${{ matrix.kernel }}\n",
    "    name: Internal / CodeQL\n"
  ]) assert.ok(workflow.includes(requiredJobName), requiredJobName.trim());
  const checkoutSteps = workflow.match(/^\s*uses: actions\/checkout@[0-9a-f]{40}.*\n\s*with:\n(?:\s{10}.*\n)+/gmu) ?? [];
  assert.equal(checkoutSteps.length, 9);
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
  const repositoryJobStart = workflow.indexOf("  repository:\n");
  const repositoryJobEnd = workflow.indexOf("\n  reference-kernel:\n", repositoryJobStart);
  assert.ok(repositoryJobStart >= 0 && repositoryJobEnd > repositoryJobStart, "repository job boundary missing");
  const repositoryJob = workflow.slice(repositoryJobStart, repositoryJobEnd);
  assert.match(repositoryJob, /^\s*uses: foundry-rs\/foundry-toolchain@908c540300062bd5a7e473851cdb4282204cee09 # v1$/mu);
  assert.match(repositoryJob, /^\s*version: v1\.7\.1$/mu);
  assert.match(repositoryJob, /^\s*mkdir -p -- "\$RUNNER_TEMP\/programmable-foundry-bootstrap"$/mu);
  assert.match(repositoryJob, /^\s*forge build --use 0\.8\.26 --root "\$RUNNER_TEMP\/programmable-foundry-bootstrap"$/mu);
  const foundryInstall = repositoryJob.indexOf("Install Foundry");
  const compilerPreload = repositoryJob.indexOf("Preload the portable-test Solidity compiler");
  const repositoryGate = repositoryJob.indexOf("run: npm test");
  assert.ok(foundryInstall >= 0 && foundryInstall < compilerPreload && compilerPreload < repositoryGate);
  const kernelJobStart = workflow.indexOf("  reference-kernel:\n");
  const kernelJobEnd = workflow.indexOf("\n  reference-kernel-required:\n", kernelJobStart);
  assert.ok(kernelJobStart >= 0 && kernelJobEnd > kernelJobStart, "reference-kernel job boundary missing");
  const kernelJob = workflow.slice(kernelJobStart, kernelJobEnd);
  const kernelRoot = "skills/programmable-v4-hook-builder/assets/reference-kernels";
  for (const version of ["v1", "v2"]) {
    const workdir = `${kernelRoot}/programmable-volume-fee-${version}`;
    assert.ok(fs.existsSync(path.join(repositoryRoot, workdir, "package-lock.json")), `${version} lockfile missing`);
    assert.ok(fs.existsSync(path.join(repositoryRoot, workdir, "foundry.toml")), `${version} Foundry profile missing`);
    assert.match(kernelJob, new RegExp(`workdir: ${workdir.replaceAll("/", "\\/")}$`, "mu"), `${version} CI workdir missing`);
    assert.match(
      kernelJob,
      new RegExp(`lockfile: ${workdir.replaceAll("/", "\\/")}\\/package-lock\\.json$`, "mu"),
      `${version} CI lockfile missing`
    );
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
  const requiredJobEnd = workflow.indexOf("\n  codeql:\n", requiredJobStart);
  assert.ok(requiredJobStart >= 0 && requiredJobEnd > requiredJobStart, "reference-kernel required-check aggregator boundary missing");
  const requiredJob = workflow.slice(requiredJobStart, requiredJobEnd);
  assert.match(requiredJob, /^\s*name: Internal \/ reference fee kernel aggregate$/mu);
  assert.match(requiredJob, /^\s*needs: \[plan, reference-kernel\]$/mu);
  assert.match(requiredJob, /^\s*if: \$\{\{ always\(\) && \(needs\.plan\.outputs\.mode == 'platform' \|\| needs\.plan\.outputs\.mode == 'mixed'\) \}\}$/mu);
  assert.match(requiredJob, /^\s*MATRIX_RESULT: \$\{\{ needs\.reference-kernel\.result \}\}$/mu);
  assert.match(requiredJob, /^\s*run: test "\$MATRIX_RESULT" = success$/mu);
  assert.equal([...workflow.matchAll(/^\s*name: Internal \/ reference fee kernel aggregate$/gmu)].length, 1);
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
      "--tag", "v0.5.1",
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
    [script, "--tag", "v0.5.1", "--output-dir", outside, "--kernel-evidence", evidence],
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
