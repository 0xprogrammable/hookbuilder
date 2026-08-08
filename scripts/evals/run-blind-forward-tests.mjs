#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { canonicalJson, FROZEN_MAINNET_FORK_CANARY, validateReadOnlyForkReplay } from "./blind-fork-canary-core.mjs";
import { inspectProvisionedSolcToolchain, provisionSolcToolchain, resolveSolcToolchainSources } from "./blind-subject-toolchain-core.mjs";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "../..");
const SKILL_PATH = "skills/programmable-v4-hook-builder";
const FINAL_STATE = ".programmable/project-states/000006-submission-evidence.v1.json";
const PREVIOUS_STATE = ".programmable/project-states/000005-verification.v1.json";
const EXACT_STATE_NAMES = Object.freeze([
  "000001-project-spec.v1.json",
  "000002-product-graphs.v1.json",
  "000003-architecture-selection.v1.json",
  "000004-repository-materialization.v1.json",
  "000005-verification.v1.json",
  "000006-submission-evidence.v1.json",
]);
const GITHUB_SUBMISSION_HANDOFF_PREFIX = "# GitHub submission handoff\n\n";
export const FROZEN_PROJECT_GATE = Object.freeze({
  sourcePath: "tools/run-project-gate.mjs",
  normalizedMarketRef: "__MARKET_REF__",
  normalizedSourceSha256: "sha256:97fca4f2a8076bb9b3e7903f1481950b6a7f567afb6a0e147ce6e08a01935009",
  marketRefOccurrences: 4,
  commands: Object.freeze({
    install: Object.freeze({ id: "install-command", kind: "install", networkAccess: "read-only", timeoutMs: 600_000, stdout: "install:passed\n" }),
    build: Object.freeze({ id: "build-command", kind: "build", networkAccess: "forbidden", timeoutMs: 600_000, stdout: "build:passed\n" }),
    fork: Object.freeze({ id: "fork-command", kind: "fork", networkAccess: "read-only", timeoutMs: 300_000, stdout: "fork:passed\n" }),
  }),
  buildInfo: Object.freeze({
    units: Object.freeze([
      Object.freeze({ compilerVersion: "0.8.17", componentRefs: Object.freeze(["pinned-route-component"]), evmTarget: "london", cborMetadata: true, sourceRootSetSha256: "sha256:4d86ea106db0eb25b60246b43cea9084234ca789e9996f5dd0c5ac4ae4e5bd44" }),
      Object.freeze({ compilerVersion: "0.8.26", componentRefs: Object.freeze(["factory-component", "service-component", "v4-hook-factory-system", "v4-hook-system"]), evmTarget: "cancun", cborMetadata: false, sourceRootSetSha256: "sha256:559b8a290a6443f8284222d627f547ddeff64b11835eaca1a71dfd774dba3b71" }),
    ]),
    optimizer: Object.freeze({ enabled: true, runs: 200 }),
    viaIr: true,
    bytecodeHash: "none",
    appendCborDefault: true,
  }),
  testForkSplit: Object.freeze({
    fullArgv: Object.freeze(["forge", "test", "--offline", "-q", "--no-match-path", FROZEN_MAINNET_FORK_CANARY.sourcePath]),
    forkArgv: Object.freeze([...FROZEN_MAINNET_FORK_CANARY.command.argv]),
  }),
});
const SUBMISSION_ROOT = "submission";
const DEFAULT_TIMEOUT_MS = 45 * 60 * 1000;
const MAX_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const MAX_CAPTURE_BYTES = 128 * 1024 * 1024;
const MAX_AMBIENT_TMP_ENTRIES = 100_000;
const SUBJECT_IDEA_PATH = "idea.txt";
export const SUBJECT_IDEA_PROVENANCE_INSTRUCTION = "The exact original request bytes are pre-provisioned in idea.txt. Use idea.txt unchanged as the idea source; never rewrite or extract it.";
const PROMPT_FORBIDDEN = /(?:\b(?:architecture|artifact|audit|finding|fixture|manifest|materialize|permit2|preflight|productgraph|projectspec|projectstate|receipt|repositoryplan|require-output|rubric|schema|submission|sweep|validator|v4quoter)\b|universal\s+router|\.programmable|PROJECT_PREFLIGHT|\.json\b|\.mjs\b|\.sol\b|scripts\/|--[a-z])/iu;

process.umask(0o077);

export class BlindForwardError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "BlindForwardError";
    this.code = code;
    Object.assign(this, details);
  }
}

export function validateNaturalPrompt(bytes, lane) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > 1400) {
    throw new BlindForwardError("PROMPT_INVALID", `${lane} prompt must contain 1-1400 UTF-8 bytes`);
  }
  const text = bytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(bytes) || text.includes("\0") || text.trim() !== text) {
    throw new BlindForwardError("PROMPT_INVALID", `${lane} prompt must be exact, trimmed UTF-8 text`);
  }
  const words = text.split(/\s+/u).filter(Boolean);
  const sentences = (text.match(/[.!?](?=\s|$)/gu) ?? []).length;
  if (words.length < 12 || words.length > 120 || sentences < 2 || sentences > 5) {
    throw new BlindForwardError("PROMPT_INVALID", `${lane} prompt must be two to five short natural sentences`);
  }
  if (!/Programmable(?:n)?\s+(?:Skill|Hookbuilder)/iu.test(text)) {
    throw new BlindForwardError("PROMPT_INVALID", `${lane} prompt must generically request the installed Programmable skill`);
  }
  if (PROMPT_FORBIDDEN.test(text) || /[`]|https?:\/\/|(?:^|\s)\/[A-Za-z0-9._-]/u.test(text)) {
    throw new BlindForwardError("PROMPT_LEAKAGE", `${lane} prompt contains implementation, validation, path, or solution leakage`);
  }
  return Object.freeze({ text, byteLength: bytes.length, sha256: sha256(bytes), wordCount: words.length, sentenceCount: sentences });
}

export function buildSubjectMessage(expectedIdeaBytes) {
  if (!Buffer.isBuffer(expectedIdeaBytes) || expectedIdeaBytes.length === 0 || !Buffer.from(expectedIdeaBytes.toString("utf8"), "utf8").equals(expectedIdeaBytes)) {
    throw new BlindForwardError("PROMPT_INVALID", "subject message requires exact non-empty UTF-8 idea bytes");
  }
  return Buffer.concat([expectedIdeaBytes, Buffer.from(`\n\n${SUBJECT_IDEA_PROVENANCE_INSTRUCTION}`, "utf8")]);
}

export function validateProvisionedSubjectIdea({ workspace, expectedIdeaBytes }) {
  const issues = [];
  const target = path.join(workspace, SUBJECT_IDEA_PATH);
  let actualBytes = null;
  let stat = null;
  if (!Buffer.isBuffer(expectedIdeaBytes) || expectedIdeaBytes.length === 0 || !Buffer.from(expectedIdeaBytes.toString("utf8"), "utf8").equals(expectedIdeaBytes)) {
    issues.push("expected subject idea bytes are missing or not exact UTF-8");
  }
  try {
    stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink()) issues.push("pre-provisioned idea.txt must be a regular non-symlink file");
    else actualBytes = fs.readFileSync(target);
  } catch {
    issues.push("pre-provisioned idea.txt is missing");
  }
  if (actualBytes !== null && (!Buffer.isBuffer(expectedIdeaBytes) || !actualBytes.equals(expectedIdeaBytes))) issues.push("pre-provisioned idea.txt differs from the exact original request bytes");
  return Object.freeze({
    valid: issues.length === 0,
    issues,
    path: SUBJECT_IDEA_PATH,
    expectedByteLength: Buffer.isBuffer(expectedIdeaBytes) ? expectedIdeaBytes.length : null,
    expectedSha256: Buffer.isBuffer(expectedIdeaBytes) ? sha256(expectedIdeaBytes) : null,
    actualByteLength: actualBytes?.length ?? null,
    actualSha256: actualBytes === null ? null : sha256(actualBytes),
    mode: stat === null ? null : stat.mode & 0o777,
  });
}

export function provisionSubjectIdea({ workspace, expectedIdeaBytes }) {
  const target = path.join(workspace, SUBJECT_IDEA_PATH);
  if (fs.existsSync(target)) throw new BlindForwardError("SUBJECT_IDEA_EXISTS", "subject workspace idea.txt already exists");
  writePrivate(target, expectedIdeaBytes, 0o400);
  const capture = validateProvisionedSubjectIdea({ workspace, expectedIdeaBytes });
  if (!capture.valid) throw new BlindForwardError("SUBJECT_IDEA_CAPTURE_FAILED", capture.issues.join("; "));
  return capture;
}

export function inventoryDirectory(root) {
  const realRoot = fs.realpathSync(root);
  const files = [];
  const pending = [realRoot];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => b.name.localeCompare(a.name))) {
      const absolute = path.join(directory, entry.name);
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) throw new BlindForwardError("INVENTORY_SYMLINK", `symlink is forbidden: ${absolute}`);
      if (stat.isDirectory()) pending.push(absolute);
      else if (stat.isFile()) {
        const bytes = fs.readFileSync(absolute);
        files.push({
          path: path.relative(realRoot, absolute).split(path.sep).join("/"),
          mode: stat.mode & 0o777,
          byteLength: bytes.length,
          sha256: sha256(bytes),
        });
      }
    }
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  const inventoryBytes = Buffer.from(files.map((file) => (
    `${file.path}\0${file.mode.toString(8)}\0${file.byteLength}\0${file.sha256}\n`
  )).join(""), "utf8");
  return Object.freeze({ fileCount: files.length, totalByteLength: files.reduce((sum, file) => sum + file.byteLength, 0), inventorySha256: sha256(inventoryBytes), files });
}

export function buildCodexArguments({ workspace, finalOutput, model, shellEnvironment = {} }) {
  const explicitWritableRoots = [shellEnvironment.TMPDIR, shellEnvironment.npm_config_cache];
  if (explicitWritableRoots.some((root) => typeof root !== "string" || !path.isAbsolute(root)) || new Set(explicitWritableRoots).size !== explicitWritableRoots.length) {
    throw new BlindForwardError("SUBJECT_SANDBOX_INVALID", "subject sandbox requires distinct absolute lane TMPDIR and npm cache roots");
  }
  const shellOverrides = Object.entries(shellEnvironment).sort(([left], [right]) => left.localeCompare(right)).flatMap(([key, value]) => [
    "-c", `shell_environment_policy.set.${key}=${JSON.stringify(value)}`,
  ]);
  return Object.freeze([
    "exec",
    "--ephemeral",
    "--ignore-user-config",
    "--ignore-rules",
    "--strict-config",
    "--model", model,
    "--sandbox", "workspace-write",
    "-c", "approval_policy=\"never\"",
    "-c", "sandbox_workspace_write.network_access=true",
    "-c", "sandbox_workspace_write.exclude_tmpdir_env_var=true",
    "-c", "sandbox_workspace_write.exclude_slash_tmp=true",
    "-c", `sandbox_workspace_write.writable_roots=${JSON.stringify(explicitWritableRoots)}`,
    "-c", "shell_environment_policy.inherit=\"none\"",
    ...shellOverrides,
    "--cd", workspace,
    "--json",
    "--color", "never",
    "--output-last-message", finalOutput,
    "-",
  ]);
}

export function inventoryAmbientTmpRoots({ excludedRoots = [] } = {}) {
  const roots = [...new Set(["/tmp", "/private/tmp"].filter((root) => fs.existsSync(root)).map((root) => fs.realpathSync(root)))].sort();
  const excluded = excludedRoots.map((root) => fs.realpathSync(root));
  const entries = [];
  for (const root of roots) {
    const names = fs.readdirSync(root).sort();
    if (names.length > MAX_AMBIENT_TMP_ENTRIES) throw new BlindForwardError("AMBIENT_TMP_UNBOUNDED", `${root} exceeds the bounded ambient tmp inventory`);
    for (const name of names) {
      const absolute = path.join(root, name);
      if (excluded.some((candidate) => isInside(absolute, candidate))) continue;
      const stat = fs.lstatSync(absolute);
      entries.push({ path: absolute, kind: stat.isDirectory() ? "directory" : stat.isFile() ? "file" : stat.isSymbolicLink() ? "symlink" : "other", device: stat.dev, inode: stat.ino });
    }
  }
  const bytes = Buffer.from(entries.map((entry) => `${entry.path}\0${entry.kind}\0${entry.device}\0${entry.inode}\n`).join(""), "utf8");
  return Object.freeze({ roots, entryCount: entries.length, sha256: sha256(bytes), entries: Object.freeze(entries.map(Object.freeze)) });
}

export function compareAmbientTmpInventories(before, after) {
  const beforePaths = new Set(before.entries.map(({ path: entryPath }) => entryPath));
  const afterPaths = new Set(after.entries.map(({ path: entryPath }) => entryPath));
  return Object.freeze({
    added: Object.freeze(after.entries.filter(({ path: entryPath }) => !beforePaths.has(entryPath))),
    removed: Object.freeze(before.entries.filter(({ path: entryPath }) => !afterPaths.has(entryPath))),
  });
}

function normalizeObservedAbsolutePath(observedPath) {
  const trimmed = observedPath.replace(/[),.:]+$/u, "");
  if (trimmed === "/tmp" || trimmed.startsWith("/tmp/")) return path.join(fs.realpathSync("/tmp"), trimmed.slice(5));
  return path.resolve(trimmed);
}

export function inspectTranscriptOutOfLaneWrites({ transcriptPath, allowedRoots }) {
  const roots = allowedRoots.map((root) => fs.realpathSync(root));
  const attempts = [];
  const lines = fs.readFileSync(transcriptPath, "utf8").split(/\r?\n/u).filter(Boolean);
  for (let lineNumber = 0; lineNumber < lines.length; lineNumber += 1) {
    let event;
    try { event = JSON.parse(lines[lineNumber]); }
    catch { continue; }
    if (event?.item?.type === "file_change") {
      for (const change of event.item.changes ?? []) {
        if (typeof change.path !== "string" || !path.isAbsolute(change.path)) continue;
        const observedPath = normalizeObservedAbsolutePath(change.path);
        if (!roots.some((root) => isInside(observedPath, root))) attempts.push({ lineNumber: lineNumber + 1, operation: "file-change", path: observedPath, itemId: event.item.id ?? null });
      }
    }
    if (event?.item?.type !== "command_execution" || typeof event.item.command !== "string") continue;
    const command = event.item.command;
    const mutatingSegments = [
      ...[...command.matchAll(/(?:^|[;&|'"]\s*|\s)(mv|cp|mkdir|touch|install|rm|ln|chmod|chown|truncate|tee)\s+([^;&|\n]+)/gu)].map((match) => ({ operation: match[1], text: match[0] })),
      ...[...command.matchAll(/(?:^|[;&|'"]\s*|\s)(?:printf|echo)\b([^;&|\n]*?(?:>>?|\|\s*tee\s+)[^;&|\n]+)/gu)].map((match) => ({ operation: "redirect", text: match[0] })),
    ];
    for (const segment of mutatingSegments) {
      const absolutePaths = segment.text.match(/\/(?:[^\s'";&|<>])+/gu) ?? [];
      for (const rawPath of absolutePaths) {
        const observedPath = normalizeObservedAbsolutePath(rawPath);
        if (!roots.some((root) => isInside(observedPath, root))) attempts.push({ lineNumber: lineNumber + 1, operation: segment.operation, path: observedPath, itemId: event.item.id ?? null });
      }
    }
  }
  const unique = [...new Map(attempts.map((attempt) => [`${attempt.lineNumber}\0${attempt.operation}\0${attempt.path}`, attempt])).values()];
  return Object.freeze({ valid: unique.length === 0, attempts: Object.freeze(unique.map(Object.freeze)) });
}

export function classifyCanonicalRepository({ repositoryRoot, expectedClassification }) {
  const read = (relative) => JSON.parse(fs.readFileSync(path.join(repositoryRoot, relative), "utf8"));
  const spec = read(".programmable/project-spec.v1.json");
  const graph = read(".programmable/product-graph.v1.json");
  const architectures = read(".programmable/architecture-candidates.v1.json");
  const plan = read(".programmable/repository-plan.v1.json");
  const submission = read("submission/submission.v2.json");
  const stateDirectory = path.join(repositoryRoot, ".programmable/project-states");
  const stateEntries = fs.readdirSync(stateDirectory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
  const stateNames = stateEntries.map(({ name }) => name);
  const states = stateEntries
    .filter((entry) => EXACT_STATE_NAMES.includes(entry.name) && entry.isFile() && !entry.isSymbolicLink())
    .map((entry) => read(`.programmable/project-states/${entry.name}`));
  const routing = spec?.facets?.routing;
  const entries = Array.isArray(routing?.entries) ? routing.entries : [];
  const tradeEntries = entries.filter((entry) => entry?.kind === "trade-capability");
  const expectedFacet = expectedClassification === "tradable" ? "applicable" : "not-applicable";
  const manifestDirectory = path.join(repositoryRoot, ".programmable/trade-capabilities");
  const manifestEntries = fs.existsSync(manifestDirectory) ? fs.readdirSync(manifestDirectory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name)) : [];
  const manifestNames = manifestEntries.filter(({ name }) => /^[a-z0-9-]+\.v1\.json$/u.test(name)).map(({ name }) => name);
  const manifests = manifestNames.map((name) => read(`.programmable/trade-capabilities/${name}`));
  const manifestMarketRefs = manifests.map(({ marketRef }) => marketRef);
  const planMarketRefs = (plan?.tradeCapability?.markets ?? []).map((market) => market?.marketRef ?? market?.marketSystemRef);
  const submissionMarketRefs = (submission?.tradeCapability?.markets ?? []).map((market) => market?.marketRef ?? market?.marketSystemRef);
  const ids = [spec.applicationId, graph.applicationId, architectures.applicationId, plan.applicationId, submission.applicationId, ...states.map(({ applicationId }) => applicationId), ...manifests.map(({ applicationId }) => applicationId)];
  const issues = [];
  if (JSON.stringify(stateNames) !== JSON.stringify(EXACT_STATE_NAMES)) issues.push("project state chain must contain exactly the six canonical phases");
  if (stateEntries.some((entry) => !entry.isFile() || entry.isSymbolicLink())) issues.push("project state directory must contain only regular files");
  if (manifestEntries.some((entry) => !entry.isFile() || entry.isSymbolicLink() || !/^[a-z0-9-]+\.v1\.json$/u.test(entry.name))) issues.push("trade-capabilities directory contains a noncanonical entry");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(spec.applicationId ?? "")) issues.push("ProjectSpec applicationId is not canonical");
  if (new Set(ids).size !== 1) issues.push("applicationId differs across canonical artifacts");
  if (entries.length !== 1 || tradeEntries.length !== 1) issues.push("routing must contain exactly one trade-capability entry");
  if (routing?.applicability !== expectedFacet || tradeEntries[0]?.applicability !== expectedFacet) issues.push("ProjectSpec routing classification differs from the lane");
  if (plan?.tradeCapability?.applicability !== expectedClassification) issues.push("RepositoryPlan trade classification differs from the lane");
  if (submission?.tradeCapability?.applicability !== expectedClassification) issues.push("Submission trade classification differs from the lane");
  if (expectedClassification === "tradable") {
    if (manifestNames.length !== 1) issues.push("tradable blind output must contain exactly one canonical trade manifest");
    if (!Array.isArray(plan?.tradeCapability?.markets) || plan.tradeCapability.markets.length !== 1) issues.push("tradable blind plan must contain exactly one market");
    if (!Array.isArray(submission?.tradeCapability?.markets) || submission.tradeCapability.markets.length !== 1) issues.push("tradable blind submission must contain exactly one market");
    if (new Set([...manifestMarketRefs, ...planMarketRefs, ...submissionMarketRefs]).size !== 1) issues.push("marketRef differs across manifest, plan, and submission");
    for (const manifest of manifests) if (manifest?.status !== "NOT_APPROVED") issues.push(`trade manifest ${manifest?.manifestId ?? "unknown"} is not NOT_APPROVED`);
  } else {
    if (manifestNames.length !== 0) issues.push("no-market output contains a trade manifest");
    if ((plan?.tradeCapability?.markets ?? []).length !== 0) issues.push("no-market plan contains a market");
    if ((submission?.tradeCapability?.markets ?? []).length !== 0) issues.push("no-market submission contains a market");
  }
  return Object.freeze({
    valid: issues.length === 0,
    issues,
    applicationId: spec.applicationId ?? null,
    marketRef: expectedClassification === "tradable" && new Set([...manifestMarketRefs, ...planMarketRefs, ...submissionMarketRefs]).size === 1 ? manifestMarketRefs[0] ?? null : null,
    stateNames,
    manifestNames,
    implementation: {
      sourcePaths: Array.isArray(submission?.implementation?.sourcePaths) ? submission.implementation.sourcePaths : [],
      testPaths: Array.isArray(submission?.implementation?.testPaths) ? submission.implementation.testPaths : [],
    },
  });
}

export function validatePromptIntentBinding({ repositoryRoot, trackedPaths, expectedIdeaBytes }) {
  const issues = [];
  if (!Buffer.isBuffer(expectedIdeaBytes) || expectedIdeaBytes.length === 0 || !Buffer.from(expectedIdeaBytes.toString("utf8"), "utf8").equals(expectedIdeaBytes)) {
    return Object.freeze({ valid: false, issues: ["blind prompt bytes are missing or not exact UTF-8"], sha256: null, byteLength: null });
  }
  const expectedText = expectedIdeaBytes.toString("utf8");
  const expectedSha256 = sha256(expectedIdeaBytes);
  let spec = null;
  let submission = null;
  try { spec = JSON.parse(fs.readFileSync(path.join(repositoryRoot, ".programmable/project-spec.v1.json"), "utf8")); }
  catch { issues.push("ProjectSpec cannot be read for prompt binding"); }
  try { submission = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "submission/submission.v2.json"), "utf8")); }
  catch { issues.push("Submission V2 cannot be read for prompt binding"); }
  const intent = spec?.intent;
  if (!exactKeys(intent, ["encoding", "verbatimText", "byteLength", "sha256"]) || intent.encoding !== "utf-8" || intent.verbatimText !== expectedText || intent.byteLength !== expectedIdeaBytes.length || intent.sha256 !== expectedSha256) issues.push("ProjectSpec intent does not exactly bind the blind prompt bytes");
  const ideaBinding = submission?.intentPackage?.ideaSource;
  const ideaRelativePath = typeof ideaBinding?.path === "string" && /^[a-z0-9][a-z0-9._/-]*\.json$/u.test(ideaBinding.path) && !ideaBinding.path.split("/").includes("..") ? `submission/${ideaBinding.path}` : null;
  let ideaBytes = null;
  if (ideaRelativePath === null) issues.push("Submission idea-source binding path is unsafe or missing");
  else ideaBytes = readRegularTrackedFile(repositoryRoot, trackedPaths, ideaRelativePath, issues);
  let ideaSource = null;
  if (ideaBytes !== null) {
    try { ideaSource = JSON.parse(ideaBytes.toString("utf8")); }
    catch { issues.push("Submission idea-source artifact is not JSON"); }
    if (ideaBinding.sha256 !== sha256(ideaBytes) || ideaBinding.byteLength !== ideaBytes.length || ideaBinding.artifactType !== "idea-source") issues.push("Submission idea-source artifact bytes differ from their binding");
  }
  const entries = Array.isArray(ideaSource?.entries) ? ideaSource.entries : [];
  const original = entries.filter(({ id }) => id === ideaSource?.originalEntryId);
  if (ideaSource?.captureStatus !== "captured-verbatim-public-safe" || entries.length !== 1 || original.length !== 1 || original[0].publicationStatus !== "public-safe" || original[0].publicTextUtf8 !== expectedText || original[0].sha256 !== expectedSha256 || original[0].byteLength !== expectedIdeaBytes.length) issues.push("Submission idea-source does not exactly preserve the blind prompt bytes");
  return Object.freeze({ valid: issues.length === 0, issues, sha256: expectedSha256, byteLength: expectedIdeaBytes.length, projectSpecBound: issues.every((issue) => !issue.startsWith("ProjectSpec")), submissionIdeaSourcePath: ideaRelativePath });
}

export function runStrictOutputGate({ repositoryRoot, installedSkillRoot, evidenceDirectory, expectedClassification, expectedIdeaBytes }) {
  fs.mkdirSync(evidenceDirectory, { recursive: true, mode: 0o700 });
  const cli = path.join(installedSkillRoot, "scripts/cli.mjs");
  const args = [
    cli, "project", "require-output",
    "--repository-root", repositoryRoot,
    "--state", FINAL_STATE,
    "--previous-state", PREVIOUS_STATE,
    "--submission-root", SUBMISSION_ROOT,
  ];
  const result = captured(process.execPath, args, { cwd: repositoryRoot, maximumBytes: MAX_CAPTURE_BYTES });
  writePrivate(path.join(evidenceDirectory, "require-output.stdout"), result.stdout);
  writePrivate(path.join(evidenceDirectory, "require-output.stderr"), result.stderr);
  let report = null;
  try { report = JSON.parse(result.stdout.toString("utf8")); } catch {}
  const commands = {
    requireOutput: { argv: ["node", "<installed-skill>/scripts/cli.mjs", ...args.slice(1).map((value) => value === repositoryRoot ? "<repository>" : value)], exitCode: result.status },
  };
  const issues = [];
  if (result.status !== 0) issues.push(`require-output exited ${result.status}`);
  if (report?.status !== "PROJECT_PREFLIGHT_VALID" || report?.canonicalOutput !== true) issues.push("require-output did not return PROJECT_PREFLIGHT_VALID with canonicalOutput true");
  for (const file of [FINAL_STATE, PREVIOUS_STATE, "submission/submission.v2.json"]) {
    if (!fs.existsSync(path.join(repositoryRoot, file))) issues.push(`missing ${file}`);
  }
  const fsck = captured("git", ["fsck", "--strict"], { cwd: repositoryRoot });
  commands.gitFsck = { argv: ["git", "fsck", "--strict"], exitCode: fsck.status };
  writePrivate(path.join(evidenceDirectory, "git-fsck.stdout"), fsck.stdout);
  writePrivate(path.join(evidenceDirectory, "git-fsck.stderr"), fsck.stderr);
  if (fsck.status !== 0) issues.push(`git fsck exited ${fsck.status}`);
  const status = git(repositoryRoot, ["status", "--porcelain=v1", "--untracked-files=all"], false);
  writePrivate(path.join(evidenceDirectory, "git-status.porcelain"), status.stdout);
  if (status.status !== 0 || status.stdout.length !== 0) issues.push("repository worktree is not clean");
  const head = git(repositoryRoot, ["rev-parse", "HEAD"], false);
  const tree = git(repositoryRoot, ["rev-parse", "HEAD^{tree}"], false);
  const tracked = git(repositoryRoot, ["ls-files", "-z"], false);
  if ([head, tree, tracked].some(({ status: exitCode }) => exitCode !== 0)) issues.push("repository Git identity is incomplete");
  const trackedPaths = tracked.stdout.toString("utf8").split("\0").filter(Boolean);
  if (trackedPaths.some((entry) => path.basename(entry).toLowerCase() === ".npmrc")) issues.push("repository-local npm configuration is forbidden in blind output");
  const filesystemInventory = inspectPhysicalTrackedInventory({ repositoryRoot, trackedPaths });
  writePrivate(path.join(evidenceDirectory, "physical-file-inventory.json"), Buffer.from(`${JSON.stringify(filesystemInventory, null, 2)}\n`));
  issues.push(...filesystemInventory.issues);
  if (!trackedPaths.includes("submission/submission.v2.json")) issues.push("Submission V2 package is not tracked");
  if (!trackedPaths.some((name) => name.startsWith("submission/") && name !== "submission/submission.v2.json")) issues.push("Submission V2 supporting package is incomplete");
  const promptBinding = validatePromptIntentBinding({ repositoryRoot, trackedPaths, expectedIdeaBytes });
  issues.push(...promptBinding.issues);
  let classification = null;
  try {
    classification = classifyCanonicalRepository({ repositoryRoot, expectedClassification });
    issues.push(...classification.issues);
    const { sourcePaths, testPaths } = classification.implementation;
    if (sourcePaths.length < 1 || sourcePaths.some((name) => !trackedPaths.includes(name))) issues.push("Submission source contract paths are missing or untracked");
    if (testPaths.length < 1 || testPaths.some((name) => !trackedPaths.includes(name))) issues.push("Submission test paths are missing or untracked");
    if (expectedClassification === "tradable") {
      if (!sourcePaths.some((name) => /^src\/.+\.sol$/u.test(name))) issues.push("tradable repository has no submitted Solidity contract");
      if (!testPaths.some((name) => /^test\/.+(?:\.t\.sol|\.sol)$/u.test(name))) issues.push("tradable repository has no submitted Solidity test");
    }
  } catch (error) {
    issues.push(`classification inspection failed: ${error.message}`);
  }
  const submissionValidationArgs = [cli, "open-world", "validate", SUBMISSION_ROOT, "--repository-root", repositoryRoot];
  const submissionValidation = captured(process.execPath, submissionValidationArgs, { cwd: repositoryRoot, maximumBytes: MAX_CAPTURE_BYTES });
  writePrivate(path.join(evidenceDirectory, "submission-validation.stdout"), submissionValidation.stdout);
  writePrivate(path.join(evidenceDirectory, "submission-validation.stderr"), submissionValidation.stderr);
  let submissionValidationEnvelope = null;
  try { submissionValidationEnvelope = JSON.parse(submissionValidation.stdout.toString("utf8")); } catch {}
  const submissionReport = submissionValidationEnvelope?.result?.report ?? null;
  commands.validateSubmission = {
    argv: ["node", "<installed-skill>/scripts/cli.mjs", "open-world", "validate", SUBMISSION_ROOT, "--repository-root", "<repository>"],
    exitCode: submissionValidation.status,
  };
  if (submissionValidation.status !== 0 || submissionValidationEnvelope?.ok !== true || submissionValidationEnvelope?.command !== "open-world" || submissionValidationEnvelope?.result?.action !== "validate" || submissionReport?.valid !== true) {
    issues.push("independent Submission V2 validation did not return one valid report");
  }
  const githubSubmission = validateGitHubSubmissionHandoff({
    repositoryRoot,
    trackedPaths,
    expectedClassification,
    expectedIdeaBytes,
    expectedApplicationId: classification?.applicationId ?? null,
    expectedMarketRef: classification?.marketRef ?? null,
    submissionReport,
  });
  issues.push(...githubSubmission.issues);
  return Object.freeze({
    valid: issues.length === 0,
    issues,
    report,
    classification,
    githubSubmission,
    promptBinding,
    filesystemInventory,
    git: {
      head: head.status === 0 ? head.stdout.toString("utf8").trim() : null,
      tree: tree.status === 0 ? tree.stdout.toString("utf8").trim() : null,
      statusClean: status.status === 0 && status.stdout.length === 0,
      statusPath: path.join(evidenceDirectory, "git-status.porcelain"),
      statusSha256: sha256(status.stdout),
      trackedFileCount: trackedPaths.length,
    },
    commands,
  });
}

export function inspectPhysicalTrackedInventory({ repositoryRoot, trackedPaths }) {
  const root = fs.realpathSync(repositoryRoot);
  const physicalPaths = [];
  const nonRegularPaths = [];
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      if (relative === ".git") continue;
      const stat = fs.lstatSync(absolute);
      if (stat.isDirectory() && !stat.isSymbolicLink()) pending.push(absolute);
      else if (stat.isFile() && !stat.isSymbolicLink()) physicalPaths.push(relative);
      else nonRegularPaths.push(relative);
    }
  }
  physicalPaths.sort();
  nonRegularPaths.sort();
  const expected = Array.isArray(trackedPaths) ? [...new Set(trackedPaths)].sort() : [];
  const physical = new Set(physicalPaths);
  const tracked = new Set(expected);
  const extraPaths = physicalPaths.filter((entry) => !tracked.has(entry));
  const missingPaths = expected.filter((entry) => !physical.has(entry));
  const issues = [];
  if (nonRegularPaths.length > 0) issues.push("repository contains non-regular paths outside .git");
  if (extraPaths.length > 0) issues.push("repository contains ignored or untracked physical files outside .git");
  if (missingPaths.length > 0) issues.push("tracked repository files are missing or non-regular");
  return Object.freeze({
    valid: issues.length === 0,
    issues,
    trackedFileCount: expected.length,
    physicalFileCount: physicalPaths.length,
    inventorySha256: sha256(Buffer.from(physicalPaths.join("\0"), "utf8")),
    extraPaths,
    missingPaths,
    nonRegularPaths,
  });
}

function inventoryTrackedFiles(repositoryRoot, trackedPaths) {
  const root = fs.realpathSync(repositoryRoot);
  const files = [...trackedPaths].sort().map((repositoryPath) => {
    const absolute = path.resolve(root, repositoryPath);
    if (!isInside(absolute, root)) return { path: repositoryPath, state: "outside-root" };
    let stat;
    try { stat = fs.lstatSync(absolute); }
    catch (error) { return { path: repositoryPath, state: error.code === "ENOENT" ? "missing" : `error:${error.code ?? "unknown"}` }; }
    if (!stat.isFile() || stat.isSymbolicLink()) return { path: repositoryPath, state: "non-regular" };
    const bytes = fs.readFileSync(absolute);
    return { path: repositoryPath, state: "regular", executable: (stat.mode & 0o111) !== 0, byteLength: bytes.length, sha256: sha256(bytes) };
  });
  return Object.freeze({ fileCount: files.length, inventorySha256: sha256(Buffer.from(JSON.stringify(files), "utf8")), files });
}

export function validateGitHubSubmissionHandoff({
  repositoryRoot,
  trackedPaths,
  expectedClassification,
  expectedIdeaBytes,
  expectedApplicationId,
  expectedMarketRef,
  submissionReport,
}) {
  const issues = [];
  const relativePath = "GITHUB-SUBMISSION.md";
  const bytes = readRegularTrackedFile(repositoryRoot, Array.isArray(trackedPaths) ? trackedPaths : [], relativePath, issues);
  const submissionBytes = readRegularTrackedFile(repositoryRoot, Array.isArray(trackedPaths) ? trackedPaths : [], "submission/submission.v2.json", issues);
  let submission = null;
  if (submissionBytes !== null) {
    try { submission = JSON.parse(submissionBytes.toString("utf8")); }
    catch { issues.push("Submission V2 cannot be parsed for GitHub handoff binding"); }
  }
  if (!Buffer.isBuffer(expectedIdeaBytes) || expectedIdeaBytes.length === 0 || !Buffer.from(expectedIdeaBytes.toString("utf8"), "utf8").equals(expectedIdeaBytes)) issues.push("GitHub handoff requires exact blind prompt bytes");
  if (!["tradable", "no-market"].includes(expectedClassification)) issues.push("GitHub handoff classification expectation is invalid");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(expectedApplicationId ?? "")) issues.push("GitHub handoff application expectation is invalid");
  if ((expectedClassification === "tradable") !== (typeof expectedMarketRef === "string" && expectedMarketRef.length > 0)) issues.push("GitHub handoff market expectation is invalid");
  if (typeof submissionReport?.status !== "string" || typeof submissionReport?.automaticMaterialization !== "boolean" || submissionReport?.valid !== true) issues.push("GitHub handoff requires a fresh valid Submission V2 report");
  let payload = null;
  let canonicalPayload = false;
  if (bytes !== null) {
    const text = bytes.toString("utf8");
    if (!Buffer.from(text, "utf8").equals(bytes)) issues.push("GITHUB-SUBMISSION.md must be exact UTF-8");
    if (!text.startsWith(GITHUB_SUBMISSION_HANDOFF_PREFIX) || !text.endsWith("\n")) {
      issues.push("GITHUB-SUBMISSION.md must use the exact heading, separator, canonical JSON line, and trailing LF");
    } else {
      const body = text.slice(GITHUB_SUBMISSION_HANDOFF_PREFIX.length, -1);
      if (body.length === 0 || body.includes("\n") || body.includes("\r")) issues.push("GITHUB-SUBMISSION.md must contain exactly one JSON payload line");
      else {
        try {
          payload = JSON.parse(body);
          canonicalPayload = body === canonicalJson(payload);
          if (!canonicalPayload) issues.push("GITHUB-SUBMISSION.md payload must be canonical JSON");
        } catch {
          issues.push("GITHUB-SUBMISSION.md payload is not JSON");
        }
      }
    }
  }
  const expectedIdeaSha256 = Buffer.isBuffer(expectedIdeaBytes) ? sha256(expectedIdeaBytes) : null;
  const expectedPayload = (
    submissionBytes !== null
    && submission !== null
    && typeof expectedIdeaSha256 === "string"
    && /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(expectedApplicationId ?? "")
    && ["tradable", "no-market"].includes(expectedClassification)
    && typeof submissionReport?.status === "string"
    && typeof submissionReport?.automaticMaterialization === "boolean"
  ) ? {
      schemaVersion: "1.0.0",
      kind: "github-submission-handoff",
      status: "NOT_SUBMITTED",
      requiresHumanConfirmation: true,
      application: {
        applicationId: expectedApplicationId,
        classification: expectedClassification,
        marketRef: expectedClassification === "tradable" ? expectedMarketRef : null,
        ideaSha256: expectedIdeaSha256,
        tradeStatus: expectedClassification === "tradable" ? "NOT_APPROVED" : "NOT_APPLICABLE",
      },
      submission: {
        path: "submission/submission.v2.json",
        sha256: sha256(submissionBytes),
        byteLength: submissionBytes.length,
        reportStatus: submissionReport.status,
        reportSha256: sha256(Buffer.from(canonicalJson(submissionReport), "utf8")),
        automaticMaterialization: submissionReport.automaticMaterialization,
      },
      externalRepository: {
        numericRepositoryId: { status: "UNRESOLVED_EXTERNAL_REQUIRED", value: null },
        canonicalRepositoryUri: { status: "UNRESOLVED_EXTERNAL_REQUIRED", value: null },
      },
      localIdentityCommands: {
        sourceCommit: "git rev-list --max-parents=0 HEAD",
        sourceTree: "git rev-parse \"$(git rev-list --max-parents=0 HEAD)^{tree}\"",
        evidenceCommit: "git rev-parse HEAD",
        evidenceTree: "git rev-parse HEAD^{tree}",
        worktree: "git status --porcelain --untracked-files=all",
        submissionSha256: "shasum -a 256 submission/submission.v2.json",
      },
      localVerificationCommands: {
        install: expectedClassification === "tradable" ? "npm ci --ignore-scripts --prefer-offline --no-audit --no-fund" : "node tools/project-stage.mjs install",
        check: expectedClassification === "tradable" ? "node tools/run-project-gate.mjs evidence" : "npm test",
        requireOutput: `node \"$SKILL_ROOT/scripts/cli.mjs\" project require-output --repository-root . --state ${FINAL_STATE} --previous-state ${PREVIOUS_STATE} --submission-root submission`,
      },
      evidenceBoundary: {
        githubWritePerformed: false,
        externalActionsPerformed: [],
        approvalCreated: false,
        auditClaimed: false,
        deploymentPerformed: false,
        publicationPerformed: false,
        launchPerformed: false,
      },
    } : null;
  if (submission !== null && (submission.applicationId !== expectedApplicationId || submission.tradeCapability?.applicability !== expectedClassification)) issues.push("GitHub handoff identity differs from Submission V2");
  const submissionMarkets = Array.isArray(submission?.tradeCapability?.markets) ? submission.tradeCapability.markets : [];
  if (expectedClassification === "tradable" ? submissionMarkets.length !== 1 || (submissionMarkets[0]?.marketRef ?? submissionMarkets[0]?.marketSystemRef) !== expectedMarketRef : submissionMarkets.length !== 0) issues.push("GitHub handoff market differs from Submission V2");
  const promptBinding = validatePromptIntentBinding({ repositoryRoot, trackedPaths: Array.isArray(trackedPaths) ? trackedPaths : [], expectedIdeaBytes });
  if (!promptBinding.valid) issues.push(...promptBinding.issues.map((issue) => `GitHub handoff prompt source: ${issue}`));
  if (payload !== null && expectedPayload !== null && canonicalJson(payload) !== canonicalJson(expectedPayload)) {
    issues.push("GITHUB-SUBMISSION.md payload differs from the exact local identity, prompt, Submission bytes/report, unresolved external state, commands, or no-write/no-approval boundary");
  }
  return Object.freeze({
    valid: issues.length === 0,
    issues,
    path: relativePath,
    sha256: bytes === null ? null : sha256(bytes),
    status: payload?.status ?? null,
    requiresHumanConfirmation: payload?.requiresHumanConfirmation ?? null,
    canonicalPayload,
    application: payload?.application ?? null,
    submission: payload?.submission ?? null,
  });
}

function exactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function readRegularTrackedFile(repositoryRoot, trackedPaths, relativePath, issues) {
  if (!trackedPaths.includes(relativePath)) {
    issues.push(`${relativePath} must be tracked`);
    return null;
  }
  const absolute = path.join(repositoryRoot, relativePath);
  try {
    const stat = fs.lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      issues.push(`${relativePath} must be a regular non-symlink file`);
      return null;
    }
    return fs.readFileSync(absolute);
  } catch (error) {
    issues.push(`${relativePath} is unreadable: ${error.code ?? error.message}`);
    return null;
  }
}

function resolvePortablePathExecutable(requested, environmentPath) {
  if (typeof requested !== "string" || requested.length === 0 || requested.includes("\0") || path.isAbsolute(requested) || requested.includes("/") || requested.includes("\\")) return null;
  const names = process.platform === "win32" ? [requested, `${requested}.exe`] : [requested];
  for (const directory of String(environmentPath ?? "").split(path.delimiter).filter(Boolean)) {
    for (const name of names) {
      try {
        const candidate = path.join(directory, name);
        const stat = fs.lstatSync(candidate);
        if (!stat.isFile() && !stat.isSymbolicLink()) continue;
        const resolvedPath = fs.realpathSync(candidate);
        const resolvedStat = fs.lstatSync(resolvedPath);
        if (resolvedStat.isFile() && !resolvedStat.isSymbolicLink()) return Object.freeze({ requested, resolvedPath });
      } catch (error) {
        if (!["ENOENT", "ENOTDIR", "EACCES"].includes(error?.code)) throw error;
      }
    }
  }
  return null;
}

function inspectPortableProjectExecutable(command, environmentPath) {
  const requested = command?.argv?.[0];
  const issues = [];
  if (typeof requested !== "string" || requested.length === 0 || path.isAbsolute(requested) || requested.includes("/") || requested.includes("\\")) {
    issues.push("project command executable must be a canonical PATH name, never an absolute or user path");
    return Object.freeze({ valid: false, issues, requested: requested ?? null, resolvedPath: null });
  }
  if (requested !== "node") return Object.freeze({ valid: true, issues, requested, resolvedPath: null });
  const resolved = resolvePortablePathExecutable(requested, environmentPath);
  if (resolved === null) issues.push("project node command does not resolve through sanitized PATH");
  return Object.freeze({ valid: issues.length === 0, issues, requested, resolvedPath: resolved?.resolvedPath ?? null });
}

function inspectProjectToolchainLock({ bytes, nodeCommand, environmentPath, solcSources }) {
  const issues = [];
  let lock = null;
  try { lock = JSON.parse(bytes.toString("utf8")); }
  catch { issues.push("project toolchain lock is not JSON"); }
  if (lock === null) return Object.freeze({ valid: false, issues, sha256: sha256(bytes), lock: null });
  if (!exactKeys(lock, ["schemaVersion", "platform", "tools", "solidityProfiles"]) || lock.schemaVersion !== "1.0.0") issues.push("project toolchain lock has a noncanonical top-level shape");
  if (!exactKeys(lock.platform, ["os", "architecture"]) || lock.platform.os !== process.platform || lock.platform.architecture !== process.arch) issues.push("project toolchain lock platform differs from the replay host");
  const expectedToolIds = ["forge", "node", "npm", "slither"];
  if (!Array.isArray(lock.tools) || JSON.stringify(lock.tools.map(({ id }) => id)) !== JSON.stringify(expectedToolIds)) issues.push("project toolchain lock must contain the exact ordered tool set");
  for (const tool of Array.isArray(lock.tools) ? lock.tools : []) {
    if (!exactKeys(tool, ["id", "version", "resolvedExecutableSha256"]) || typeof tool.version !== "string" || tool.version.length === 0 || !/^sha256:[0-9a-f]{64}$/u.test(tool.resolvedExecutableSha256 ?? "")) issues.push(`project tool ${tool?.id ?? "unknown"} has a noncanonical identity`);
  }
  const nodeLock = Array.isArray(lock.tools) ? lock.tools.find(({ id }) => id === "node") : null;
  let nodeIdentity = null;
  try {
    if (nodeCommand !== "node") throw new Error("noncanonical node argv");
    const resolution = resolvePortablePathExecutable(nodeCommand, environmentPath);
    if (resolution === null) throw new Error("unresolved node argv");
    const nodeRealpath = resolution.resolvedPath;
    const nodeStat = fs.lstatSync(nodeRealpath);
    const nodeSha256 = sha256(fs.readFileSync(nodeRealpath));
    const versionRun = captured(nodeRealpath, ["--version"], { maximumBytes: 1024 * 1024 });
    const version = versionRun.status === 0 ? versionRun.stdout.toString("utf8").trim() : null;
    nodeIdentity = Object.freeze({ requested: nodeCommand, resolvedPath: nodeRealpath, version, resolvedExecutableSha256: nodeSha256 });
    if (!nodeStat.isFile() || nodeStat.isSymbolicLink() || versionRun.status !== 0 || version !== nodeLock?.version || nodeLock?.resolvedExecutableSha256 !== nodeSha256) issues.push("project wrapper portable Node resolution differs from the exact tool lock");
  } catch { issues.push("project wrapper Node executable is unresolved"); }
  const expectedProfiles = [
    { id: "foundry-solc-0-8-17", componentRefs: ["pinned-route-component"], compilerVersion: "0.8.17", evmTarget: "london", cborMetadata: true },
    { id: "foundry-solc-0-8-26", componentRefs: ["service-component", "factory-component", "v4-hook-system", "v4-hook-factory-system"], compilerVersion: "0.8.26", evmTarget: "cancun", cborMetadata: false },
  ];
  if (!Array.isArray(lock.solidityProfiles) || lock.solidityProfiles.length !== expectedProfiles.length) issues.push("project toolchain lock must contain exactly two Solidity profiles");
  for (const [index, expected] of expectedProfiles.entries()) {
    const profile = lock.solidityProfiles?.[index];
    if (!exactKeys(profile, ["id", "componentRefs", "compilerVersion", "resolvedCompilerBinarySha256", "evmTarget", "optimizer", "viaIr", "bytecodeHash", "cborMetadata"]) || profile?.id !== expected.id || JSON.stringify(profile?.componentRefs) !== JSON.stringify(expected.componentRefs) || profile?.compilerVersion !== expected.compilerVersion || !/^sha256:[0-9a-f]{64}$/u.test(profile?.resolvedCompilerBinarySha256 ?? "") || profile?.evmTarget !== expected.evmTarget || JSON.stringify(profile?.optimizer) !== JSON.stringify({ enabled: true, runs: 200 }) || profile?.viaIr !== true || profile?.bytecodeHash !== "none" || profile?.cborMetadata !== expected.cborMetadata) issues.push(`Solidity profile ${expected.compilerVersion} is noncanonical`);
    const expectedCompiler = solcSources?.compilers?.find(({ version }) => version === expected.compilerVersion);
    if (expectedCompiler && profile?.resolvedCompilerBinarySha256 !== expectedCompiler.sha256) issues.push(`Solidity profile ${expected.compilerVersion} differs from the isolated source compiler`);
  }
  return Object.freeze({ valid: issues.length === 0, issues, sha256: sha256(bytes), lock, nodeIdentity });
}

function normalizeProjectGateSource(source, marketRef, normalizedMarketRef) {
  const contexts = [
    [`.programmable/trade-capabilities/${marketRef}.v1.json`, `.programmable/trade-capabilities/${normalizedMarketRef}.v1.json`, 1],
    [`submission/review/fee-conformance/${marketRef}.receipt.v1.json`, `submission/review/fee-conformance/${normalizedMarketRef}.receipt.v1.json`, 1],
    [`evidence/v4/${marketRef}.mainnet-fork-canary.v1.json`, `evidence/v4/${normalizedMarketRef}.mainnet-fork-canary.v1.json`, 2],
  ];
  let normalized = source;
  let occurrenceCount = 0;
  const contextCounts = [];
  for (const [needle, replacement, expectedCount] of contexts) {
    const count = normalized.split(needle).length - 1;
    contextCounts.push({ context: replacement, count, expectedCount });
    occurrenceCount += count;
    normalized = normalized.replaceAll(needle, replacement);
  }
  return Object.freeze({ normalized, occurrenceCount, contextCounts, contextsValid: contextCounts.every(({ count, expectedCount }) => count === expectedCount) });
}

function inspectBuildInfoVerifierSource(source, binding) {
  if (binding?.buildInfo === undefined) return Object.freeze({ valid: true, issues: [], checked: false });
  const issues = [];
  const expectedUnits = Object.fromEntries(binding.buildInfo.units.map((unit) => [unit.compilerVersion, [unit.evmTarget, unit.cborMetadata, [...unit.componentRefs], unit.sourceRootSetSha256.slice("sha256:".length)]]));
  const expectedLiteral = `const expected=${JSON.stringify(expectedUnits)}`;
  const suppression = 'if(stage==="build")process.stdout.write=()=>true;';
  const verifier = "function verifyBuildInfo()";
  const spawn = "const run=childProcess.spawnSync";
  const verifierSuccess = 'if(stage==="build"){verifyBuildInfo();write("build:passed\\n");}';
  const requiredSettings = [
    "settings?.evmVersion!==want[0]",
    "settings?.optimizer?.enabled!==true",
    "settings.optimizer.runs!==200",
    "settings.viaIR!==true",
    'settings.metadata?.bytecodeHash!=="none"',
    "(settings.metadata?.appendCBOR??true)!==want[1]",
    "rootHash!==want[3]",
  ];
  if (!source.includes(suppression)) issues.push("build wrapper does not suppress premature Forge stdout");
  if (!source.includes(verifier) || !source.includes(expectedLiteral) || requiredSettings.some((marker) => !source.includes(marker))) issues.push("build wrapper omits or alters the exact two-unit build-info verifier");
  const spawnIndex = source.lastIndexOf(spawn);
  const successIndex = source.lastIndexOf(verifierSuccess);
  if (spawnIndex < 0 || successIndex <= spawnIndex || source.split(verifierSuccess).length - 1 !== 1 || !source.trimEnd().endsWith(verifierSuccess)) issues.push("build verifier invocation is inert, duplicated, reordered, or emits success prematurely");
  return Object.freeze({ valid: issues.length === 0, issues, checked: true, expectedUnits, optimizer: binding.buildInfo.optimizer, viaIr: binding.buildInfo.viaIr, bytecodeHash: binding.buildInfo.bytecodeHash, appendCborDefault: binding.buildInfo.appendCborDefault });
}

function inspectTestForkStageSplitSource(source, binding) {
  if (binding?.testForkSplit === undefined) return Object.freeze({ valid: true, issues: [], checked: false });
  const issues = [];
  const { fullArgv, forkArgv } = binding.testForkSplit;
  const fullMarker = `full:${JSON.stringify([fullArgv[0], fullArgv.slice(1)])}`;
  const forkMarker = `fork:${JSON.stringify([forkArgv[0], forkArgv.slice(1)])}`;
  const fullMarkerCount = source.split(fullMarker).length - 1;
  const forkMarkerCount = source.split(forkMarker).length - 1;
  const exclusionFlagCount = source.split("--no-match-path").length - 1;
  const canaryPathCount = source.split(FROZEN_MAINNET_FORK_CANARY.sourcePath).length - 1;
  if (fullMarkerCount !== 1 || exclusionFlagCount !== 1) issues.push("full test stage must exclude exactly the frozen mainnet fork canary path");
  if (forkMarkerCount !== 1) issues.push("fork stage must execute exactly the frozen read-only mainnet fork canary command");
  if (canaryPathCount !== 3) issues.push("mainnet fork canary path must occur only in the full-stage exclusion, fork command, and fork result binding");
  return Object.freeze({ valid: issues.length === 0, issues, checked: true, fullArgv: [...fullArgv], forkArgv: [...forkArgv], fullMarkerCount, forkMarkerCount, exclusionFlagCount, canaryPathCount });
}

export function inspectReadOnlyProjectGate({ repositoryRoot, trackedPaths, command, marketRef, solcSources = null, binding = FROZEN_PROJECT_GATE, environmentPath = process.env.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin" }) {
  const issues = [];
  const stage = Object.entries(binding.commands).find(([, expected]) => expected.id === command?.id)?.[0] ?? null;
  const expected = stage === null ? null : binding.commands[stage];
  if (expected === null || command?.kind !== expected.kind || command?.cwd !== "." || command?.required !== true || command?.timeoutMs !== expected.timeoutMs || command?.executionPolicy?.networkAccess !== expected.networkAccess || command?.executionPolicy?.externalWrites !== false || !exactKeys(command.executionPolicy, ["networkAccess", "externalWrites"])) issues.push("project gate command is not an exact install, build, or fork wrapper declaration");
  if (!Array.isArray(command?.argv) || command.argv.length !== 3 || command.argv[0] !== "node" || command.argv[1] !== binding.sourcePath || command.argv[2] !== stage) issues.push("project gate command argv is not the exact portable tracked wrapper invocation");
  if (typeof marketRef !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(marketRef)) issues.push("project wrapper requires one canonical marketRef");
  const sourceBytes = readRegularTrackedFile(repositoryRoot, trackedPaths, binding.sourcePath, issues);
  let normalizedSourceSha256 = null;
  let occurrenceCount = null;
  let contextCounts = null;
  let buildInfoVerifier = null;
  let testForkSplit = null;
  if (sourceBytes !== null && typeof marketRef === "string") {
    const source = sourceBytes.toString("utf8");
    if (!Buffer.from(source, "utf8").equals(sourceBytes)) issues.push("project gate wrapper is not exact UTF-8");
    const normalized = normalizeProjectGateSource(source, marketRef, binding.normalizedMarketRef);
    occurrenceCount = normalized.occurrenceCount;
    contextCounts = normalized.contextCounts;
    normalizedSourceSha256 = sha256(Buffer.from(normalized.normalized, "utf8"));
    if (!normalized.contextsValid || occurrenceCount !== binding.marketRefOccurrences || normalizedSourceSha256 !== binding.normalizedSourceSha256) issues.push("project gate wrapper source differs from the frozen normalized bytes");
    buildInfoVerifier = inspectBuildInfoVerifierSource(source, binding);
    if (!buildInfoVerifier.valid) issues.push(...buildInfoVerifier.issues);
    testForkSplit = inspectTestForkStageSplitSource(source, binding);
    if (!testForkSplit.valid) issues.push(...testForkSplit.issues);
  }
  const lockPath = ".programmable/project-toolchain-lock.v1.json";
  const lockBytes = readRegularTrackedFile(repositoryRoot, trackedPaths, lockPath, issues);
  const toolchain = lockBytes === null ? null : inspectProjectToolchainLock({ bytes: lockBytes, nodeCommand: command?.argv?.[0], environmentPath, solcSources });
  if (toolchain !== null && !toolchain.valid) issues.push(...toolchain.issues);
  return Object.freeze({ valid: issues.length === 0, issues, stage, sourceSha256: sourceBytes === null ? null : sha256(sourceBytes), normalizedSourceSha256, marketRef, marketRefOccurrences: occurrenceCount, marketRefContextCounts: contextCounts, buildInfoVerifier, testForkSplit, toolchain });
}

export function rerunDeclaredCoreCommands({ repositoryRoot, evidenceDirectory, solcSources = null, projectGateBinding = FROZEN_PROJECT_GATE, directForkBinding = FROZEN_MAINNET_FORK_CANARY, directForkRunner = captured }) {
  const plan = JSON.parse(fs.readFileSync(path.join(repositoryRoot, ".programmable/repository-plan.v1.json"), "utf8"));
  const selected = (plan.commands ?? []).filter((command) => command?.required === true);
  const issues = [];
  if (!selected.some(({ kind }) => kind === "test")) issues.push("RepositoryPlan has no required core test command");
  fs.mkdirSync(evidenceDirectory, { recursive: true, mode: 0o700 });
  const home = path.join(evidenceDirectory, "isolated-home");
  const tmp = path.join(evidenceDirectory, "isolated-tmp");
  fs.mkdirSync(home, { mode: 0o700 });
  fs.mkdirSync(tmp, { mode: 0o700 });
  const solcToolchain = solcSources === null ? null : provisionSolcToolchain({ sources: solcSources, targetHome: path.join(home, ".svm") });
  const solcInventoryBefore = solcToolchain === null ? null : inventoryDirectory(solcToolchain.targetHome);
  const solcIdentityBefore = solcToolchain === null ? null : inspectProvisionedSolcToolchain(solcToolchain);
  if (solcIdentityBefore !== null && !solcIdentityBefore.valid) issues.push(...solcIdentityBefore.issues.map((issue) => `isolated replay compiler preflight: ${issue}`));
  const npmCache = path.join(home, ".npm");
  fs.mkdirSync(npmCache, { mode: 0o700 });
  const npmCacheBefore = inventoryDirectory(npmCache);
  const env = {
    PATH: process.env.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin",
    HOME: home,
    TMPDIR: tmp,
    XDG_CONFIG_HOME: path.join(home, "config"),
    XDG_CACHE_HOME: path.join(home, "cache"),
    XDG_DATA_HOME: path.join(home, "data"),
    XDG_STATE_HOME: path.join(home, "state"),
    CI: "1",
    NO_COLOR: "1",
    FOUNDRY_OFFLINE: "true",
    SVM_HOME: solcToolchain?.targetHome ?? path.join(home, ".svm"),
    npm_config_cache: npmCache,
    npm_config_audit: "false",
    npm_config_fund: "false",
    npm_config_userconfig: path.join(home, ".npmrc"),
    npm_config_globalconfig: "/dev/null",
    npm_config_registry: "https://registry.npmjs.org/",
    npm_config_update_notifier: "false",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
  };
  const results = [];
  const replayRepository = path.join(evidenceDirectory, "replay-repository");
  const clone = captured("git", ["clone", "--no-hardlinks", "--quiet", repositoryRoot, replayRepository], { cwd: evidenceDirectory, maximumBytes: MAX_CAPTURE_BYTES });
  if (clone.status !== 0) {
    return Object.freeze({ valid: false, issues: [...issues, "independent command replay clone failed"], commands: [], clone: { exitCode: clone.status, error: clone.error } });
  }
  const replayHead = git(replayRepository, ["rev-parse", "HEAD"], true).stdout.toString("utf8").trim();
  const replayTree = git(replayRepository, ["rev-parse", "HEAD^{tree}"], true).stdout.toString("utf8").trim();
  const replayTrackedPaths = git(replayRepository, ["ls-files", "-z"], true).stdout.toString("utf8").split("\0").filter(Boolean);
  const replayTrackedInventory = inventoryTrackedFiles(replayRepository, replayTrackedPaths);
  const manifestPaths = replayTrackedPaths.filter((entry) => /^\.programmable\/trade-capabilities\/[a-z0-9-]+\.v1\.json$/u.test(entry));
  const marketRefs = manifestPaths.map((entry) => JSON.parse(fs.readFileSync(path.join(replayRepository, entry), "utf8")).marketRef);
  const marketRef = marketRefs.length === 1 ? marketRefs[0] : null;
  const readOnlyCommandIds = selected.filter((command) => command?.executionPolicy?.networkAccess === "read-only").map(({ id }) => id);
  if (marketRef !== null && JSON.stringify(readOnlyCommandIds) !== JSON.stringify([projectGateBinding.commands.install.id, projectGateBinding.commands.fork.id])) issues.push("tradable RepositoryPlan must contain exactly one ordered install and fork read-only wrapper");
  if (marketRef === null && readOnlyCommandIds.length !== 0) issues.push("non-tradable RepositoryPlan must not contain read-only commands");
  const projectGateCommandIds = marketRef === null ? [] : selected.filter(({ id }) => Object.values(projectGateBinding.commands).some((expected) => expected.id === id)).map(({ id }) => id);
  if (marketRef !== null && JSON.stringify(projectGateCommandIds) !== JSON.stringify([projectGateBinding.commands.install.id, projectGateBinding.commands.build.id, projectGateBinding.commands.fork.id])) issues.push("tradable RepositoryPlan must contain exactly one ordered install, build-info, and fork wrapper");
  for (const command of selected) {
    const readOnly = command?.executionPolicy?.networkAccess === "read-only";
    const executable = inspectPortableProjectExecutable(command, env.PATH);
    const isProjectGate = marketRef !== null && Object.values(projectGateBinding.commands).some((expected) => expected.id === command?.id);
    const projectGate = isProjectGate ? inspectReadOnlyProjectGate({ repositoryRoot: replayRepository, trackedPaths: replayTrackedPaths, command, marketRef, solcSources, binding: projectGateBinding, environmentPath: env.PATH }) : null;
    if (!executable.valid || (projectGate !== null && !projectGate.valid) || (readOnly && projectGate === null) || (!readOnly && command.executionPolicy?.networkAccess !== "forbidden") || command.executionPolicy?.externalWrites !== false) {
      issues.push(`${command.id} has an unapproved network or external-write policy`);
      issues.push(...executable.issues.map((issue) => `${command.id}: ${issue}`));
      if (projectGate !== null) issues.push(...projectGate.issues.map((issue) => `${command.id}: ${issue}`));
      continue;
    }
    const commandDirectory = path.join(evidenceDirectory, "commands", command.id);
    fs.mkdirSync(commandDirectory, { recursive: true, mode: 0o700 });
    let cwd;
    try { cwd = resolveRepositoryDirectory(replayRepository, command.cwd); }
    catch (error) { issues.push(`${command.id} cwd is unsafe: ${error.message}`); continue; }
    const effectiveTimeoutMs = Math.min(command.timeoutMs, 15 * 60 * 1000);
    const commandEnv = readOnly ? { ...env } : env;
    if (readOnly) delete commandEnv.FOUNDRY_OFFLINE;
    const result = captured(command.argv[0], command.argv.slice(1), { cwd, env: commandEnv, timeoutMs: effectiveTimeoutMs, maximumBytes: MAX_CAPTURE_BYTES });
    writePrivate(path.join(commandDirectory, "stdout"), result.stdout);
    writePrivate(path.join(commandDirectory, "stderr"), result.stderr);
    const expectedWrapperStdout = projectGate === null ? null : projectGateBinding.commands[projectGate.stage].stdout;
    if (expectedWrapperStdout !== null && (!result.stdout.equals(Buffer.from(expectedWrapperStdout, "utf8")) || result.stderr.length !== 0)) issues.push(`${command.id} wrapper output differs from the frozen stable output`);
    let directFork = null;
    if (projectGate?.stage === "fork" && result.status === 0 && result.signal === null && result.error === null) {
      const directDirectory = path.join(commandDirectory, "independent-direct-fork");
      fs.mkdirSync(directDirectory, { recursive: true, mode: 0o700 });
      const directEnv = { ...env };
      delete directEnv.FOUNDRY_OFFLINE;
      const directResult = directForkRunner(directForkBinding.command.argv[0], directForkBinding.command.argv.slice(1), { cwd, env: directEnv, timeoutMs: directForkBinding.command.timeoutMs, maximumBytes: MAX_CAPTURE_BYTES });
      writePrivate(path.join(directDirectory, "stdout"), directResult.stdout);
      writePrivate(path.join(directDirectory, "stderr"), directResult.stderr);
      const sourceBytes = readRegularTrackedFile(replayRepository, replayTrackedPaths, directForkBinding.sourcePath, issues);
      const validation = sourceBytes === null ? null : validateReadOnlyForkReplay({ command: directForkBinding.command, expectedCommand: directForkBinding.command, sourceBytes, expectedSourceSha256: directForkBinding.sourceSha256, stdout: directResult.stdout, expectedOutput: directForkBinding.output });
      directFork = { exitCode: directResult.status, signal: directResult.signal, error: directResult.error, stdoutSha256: sha256(directResult.stdout), stderrSha256: sha256(directResult.stderr), valid: directResult.status === 0 && directResult.signal === null && directResult.error === null && validation?.valid === true, validation: validation === null ? null : { issues: validation.issues, declaration: validation.declaration, normalized: validation.output.normalized } };
      if (!directFork.valid) issues.push(`${command.id} independent direct fork canary did not pass exact validation`);
    }
    const status = git(replayRepository, ["status", "--porcelain=v1", "--untracked-files=all"], false);
    const worktreeDiff = git(replayRepository, ["diff", "--no-ext-diff", "--exit-code", "--"], false);
    const indexDiff = git(replayRepository, ["diff", "--cached", "--no-ext-diff", "--exit-code", "--"], false);
    const observedHead = git(replayRepository, ["rev-parse", "HEAD"], false);
    const observedTree = git(replayRepository, ["rev-parse", "HEAD^{tree}"], false);
    const trackedInventory = inventoryTrackedFiles(replayRepository, replayTrackedPaths);
    writePrivate(path.join(commandDirectory, "git-status.porcelain"), status.stdout);
    writePrivate(path.join(commandDirectory, "git-worktree.diff"), worktreeDiff.stdout);
    writePrivate(path.join(commandDirectory, "git-index.diff"), indexDiff.stdout);
    const repositoryState = {
      headUnchanged: observedHead.status === 0 && observedHead.stdout.toString("utf8").trim() === replayHead,
      treeUnchanged: observedTree.status === 0 && observedTree.stdout.toString("utf8").trim() === replayTree,
      trackedInventoryUnchanged: trackedInventory.inventorySha256 === replayTrackedInventory.inventorySha256,
      statusClean: status.status === 0 && status.stdout.length === 0,
      worktreeDiffClean: worktreeDiff.status === 0,
      indexDiffClean: indexDiff.status === 0,
      trackedInventorySha256: trackedInventory.inventorySha256,
    };
    const record = { id: command.id, kind: command.kind, argv: command.argv, cwd: command.cwd, declaredTimeoutMs: command.timeoutMs, effectiveTimeoutMs, exitCode: result.status, signal: result.signal, error: result.error, stdoutSha256: sha256(result.stdout), stderrSha256: sha256(result.stderr), projectGate, directFork, repositoryState };
    results.push(record);
    if (result.status !== 0 || result.signal !== null || result.error !== null) issues.push(`${command.id} did not pass in the independent clone`);
    if (![repositoryState.headUnchanged, repositoryState.treeUnchanged, repositoryState.trackedInventoryUnchanged, repositoryState.statusClean, repositoryState.worktreeDiffClean, repositoryState.indexDiffClean].every(Boolean)) {
      issues.push(`${command.id} changed tracked or unignored repository state in the independent clone`);
    }
  }
  const solcInventoryAfter = solcToolchain === null ? null : inventoryDirectory(solcToolchain.targetHome);
  const solcIdentityAfter = solcToolchain === null ? null : inspectProvisionedSolcToolchain(solcToolchain);
  const npmCacheAfter = inventoryDirectory(npmCache);
  if (solcInventoryBefore !== null && solcInventoryBefore.inventorySha256 !== solcInventoryAfter.inventorySha256) issues.push("isolated replay solc toolchain changed during command execution");
  if (solcIdentityAfter !== null && !solcIdentityAfter.valid) issues.push(...solcIdentityAfter.issues.map((issue) => `isolated replay compiler postflight: ${issue}`));
  fs.rmSync(replayRepository, { recursive: true, force: true });
  return Object.freeze({ valid: issues.length === 0, issues, commands: results, solcToolchain: solcToolchain === null ? null : { ...solcToolchain, before: solcInventoryBefore.inventorySha256, after: solcInventoryAfter.inventorySha256, identityBefore: solcIdentityBefore, identityAfter: solcIdentityAfter, unchanged: solcInventoryBefore.inventorySha256 === solcInventoryAfter.inventorySha256 && solcIdentityAfter.valid }, npmCache: { path: npmCache, before: npmCacheBefore.inventorySha256, after: npmCacheAfter.inventorySha256, beforeFileCount: npmCacheBefore.fileCount, afterFileCount: npmCacheAfter.fileCount, isolatedWritablePath: true, sharedHostCache: false, seededFromHost: false, externalRegistryAvailabilityRequiredForColdInstall: true }, replayRepositoryRemoved: !fs.existsSync(replayRepository) });
}

async function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
    const repositoryRoot = fs.realpathSync(options.repositoryRoot);
    const prompts = Object.fromEntries(["tradable", "no-market"].map((lane) => {
      const bytes = readPlainFile(options.prompts[lane], `${lane} prompt`);
      return [lane, { bytes, receipt: validateNaturalPrompt(bytes, lane) }];
    }));
    const sourceBefore = candidateIdentity(repositoryRoot);
    if (sourceBefore.status.length !== 0) throw new BlindForwardError("CANDIDATE_DIRTY", "candidate repository must be clean before a blind cohort");
    const solcSources = resolveSolcToolchainSources(options.svmHome);
    const outputRoot = reserveOutputDirectory(options.output, repositoryRoot);
    const cohort = { repositoryRoot, outputRoot, options, prompts, sourceBefore, solcSources };
    const lanes = await Promise.all(["tradable", "no-market"].map((lane) => runLane(cohort, lane)));
    const sourceAfter = candidateIdentity(repositoryRoot);
    const sourceUnchanged = sourceAfter.head === sourceBefore.head && sourceAfter.tree === sourceBefore.tree && sourceAfter.status.length === 0;
    const passed = sourceUnchanged && lanes.every(({ passed: lanePassed }) => lanePassed);
    const receipt = {
      schemaVersion: "1.0.0",
      kind: "programmable-blind-forward-cohort",
      status: passed ? "BLIND_FORWARD_2_OF_2_VALID" : "BLIND_FORWARD_FAILED",
      source: { commit: sourceBefore.head, tree: sourceBefore.tree, skillTree: sourceBefore.skillTree, unchanged: sourceUnchanged },
      toolchainSource: solcSources,
      independence: { isolatedProcesses: true, distinctRoots: true, freshHome: true, freshCodexHome: true, freshXdg: true, freshTmp: true, freshGitRepositories: true, ignoredUserConfig: true, ignoredRules: true, ephemeralSessions: true, physicalHosts: 1, externalHostEvidence: false },
      lanes,
      externalActionsPerformed: [],
    };
    writePrivate(path.join(outputRoot, "cohort.receipt.json"), Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`));
    process.stdout.write(`${JSON.stringify({ status: receipt.status, output: outputRoot, source: receipt.source, lanes: lanes.map(({ lane, passed: lanePassed, repository }) => ({ lane, passed: lanePassed, repository })) }, null, 2)}\n`);
    if (!passed) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ status: "BLIND_FORWARD_ERROR", code: error.code ?? "UNEXPECTED", message: error.message })}\n`);
    process.exitCode = 2;
  }
}

function parseArguments(argv) {
  const options = {
    repositoryRoot: DEFAULT_REPOSITORY_ROOT,
    output: null,
    prompts: { tradable: null, "no-market": null },
    models: { tradable: "gpt-5.6-sol", "no-market": "gpt-5.6-terra" },
    codex: "codex",
    authFile: path.join(process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex"), "auth.json"),
    svmHome: defaultSvmHome(),
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new BlindForwardError("ARGUMENT_INVALID", `${arg} requires a value`);
      return value;
    };
    if (arg === "--repository-root") options.repositoryRoot = next();
    else if (arg === "--output") options.output = next();
    else if (arg === "--tradable-prompt") options.prompts.tradable = next();
    else if (arg === "--no-market-prompt") options.prompts["no-market"] = next();
    else if (arg === "--codex") options.codex = next();
    else if (arg === "--auth-file") options.authFile = next();
    else if (arg === "--svm-home") options.svmHome = next();
    else if (arg === "--tradable-model") options.models.tradable = next();
    else if (arg === "--no-market-model") options.models["no-market"] = next();
    else if (arg === "--timeout-ms") options.timeoutMs = Number(next());
    else throw new BlindForwardError("ARGUMENT_INVALID", `unknown argument: ${arg}`);
  }
  if (!path.isAbsolute(options.output ?? "") || !path.isAbsolute(options.prompts.tradable ?? "") || !path.isAbsolute(options.prompts["no-market"] ?? "")) {
    throw new BlindForwardError("ARGUMENT_INVALID", "--output and both prompt paths must be absolute");
  }
  if (!path.isAbsolute(options.authFile)) throw new BlindForwardError("ARGUMENT_INVALID", "--auth-file must be absolute");
  if (!path.isAbsolute(options.svmHome)) throw new BlindForwardError("ARGUMENT_INVALID", "--svm-home must be absolute");
  requirePlainFile(options.authFile, "Codex authentication bootstrap");
  if (Object.values(options.models).some((model) => !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(model)) || options.models.tradable === options.models["no-market"]) {
    throw new BlindForwardError("ARGUMENT_INVALID", "blind lanes require two distinct canonical model IDs");
  }
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 60_000 || options.timeoutMs > MAX_TIMEOUT_MS) {
    throw new BlindForwardError("ARGUMENT_INVALID", `--timeout-ms must be between 60000 and ${MAX_TIMEOUT_MS}`);
  }
  return options;
}

async function runLane(cohort, lane) {
  const laneRoot = path.join(cohort.outputRoot, "subjects", lane);
  const directories = Object.fromEntries(["home", "codex-home", "xdg-config", "xdg-cache", "xdg-data", "xdg-state", "npm-cache", "tmp", "workspace", "evidence"].map((name) => {
    const target = path.join(laneRoot, name);
    fs.mkdirSync(target, { recursive: true, mode: 0o700 });
    fs.chmodSync(target, 0o700);
    return [name, target];
  }));
  const solcToolchain = provisionSolcToolchain({ sources: cohort.solcSources, targetHome: path.join(directories.home, ".svm") });
  directories["svm-home"] = solcToolchain.targetHome;
  const solcInventoryBefore = inventoryDirectory(solcToolchain.targetHome);
  const solcIdentityBefore = inspectProvisionedSolcToolchain(solcToolchain);
  if (!solcIdentityBefore.valid) throw new BlindForwardError("SUBJECT_TOOLCHAIN_INVALID", solcIdentityBefore.issues.join("; "));
  const npmCacheBefore = inventoryDirectory(directories["npm-cache"]);
  git(directories.workspace, ["init", "--initial-branch=main", "."], true);
  git(directories.workspace, ["config", "--local", "user.name", "Programmable Blind Subject"], true);
  git(directories.workspace, ["config", "--local", "user.email", "blind-subject@invalid.example"], true);
  const ideaCaptureBefore = provisionSubjectIdea({ workspace: directories.workspace, expectedIdeaBytes: cohort.prompts[lane].bytes });
  const workspaceInventoryBefore = inventoryDirectory(directories.workspace);
  const installedSkillRoot = path.join(directories["codex-home"], SKILL_PATH);
  materializeCommittedSkill(cohort.repositoryRoot, cohort.sourceBefore.head, installedSkillRoot);
  const inventoryBefore = inventoryDirectory(installedSkillRoot);
  writePrivate(path.join(laneRoot, "installed-skill-inventory.before.json"), Buffer.from(`${JSON.stringify(inventoryBefore, null, 2)}\n`));
  writePrivate(path.join(laneRoot, "prompt.txt"), cohort.prompts[lane].bytes);
  const subjectMessage = buildSubjectMessage(cohort.prompts[lane].bytes);
  writePrivate(path.join(laneRoot, "subject-message.txt"), subjectMessage);
  const env = subjectShellEnvironment(directories);
  const versions = Object.fromEntries([
    ["codex", [cohort.options.codex, ["--version"]]], ["node", [process.execPath, ["--version"]]], ["npm", ["npm", ["--version"]]],
    ["git", ["git", ["--version"]]], ["forge", ["forge", ["--version"]]], ["slither", ["slither", ["--version"]]],
  ].map(([id, [command, args]]) => [id, toolVersion(command, args, env, directories.workspace)]));
  writePrivate(path.join(laneRoot, "tool-versions.json"), Buffer.from(`${JSON.stringify(versions, null, 2)}\n`));
  const stdoutPath = path.join(laneRoot, "transcript.jsonl");
  const stderrPath = path.join(laneRoot, "transcript.stderr");
  const finalOutput = path.join(laneRoot, "final.txt");
  const model = cohort.options.models[lane];
  const shellEnvironment = subjectShellEnvironment(directories);
  const argv = buildCodexArguments({ workspace: directories.workspace, finalOutput, model, shellEnvironment });
  const startedAt = new Date().toISOString();
  const ambientTmpBefore = inventoryAmbientTmpRoots({ excludedRoots: [laneRoot] });
  const brokerCodexHome = fs.mkdtempSync(path.join(os.tmpdir(), `programmable-blind-codex-broker-${lane}-`));
  fs.chmodSync(brokerCodexHome, 0o700);
  const brokerSkillRoot = path.join(brokerCodexHome, SKILL_PATH);
  let brokerSkillInventory = null;
  let processResult;
  let subjectStartError = null;
  try {
    materializeCommittedSkill(cohort.repositoryRoot, cohort.sourceBefore.head, brokerSkillRoot);
    brokerSkillInventory = inventoryDirectory(brokerSkillRoot);
    if (brokerSkillInventory.inventorySha256 !== inventoryBefore.inventorySha256) throw new BlindForwardError("SKILL_INSTALL_FAILED", "broker-discovered and subject-visible candidate skill inventories differ");
    const temporaryAuth = path.join(brokerCodexHome, "auth.json");
    fs.copyFileSync(cohort.options.authFile, temporaryAuth, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(temporaryAuth, 0o600);
    processResult = await launchSubject({ command: cohort.options.codex, argv, cwd: directories.workspace, env: subjectEnvironment(directories, brokerCodexHome), prompt: subjectMessage, stdoutPath, stderrPath, timeoutMs: cohort.options.timeoutMs });
  } catch (error) {
    subjectStartError = { code: error.code ?? "SUBJECT_FAILED", message: error.message };
    processResult = { exitCode: null, signal: null, timedOut: false };
  } finally {
    fs.rmSync(brokerCodexHome, { recursive: true, force: true });
  }
  if (!fs.existsSync(stdoutPath)) writePrivate(stdoutPath, Buffer.alloc(0));
  if (!fs.existsSync(stderrPath)) writePrivate(stderrPath, Buffer.from(`${subjectStartError?.code ?? "SUBJECT_FAILED"}: ${subjectStartError?.message ?? "subject did not start"}\n`, "utf8"));
  const finishedAt = new Date().toISOString();
  const ambientTmpAfter = inventoryAmbientTmpRoots({ excludedRoots: [laneRoot] });
  const ambientTmpDiff = compareAmbientTmpInventories(ambientTmpBefore, ambientTmpAfter);
  const transcriptContainment = inspectTranscriptOutOfLaneWrites({ transcriptPath: stdoutPath, allowedRoots: [laneRoot] });
  const inventoryAfter = inventoryDirectory(installedSkillRoot);
  writePrivate(path.join(laneRoot, "installed-skill-inventory.after.json"), Buffer.from(`${JSON.stringify(inventoryAfter, null, 2)}\n`));
  const candidates = discoverGitRepositories(directories.workspace);
  const validations = candidates.map((repositoryRoot, index) => ({
    repositoryRoot,
    gate: runStrictOutputGate({ repositoryRoot, installedSkillRoot, evidenceDirectory: path.join(directories.evidence, `candidate-${index + 1}`), expectedClassification: lane, expectedIdeaBytes: cohort.prompts[lane].bytes }),
  }));
  const valid = validations.filter(({ gate }) => gate.valid);
  const applicationIds = [...new Set(validations.map(({ gate }) => gate.classification?.applicationId).filter((value) => typeof value === "string"))];
  const attributedAmbientAdditions = ambientTmpDiff.added.filter(({ path: addedPath }) => (
    transcriptContainment.attempts.some(({ path: attemptedPath }) => attemptedPath === addedPath)
    || applicationIds.some((applicationId) => path.basename(addedPath).startsWith(applicationId))
  ));
  const outOfLaneEvents = [
    ...transcriptContainment.attempts.map((attempt) => ({ kind: "out-of-lane-write-attempt", ...attempt })),
    ...attributedAmbientAdditions.map((entry) => ({ kind: "out-of-lane-write-observed", path: entry.path, filesystemKind: entry.kind, device: entry.device, inode: entry.inode })),
  ];
  const containmentValid = outOfLaneEvents.length === 0;
  let cloneValidation = null;
  if (valid.length === 1) {
    const cloneRoot = path.join(directories.evidence, "independent-clone");
    const clone = captured("git", ["clone", "--no-hardlinks", "--quiet", valid[0].repositoryRoot, cloneRoot], { cwd: directories.workspace });
    if (clone.status === 0) {
      const before = runStrictOutputGate({ repositoryRoot: cloneRoot, installedSkillRoot, evidenceDirectory: path.join(directories.evidence, "independent-clone-gate-before"), expectedClassification: lane, expectedIdeaBytes: cohort.prompts[lane].bytes });
      const commands = before.valid
        ? rerunDeclaredCoreCommands({ repositoryRoot: cloneRoot, evidenceDirectory: path.join(directories.evidence, "independent-clone-commands"), solcSources: cohort.solcSources })
        : { valid: false, issues: ["strict clone gate failed before declared command rerun"], commands: [] };
      const after = commands.valid
        ? runStrictOutputGate({ repositoryRoot: cloneRoot, installedSkillRoot, evidenceDirectory: path.join(directories.evidence, "independent-clone-gate-after"), expectedClassification: lane, expectedIdeaBytes: cohort.prompts[lane].bytes })
        : { valid: false, issues: ["strict clone gate skipped after declared command failure"] };
      cloneValidation = { valid: before.valid && commands.valid && after.valid, before, declaredCoreCommands: commands, after };
    }
    else cloneValidation = { valid: false, issues: [`independent clone exited ${clone.status}`] };
  }
  const skillUnchanged = inventoryBefore.inventorySha256 === inventoryAfter.inventorySha256;
  const solcInventoryAfter = inventoryDirectory(solcToolchain.targetHome);
  const solcIdentityAfter = inspectProvisionedSolcToolchain(solcToolchain);
  const npmCacheAfter = inventoryDirectory(directories["npm-cache"]);
  const solcUnchanged = solcInventoryBefore.inventorySha256 === solcInventoryAfter.inventorySha256 && solcIdentityAfter.valid;
  const ideaCaptureAfter = validateProvisionedSubjectIdea({ workspace: directories.workspace, expectedIdeaBytes: cohort.prompts[lane].bytes });
  const passed = processResult.exitCode === 0 && !processResult.timedOut && skillUnchanged && solcUnchanged && ideaCaptureAfter.valid && containmentValid && valid.length === 1 && cloneValidation?.valid === true;
  const repository = valid.length === 1 ? { path: valid[0].repositoryRoot, head: valid[0].gate.git.head, tree: valid[0].gate.git.tree, applicationId: valid[0].gate.classification?.applicationId ?? null } : null;
  const receipt = {
    lane,
    passed,
    prompt: cohort.prompts[lane].receipt,
    subjectMessage: { byteLength: subjectMessage.length, sha256: sha256(subjectMessage), provenanceInstruction: SUBJECT_IDEA_PROVENANCE_INSTRUCTION },
    subject: { command: "codex", model, argv: argv.map((value) => value === directories.workspace ? "<workspace>" : value === finalOutput ? "<final-output>" : value), startedAt, finishedAt, exitCode: processResult.exitCode, signal: processResult.signal, timedOut: processResult.timedOut, startError: subjectStartError },
    environment: { host: { hostname: os.hostname(), platform: os.platform(), release: os.release(), architecture: os.arch(), uid: typeof process.getuid === "function" ? process.getuid() : null }, isolation: { separateProcess: true, contextlessSession: true, workspaceWriteSandbox: true, hostFilesystemChroot: false, tmpdirAutoWritable: false, slashTmpAutoWritable: false, explicitWritableRoots: [directories.tmp, directories["npm-cache"]] }, roots: { home: directories.home, codexHome: directories["codex-home"], xdgConfig: directories["xdg-config"], xdgCache: directories["xdg-cache"], xdgData: directories["xdg-data"], xdgState: directories["xdg-state"], tmp: directories.tmp, workspace: directories.workspace }, authentication: { bootstrap: "transient-non-subject-broker-home", secretRecorded: false, subjectCodexHomeContainsSecret: false, brokerRemovedAfterSubject: !fs.existsSync(brokerCodexHome), brokerSkillInventorySha256: brokerSkillInventory?.inventorySha256 ?? null, brokerSkillMatchesSubjectVisibleSkill: brokerSkillInventory?.inventorySha256 === inventoryBefore.inventorySha256 }, tools: versions },
    installedSkill: { candidateTree: cohort.sourceBefore.skillTree, before: inventoryBefore.inventorySha256, after: inventoryAfter.inventorySha256, unchanged: skillUnchanged },
    solcToolchain: { ...solcToolchain, before: solcInventoryBefore.inventorySha256, after: solcInventoryAfter.inventorySha256, identityBefore: solcIdentityBefore, identityAfter: solcIdentityAfter, unchanged: solcUnchanged },
    npmCache: { path: directories["npm-cache"], before: npmCacheBefore.inventorySha256, after: npmCacheAfter.inventorySha256, beforeFileCount: npmCacheBefore.fileCount, afterFileCount: npmCacheAfter.fileCount, isolatedWritablePath: true, sharedHostCache: false, seededFromHost: false, externalRegistryAvailabilityRequiredForColdInstall: true },
    ideaCapture: { before: ideaCaptureBefore, after: ideaCaptureAfter, unchanged: ideaCaptureAfter.valid, workspaceInventoryBeforeSha256: workspaceInventoryBefore.inventorySha256, workspaceInventoryBeforeFileCount: workspaceInventoryBefore.fileCount },
    containment: { valid: containmentValid, transcript: transcriptContainment, ambientTmp: { before: { roots: ambientTmpBefore.roots, entryCount: ambientTmpBefore.entryCount, sha256: ambientTmpBefore.sha256 }, after: { roots: ambientTmpAfter.roots, entryCount: ambientTmpAfter.entryCount, sha256: ambientTmpAfter.sha256 }, added: ambientTmpDiff.added, removed: ambientTmpDiff.removed, attributedAdditions: attributedAmbientAdditions }, outOfLaneEvents },
    transcript: { stdoutPath, stdoutSha256: sha256File(stdoutPath), stderrPath, stderrSha256: sha256File(stderrPath), finalPath: fs.existsSync(finalOutput) ? finalOutput : null, finalSha256: fs.existsSync(finalOutput) ? sha256File(finalOutput) : null },
    candidates: validations.map(({ repositoryRoot, gate }) => ({ path: repositoryRoot, valid: gate.valid, issues: gate.issues, git: gate.git, classification: gate.classification, promptBinding: gate.promptBinding, reportStatus: gate.report?.status ?? null, canonicalOutput: gate.report?.canonicalOutput ?? null })),
    independentClone: cloneValidation,
    repository,
    externalActionsPerformed: outOfLaneEvents,
  };
  writePrivate(path.join(laneRoot, "subject.receipt.json"), Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`));
  return receipt;
}

export function subjectShellEnvironment(directories) {
  return Object.freeze({
    PATH: process.env.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin",
    SHELL: process.env.SHELL ?? "/bin/zsh",
    LANG: process.env.LANG ?? "C.UTF-8",
    LC_ALL: process.env.LC_ALL ?? "C.UTF-8",
    TERM: "dumb",
    NO_COLOR: "1",
    HOME: directories.home,
    CODEX_HOME: directories["codex-home"],
    XDG_CONFIG_HOME: directories["xdg-config"],
    XDG_CACHE_HOME: directories["xdg-cache"],
    XDG_DATA_HOME: directories["xdg-data"],
    XDG_STATE_HOME: directories["xdg-state"],
    TMPDIR: directories.tmp,
    SVM_HOME: directories["svm-home"],
    FOUNDRY_OFFLINE: "true",
    npm_config_cache: directories["npm-cache"],
    npm_config_audit: "false",
    npm_config_fund: "false",
    npm_config_userconfig: path.join(directories.home, ".npmrc"),
    npm_config_globalconfig: "/dev/null",
    npm_config_registry: "https://registry.npmjs.org/",
    npm_config_update_notifier: "false",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
  });
}

function subjectEnvironment(directories, brokerCodexHome) {
  const env = { ...subjectShellEnvironment(directories), CODEX_HOME: brokerCodexHome };
  for (const key of ["SSL_CERT_FILE", "SSL_CERT_DIR"]) if (process.env[key]) env[key] = process.env[key];
  return Object.freeze(env);
}

function defaultSvmHome() {
  if (process.env.SVM_HOME) return path.resolve(process.env.SVM_HOME);
  for (const candidate of [path.join(os.homedir(), "Library/Application Support/svm"), path.join(os.homedir(), ".svm")]) if (fs.existsSync(candidate)) return path.resolve(candidate);
  return path.join(os.homedir(), ".svm");
}

function launchSubject({ command, argv, cwd, env, prompt, stdoutPath, stderrPath, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const stdout = fs.openSync(stdoutPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
    const stderr = fs.openSync(stderrPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
    const child = spawn(command, argv, { cwd, env, shell: false, stdio: ["pipe", stdout, stderr] });
    let settled = false;
    let timedOut = false;
    let forceTimer = null;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      forceTimer = setTimeout(() => child.kill("SIGKILL"), 10_000);
    }, timeoutMs);
    child.stdin.on("error", (error) => {
      if (error.code === "EPIPE" || settled) return;
      settled = true;
      clearTimeout(timer);
      if (forceTimer) clearTimeout(forceTimer);
      child.kill("SIGTERM");
      fs.closeSync(stdout); fs.closeSync(stderr);
      reject(new BlindForwardError("SUBJECT_STDIN_FAILED", error.message));
    });
    child.stdin.end(prompt);
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (forceTimer) clearTimeout(forceTimer);
      fs.closeSync(stdout); fs.closeSync(stderr);
      reject(new BlindForwardError("SUBJECT_START_FAILED", error.message));
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (forceTimer) clearTimeout(forceTimer);
      fs.closeSync(stdout); fs.closeSync(stderr);
      resolve({ exitCode: code, signal, timedOut });
    });
  });
}

function materializeCommittedSkill(repositoryRoot, commit, target) {
  const listing = git(repositoryRoot, ["ls-tree", "-rz", "--full-tree", commit, "--", SKILL_PATH], true).stdout;
  const records = listing.toString("utf8").split("\0").filter(Boolean);
  if (records.length === 0) throw new BlindForwardError("SKILL_INSTALL_FAILED", "candidate skill tree is empty");
  for (const record of records) {
    const match = /^(100644|100755) blob ([0-9a-f]{40})\t(.+)$/u.exec(record);
    if (!match) throw new BlindForwardError("SKILL_INSTALL_FAILED", `non-regular committed skill entry: ${record}`);
    const relative = match[3].slice(`${SKILL_PATH}/`.length);
    if (!relative || relative.split("/").includes("..") || relative.includes("\\")) throw new BlindForwardError("SKILL_INSTALL_FAILED", `unsafe skill path: ${match[3]}`);
    const destination = path.join(target, ...relative.split("/"));
    fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    const bytes = git(repositoryRoot, ["show", `${commit}:${match[3]}`], true, null).stdout;
    writePrivate(destination, bytes, match[1] === "100755" ? 0o700 : 0o600);
  }
}

function discoverGitRepositories(workspace) {
  const found = [];
  const pending = [{ directory: workspace, depth: 0 }];
  while (pending.length > 0) {
    const { directory, depth } = pending.pop();
    if (fs.existsSync(path.join(directory, ".git"))) found.push(directory);
    if (depth >= 5) continue;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || [".git", "node_modules", "vendor", "out", "cache"].includes(entry.name)) continue;
      pending.push({ directory: path.join(directory, entry.name), depth: depth + 1 });
    }
  }
  return found.sort();
}

function reserveOutputDirectory(requested, repositoryRoot) {
  const parent = path.dirname(requested);
  const parentStat = fs.lstatSync(parent);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) throw new BlindForwardError("OUTPUT_INVALID", "--output parent must be a regular directory");
  const realParent = fs.realpathSync(parent);
  const output = path.join(realParent, path.basename(requested));
  if (isInside(output, repositoryRoot)) throw new BlindForwardError("OUTPUT_INVALID", "--output must be outside the candidate repository");
  fs.mkdirSync(output, { mode: 0o700 });
  fs.chmodSync(output, 0o700);
  return output;
}

function candidateIdentity(repositoryRoot) {
  return {
    head: git(repositoryRoot, ["rev-parse", "HEAD"], true).stdout.toString("utf8").trim(),
    tree: git(repositoryRoot, ["rev-parse", "HEAD^{tree}"], true).stdout.toString("utf8").trim(),
    skillTree: git(repositoryRoot, ["rev-parse", `HEAD:${SKILL_PATH}`], true).stdout.toString("utf8").trim(),
    status: git(repositoryRoot, ["status", "--porcelain=v1", "--untracked-files=all"], true).stdout,
  };
}

function git(cwd, args, required, input = undefined) {
  const result = captured("git", args, { cwd, input, maximumBytes: MAX_CAPTURE_BYTES });
  if (required && result.status !== 0) throw new BlindForwardError("GIT_FAILED", `git ${args[0]} exited ${result.status}`, { stderr: result.stderr.toString("utf8") });
  return result;
}

function captured(command, args, { cwd, env = process.env, input = undefined, timeoutMs = undefined, maximumBytes = 8 * 1024 * 1024 } = {}) {
  const result = spawnSync(command, args, { cwd, env, input, timeout: timeoutMs, killSignal: "SIGTERM", encoding: null, shell: false, maxBuffer: maximumBytes });
  const error = result.error ? { code: result.error.code ?? "SPAWN_FAILED", message: result.error.message } : null;
  return { status: result.status, signal: result.signal ?? null, error, stdout: Buffer.from(result.stdout ?? ""), stderr: Buffer.from(result.stderr ?? "") };
}

function toolVersion(command, args, env, cwd) {
  const result = captured(command, args, { cwd, env, maximumBytes: 1024 * 1024 });
  return { argv: [path.basename(command), ...args], exitCode: result.status, output: `${result.stdout}${result.stderr}`.trim().slice(0, 4096) };
}

function readPlainFile(filePath, label) {
  requirePlainFile(filePath, label);
  return fs.readFileSync(filePath);
}

function requirePlainFile(filePath, label) {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new BlindForwardError("INPUT_INVALID", `${label} must be a regular non-symlink file`);
}

function resolveRepositoryDirectory(repositoryRoot, repositoryPath) {
  if (typeof repositoryPath !== "string" || repositoryPath.length === 0 || path.isAbsolute(repositoryPath)) throw new Error("cwd must be repository-relative");
  let cursor = fs.realpathSync(repositoryRoot);
  for (const segment of repositoryPath === "." ? [] : repositoryPath.split("/")) {
    if (!segment || segment === "." || segment === ".." || segment.includes("\\")) throw new Error("cwd contains an unsafe segment");
    cursor = path.join(cursor, segment);
    const stat = fs.lstatSync(cursor);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("cwd must traverse regular directories");
  }
  return cursor;
}

function writePrivate(filePath, bytes, mode = 0o600) {
  fs.writeFileSync(filePath, bytes, { flag: "wx", mode });
}

function sha256(bytes) { return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`; }
function sha256File(filePath) { return sha256(fs.readFileSync(filePath)); }
function isInside(candidate, root) { const relative = path.relative(root, candidate); return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)); }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
