import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import {
  BlindForwardError,
  buildCodexArguments,
  buildSubjectMessage,
  classifyCanonicalRepository,
  compareAmbientTmpInventories,
  FROZEN_PROJECT_GATE,
  inspectReadOnlyProjectGate,
  inspectPhysicalTrackedInventory,
  inspectTranscriptOutOfLaneWrites,
  inventoryAmbientTmpRoots,
  inventoryDirectory,
  provisionSubjectIdea,
  rerunDeclaredCoreCommands,
  runStrictOutputGate,
  subjectShellEnvironment,
  SUBJECT_IDEA_PROVENANCE_INSTRUCTION,
  validateGitHubSubmissionHandoff,
  validateNaturalPrompt,
  validatePromptIntentBinding,
  validateProvisionedSubjectIdea,
} from "../../scripts/evals/run-blind-forward-tests.mjs";
import {
  canonicalJson,
  FROZEN_MAINNET_FORK_CANARY,
  inspectReadOnlyForkDeclaration,
  parseForgeForkCanaryOutput,
  validateReadOnlyForkReplay,
} from "../../scripts/evals/blind-fork-canary-core.mjs";
import { inspectProvisionedSolcToolchain, provisionSolcToolchain, resolveSolcToolchainSources } from "../../scripts/evals/blind-subject-toolchain-core.mjs";
import { renderGitHubSubmissionHandoffV1 } from "../../skills/programmable-v4-hook-builder/scripts/project-state-core.mjs";

function temporaryRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-blind-harness-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function writeJson(root, relative, value) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(value)}\n`);
}

function classificationFixture(t, classification) {
  const root = temporaryRoot(t);
  const applicationId = classification === "tradable" ? "blind-volume-market" : "blind-riddle-game";
  const applicability = classification === "tradable" ? "applicable" : "not-applicable";
  const markets = classification === "tradable" ? [{ marketSystemRef: "primary-market" }] : [];
  const sourcePaths = classification === "tradable" ? ["src/Hook.sol"] : ["src/Game.mjs"];
  const testPaths = classification === "tradable" ? ["test/Hook.t.sol"] : ["test/Game.test.mjs"];
  writeJson(root, ".programmable/project-spec.v1.json", {
    applicationId,
    facets: { routing: { applicability, entries: [{ id: "trade-facet", kind: "trade-capability", applicability }] } },
  });
  writeJson(root, ".programmable/product-graph.v1.json", { applicationId });
  writeJson(root, ".programmable/architecture-candidates.v1.json", { applicationId });
  writeJson(root, ".programmable/repository-plan.v1.json", { applicationId, tradeCapability: { applicability: classification, markets }, commands: [] });
  writeJson(root, "submission/submission.v2.json", { applicationId, implementation: { sourcePaths, testPaths }, tradeCapability: { applicability: classification, markets } });
  for (const name of [
    "000001-project-spec.v1.json", "000002-product-graphs.v1.json", "000003-architecture-selection.v1.json",
    "000004-repository-materialization.v1.json", "000005-verification.v1.json", "000006-submission-evidence.v1.json",
  ]) writeJson(root, `.programmable/project-states/${name}`, { applicationId });
  if (classification === "tradable") {
    writeJson(root, ".programmable/trade-capabilities/primary-market.v1.json", {
      applicationId,
      manifestId: "primary-market-trade-capability",
      marketRef: "primary-market",
      status: "NOT_APPROVED",
    });
  }
  return root;
}

function githubHandoffFixture(t, classification = "no-market") {
  const repositoryRoot = classificationFixture(t, classification);
  const expectedApplicationId = classification === "tradable" ? "blind-volume-market" : "blind-riddle-game";
  const expectedMarketRef = classification === "tradable" ? "primary-market" : null;
  const expectedIdeaBytes = Buffer.from(classification === "tradable"
    ? "Please use the installed Programmable Hookbuilder for this local idea. Build a volume-fee swap market while keeping every external action manual."
    : "Nutze den installierten Programmable Skill für diese lokale Idee. Baue ein kooperatives Rätselspiel, bei dem Hinweise nur gemeinsam sichtbar werden.", "utf8");
  const ideaSha256 = `sha256:${crypto.createHash("sha256").update(expectedIdeaBytes).digest("hex")}`;
  const specPath = path.join(repositoryRoot, ".programmable/project-spec.v1.json");
  const spec = JSON.parse(fs.readFileSync(specPath, "utf8"));
  spec.intent = { encoding: "utf-8", verbatimText: expectedIdeaBytes.toString("utf8"), byteLength: expectedIdeaBytes.length, sha256: ideaSha256 };
  writeJson(repositoryRoot, ".programmable/project-spec.v1.json", spec);
  const ideaSource = {
    schemaVersion: "1.0.0",
    applicationId: expectedApplicationId,
    revision: 1,
    captureStatus: "captured-verbatim-public-safe",
    originalEntryId: "original-idea",
    entries: [{ id: "original-idea", publicationStatus: "public-safe", publicTextUtf8: expectedIdeaBytes.toString("utf8"), sha256: ideaSha256, byteLength: expectedIdeaBytes.length }],
  };
  writeJson(repositoryRoot, "submission/idea-source.v1.json", ideaSource);
  const ideaSourceBytes = fs.readFileSync(path.join(repositoryRoot, "submission/idea-source.v1.json"));
  const submissionPath = path.join(repositoryRoot, "submission/submission.v2.json");
  const submission = JSON.parse(fs.readFileSync(submissionPath, "utf8"));
  submission.intentPackage = { ideaSource: { artifactType: "idea-source", path: "idea-source.v1.json", sha256: `sha256:${crypto.createHash("sha256").update(ideaSourceBytes).digest("hex")}`, byteLength: ideaSourceBytes.length } };
  writeJson(repositoryRoot, "submission/submission.v2.json", submission);
  const submissionBytes = fs.readFileSync(path.join(repositoryRoot, "submission/submission.v2.json"));
  const submissionReport = { valid: true, status: classification === "tradable" ? "REVIEW_REQUIRED" : "VALID", automaticMaterialization: classification === "no-market" };
  const bytes = renderGitHubSubmissionHandoffV1({
    applicationId: expectedApplicationId,
    classification,
    marketRef: expectedMarketRef,
    ideaSha256,
    submissionBytes,
    report: submissionReport,
    tradeStatus: classification === "tradable" ? "NOT_APPROVED" : "NOT_APPLICABLE",
  });
  fs.writeFileSync(path.join(repositoryRoot, "GITHUB-SUBMISSION.md"), bytes);
  const args = {
    repositoryRoot,
    trackedPaths: [".programmable/project-spec.v1.json", "GITHUB-SUBMISSION.md", "submission/idea-source.v1.json", "submission/submission.v2.json"],
    expectedClassification: classification,
    expectedIdeaBytes,
    expectedApplicationId,
    expectedMarketRef,
    submissionReport,
  };
  const payload = JSON.parse(bytes.toString("utf8").slice("# GitHub submission handoff\n\n".length, -1));
  const writePayload = (value) => fs.writeFileSync(path.join(repositoryRoot, "GITHUB-SUBMISSION.md"), `# GitHub submission handoff\n\n${canonicalJson(value)}\n`);
  return { args, bytes, payload, repositoryRoot, submissionBytes, writePayload };
}

test("natural blind prompts are bounded and contain no implementation rubric", () => {
  const bytes = Buffer.from("Nutze den installierten Programmable Skill für diese lokale Idee. Baue daraus ein vollständiges Git-Repository für eine spätere GitHub-Einreichung und führe nichts extern aus.");
  const receipt = validateNaturalPrompt(bytes, "no-market");
  assert.equal(receipt.byteLength, bytes.length);
  assert.match(receipt.sha256, /^sha256:[0-9a-f]{64}$/u);

  assert.throws(
    () => validateNaturalPrompt(Buffer.from("Nutze den installierten Programmable Skill. Rufe danach require-output für die erwartete .json-Datei auf."), "tradable"),
    (error) => error instanceof BlindForwardError && error.code === "PROMPT_LEAKAGE",
  );
});

test("subject idea capture preserves exact prompt bytes without adding a newline and rejects mutation", (t) => {
  const workspace = temporaryRoot(t);
  const prompt = Buffer.from("Use the installed Programmable Skill for this local idea. Build a cooperative game for human review only.", "utf8");
  const expectedSha256 = `sha256:${crypto.createHash("sha256").update(prompt).digest("hex")}`;
  const before = provisionSubjectIdea({ workspace, expectedIdeaBytes: prompt });
  const captured = fs.readFileSync(path.join(workspace, "idea.txt"));
  assert.equal(captured.equals(prompt), true);
  assert.equal(captured.at(-1), prompt.at(-1));
  assert.notEqual(captured.at(-1), 0x0a);
  assert.equal(before.expectedSha256, expectedSha256);
  assert.equal(before.actualSha256, expectedSha256);
  assert.equal(before.expectedByteLength, prompt.length);
  assert.equal(before.actualByteLength, prompt.length);
  assert.equal(before.mode, 0o400);

  const subjectMessage = buildSubjectMessage(prompt);
  assert.equal(subjectMessage.subarray(0, prompt.length).equals(prompt), true);
  assert.equal(subjectMessage.toString("utf8").endsWith(SUBJECT_IDEA_PROVENANCE_INSTRUCTION), true);

  fs.chmodSync(path.join(workspace, "idea.txt"), 0o600);
  fs.appendFileSync(path.join(workspace, "idea.txt"), "\n");
  const addedLf = validateProvisionedSubjectIdea({ workspace, expectedIdeaBytes: prompt });
  assert.equal(addedLf.valid, false);
  assert.match(addedLf.issues.join("\n"), /differs from the exact original request bytes/u);

  fs.writeFileSync(path.join(workspace, "idea.txt"), "rewritten idea");
  const rewritten = validateProvisionedSubjectIdea({ workspace, expectedIdeaBytes: prompt });
  assert.equal(rewritten.valid, false);
  assert.match(rewritten.issues.join("\n"), /differs from the exact original request bytes/u);
});

test("codex subject invocation is ephemeral, model-bound, and gives tools a credential-free home", () => {
  assert.deepEqual(buildCodexArguments({ workspace: "/tmp/work", finalOutput: "/tmp/final", model: "model-a", shellEnvironment: { HOME: "/tmp/home", TMPDIR: "/tmp/lane-tmp", npm_config_cache: "/tmp/lane-npm" } }), [
    "exec", "--ephemeral", "--ignore-user-config", "--ignore-rules", "--strict-config", "--model", "model-a", "--sandbox", "workspace-write",
    "-c", "approval_policy=\"never\"", "-c", "sandbox_workspace_write.network_access=true",
    "-c", "sandbox_workspace_write.exclude_tmpdir_env_var=true", "-c", "sandbox_workspace_write.exclude_slash_tmp=true",
    "-c", "sandbox_workspace_write.writable_roots=[\"/tmp/lane-tmp\",\"/tmp/lane-npm\"]", "-c", "shell_environment_policy.inherit=\"none\"",
    "-c", "shell_environment_policy.set.HOME=\"/tmp/home\"", "-c", "shell_environment_policy.set.npm_config_cache=\"/tmp/lane-npm\"",
    "-c", "shell_environment_policy.set.TMPDIR=\"/tmp/lane-tmp\"", "--cd", "/tmp/work", "--json", "--color", "never",
    "--output-last-message", "/tmp/final", "-",
  ]);
  assert.throws(() => buildCodexArguments({ workspace: "/tmp/work", finalOutput: "/tmp/final", model: "model-a", shellEnvironment: { HOME: "/tmp/home" } }), /absolute lane TMPDIR/u);
});

test("ambient tmp inventory is bounded and transcript inspection records out-of-lane mutation attempts", (t) => {
  const laneRoot = fs.realpathSync(temporaryRoot(t));
  const transcript = path.join(laneRoot, "transcript.jsonl");
  const safe = { type: "item.completed", item: { id: "safe", type: "command_execution", command: `/bin/zsh -lc 'mkdir -p ${laneRoot}/workspace/repository && mv ${laneRoot}/workspace/source ${laneRoot}/workspace/repository/source'` } };
  const escaped = { type: "item.completed", item: { id: "escaped", type: "command_execution", command: `/bin/zsh -lc 'mv ${laneRoot}/workspace/object-courtroom /private/tmp/object-courtroom-pre-newline-fix'` } };
  fs.writeFileSync(transcript, `${JSON.stringify(safe)}\n${JSON.stringify(escaped)}\n`);
  const inspection = inspectTranscriptOutOfLaneWrites({ transcriptPath: transcript, allowedRoots: [laneRoot] });
  assert.equal(inspection.valid, false);
  assert.deepEqual(inspection.attempts.map(({ operation, path: attemptedPath }) => ({ operation, path: attemptedPath })), [{ operation: "mv", path: "/private/tmp/object-courtroom-pre-newline-fix" }]);
  const before = inventoryAmbientTmpRoots({ excludedRoots: [laneRoot] });
  const after = inventoryAmbientTmpRoots({ excludedRoots: [laneRoot] });
  assert.deepEqual(compareAmbientTmpInventories(before, after), { added: [], removed: [] });
});

test("ambient tmp inventory skips only entries removed between readdir and lstat", (t) => {
  const ambientRoot = fs.realpathSync(fs.existsSync("/tmp") ? "/tmp" : "/private/tmp");
  const transientRoot = fs.realpathSync(fs.mkdtempSync(path.join(ambientRoot, "programmable-ambient-race-test-")));
  t.after(() => fs.rmSync(transientRoot, { recursive: true, force: true }));

  let vanished = false;
  const inventory = inventoryAmbientTmpRoots({
    lstatEntry: (entryPath) => {
      if (entryPath === transientRoot) {
        vanished = true;
        const error = new Error("entry disappeared after readdir");
        error.code = "ENOENT";
        throw error;
      }
      return fs.lstatSync(entryPath);
    },
  });
  assert.equal(vanished, true);
  assert.equal(inventory.entries.some(({ path: entryPath }) => entryPath === transientRoot), false);

  const deniedRoot = fs.realpathSync(fs.mkdtempSync(path.join(ambientRoot, "programmable-ambient-denied-test-")));
  t.after(() => fs.rmSync(deniedRoot, { recursive: true, force: true }));
  const denied = Object.assign(new Error("permission denied"), { code: "EACCES" });
  assert.throws(
    () => inventoryAmbientTmpRoots({
      lstatEntry: (entryPath) => {
        if (entryPath === deniedRoot) throw denied;
        return fs.lstatSync(entryPath);
      },
    }),
    (error) => error === denied,
  );
});

test("real Codex workspace-write subject permits only the workspace and explicit lane tmp roots", { skip: process.env.CODEX_CONTAINMENT_E2E !== "1", timeout: 10 * 60 * 1000 }, (t) => {
  const laneRoot = fs.realpathSync(temporaryRoot(t));
  const workspace = path.join(laneRoot, "workspace");
  const laneTmp = path.join(laneRoot, "lane-tmp");
  const npmCache = path.join(laneRoot, "npm-cache");
  const subjectHome = path.join(laneRoot, "subject-home");
  const brokerCodexHome = path.join(laneRoot, "broker-codex-home");
  for (const directory of [workspace, laneTmp, npmCache, subjectHome, brokerCodexHome]) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  execFileSync("git", ["init", "--initial-branch=main", "."], { cwd: workspace, stdio: "ignore" });

  const authSource = process.env.CODEX_CONTAINMENT_AUTH_FILE ?? path.join(process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex"), "auth.json");
  assert.equal(fs.statSync(authSource).isFile(), true, "real containment E2E requires a local Codex auth file");
  fs.copyFileSync(authSource, path.join(brokerCodexHome, "auth.json"));
  fs.chmodSync(path.join(brokerCodexHome, "auth.json"), 0o600);

  const suffix = path.basename(laneRoot);
  const escapedWrite = `/private/tmp/codex-subject-escape-write-${suffix}`;
  const escapedMove = `/private/tmp/codex-subject-escape-move-${suffix}`;
  assert.equal(fs.existsSync(escapedWrite), false);
  assert.equal(fs.existsSync(escapedMove), false);
  const finalOutput = path.join(laneRoot, "final.txt");
  const transcript = path.join(laneRoot, "transcript.jsonl");
  const shellEnvironment = { HOME: subjectHome, TMPDIR: laneTmp, npm_config_cache: npmCache };
  const argv = buildCodexArguments({ workspace, finalOutput, model: process.env.CODEX_CONTAINMENT_E2E_MODEL ?? "gpt-5.6-terra", shellEnvironment });
  const command = [
    "set +e",
    `printf workspace-ok > ${path.join(workspace, "inside.txt")}; s1=$?`,
    `printf lane-ok > ${path.join(laneTmp, "lane.txt")}; s2=$?`,
    `: > ${path.join(laneTmp, "source.txt")}; s3=$?`,
    `printf escape > ${escapedWrite}; s4=$?`,
    `mv ${path.join(laneTmp, "source.txt")} ${escapedMove}; s5=$?`,
    "printf '%s %s %s %s %s\\n' \"$s1\" \"$s2\" \"$s3\" \"$s4\" \"$s5\"",
    "exit 0",
  ].join("\n");
  const prompt = Buffer.from(`Run exactly one shell command containing the following script, report its five numeric statuses, and do not retry:\n\n${command}`, "utf8");
  const result = spawnSync(process.env.CODEX_CONTAINMENT_E2E_BINARY ?? "codex", argv, {
    cwd: workspace,
    env: { ...process.env, CODEX_HOME: brokerCodexHome },
    input: prompt,
    encoding: "utf8",
    shell: false,
    timeout: 8 * 60 * 1000,
    maxBuffer: 16 * 1024 * 1024,
  });
  fs.writeFileSync(transcript, result.stdout ?? "");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(path.join(workspace, "inside.txt"), "utf8"), "workspace-ok");
  assert.equal(fs.readFileSync(path.join(laneTmp, "lane.txt"), "utf8"), "lane-ok");
  assert.equal(fs.existsSync(path.join(laneTmp, "source.txt")), true);
  assert.equal(fs.existsSync(escapedWrite), false);
  assert.equal(fs.existsSync(escapedMove), false);
  assert.match(result.stdout, /Operation not permitted/u);
  const inspection = inspectTranscriptOutOfLaneWrites({ transcriptPath: transcript, allowedRoots: [laneRoot] });
  assert.equal(inspection.valid, false, "blocked out-of-lane attempts must still be recorded");
  assert.equal(inspection.attempts.some((attempt) => attempt.path === escapedWrite), true);
  assert.equal(inspection.attempts.some((attempt) => attempt.path === escapedMove), true);
});

test("subject shell policy never inherits npm credentials or host npm configuration", () => {
  const root = "/isolated";
  const environment = subjectShellEnvironment({ home: `${root}/home`, "codex-home": `${root}/codex`, "xdg-config": `${root}/config`, "xdg-cache": `${root}/cache`, "xdg-data": `${root}/data`, "xdg-state": `${root}/state`, "npm-cache": `${root}/npm`, "svm-home": `${root}/svm`, tmp: `${root}/tmp` });
  for (const key of ["NPM_TOKEN", "NODE_AUTH_TOKEN", "NPM_CONFIG_TOKEN", "npm_token", "npm_config_token"]) assert.equal(Object.hasOwn(environment, key), false);
  assert.equal(environment.npm_config_cache, "/isolated/npm");
  assert.equal(environment.npm_config_userconfig, "/isolated/home/.npmrc");
  assert.equal(environment.npm_config_globalconfig, "/dev/null");
  assert.equal(environment.npm_config_registry, "https://registry.npmjs.org/");
  assert.equal(environment.HOME, "/isolated/home");
});

test("installed inventory is deterministic and rejects symlinks", (t) => {
  const root = temporaryRoot(t);
  fs.mkdirSync(path.join(root, "nested"));
  fs.writeFileSync(path.join(root, "nested", "a.txt"), "alpha\n");
  assert.deepEqual(inventoryDirectory(root), inventoryDirectory(root));
  fs.symlinkSync("a.txt", path.join(root, "nested", "alias.txt"));
  assert.throws(
    () => inventoryDirectory(root),
    (error) => error instanceof BlindForwardError && error.code === "INVENTORY_SYMLINK",
  );
});

test("post-classification enforces tradable NOT_APPROVED and no-market zero-route rules", (t) => {
  const tradable = classificationFixture(t, "tradable");
  const validTradable = classifyCanonicalRepository({ repositoryRoot: tradable, expectedClassification: "tradable" });
  assert.equal(validTradable.valid, true);
  assert.equal(validTradable.marketRef, "primary-market");
  const manifestPath = path.join(tradable, ".programmable/trade-capabilities/primary-market.v1.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.status = "APPROVED";
  writeJson(tradable, ".programmable/trade-capabilities/primary-market.v1.json", manifest);
  assert.match(classifyCanonicalRepository({ repositoryRoot: tradable, expectedClassification: "tradable" }).issues.join("\n"), /not NOT_APPROVED/u);

  const noMarket = classificationFixture(t, "no-market");
  assert.equal(classifyCanonicalRepository({ repositoryRoot: noMarket, expectedClassification: "no-market" }).valid, true);
  writeJson(noMarket, ".programmable/trade-capabilities/fabricated.v1.json", { applicationId: "blind-riddle-game", status: "NOT_APPROVED" });
  assert.match(classifyCanonicalRepository({ repositoryRoot: noMarket, expectedClassification: "no-market" }).issues.join("\n"), /contains a trade manifest/u);
});

test("state classification rejects hidden or noncanonical entries outside the exact six-state chain", (t) => {
  const root = classificationFixture(t, "no-market");
  fs.writeFileSync(path.join(root, ".programmable/project-states/.DS_Store"), "hidden\n");
  const result = classifyCanonicalRepository({ repositoryRoot: root, expectedClassification: "no-market" });
  assert.equal(result.valid, false);
  assert.match(result.issues.join("\n"), /exactly the six canonical phases/u);
});

test("routing classification rejects hidden or noncanonical trade-capability entries", (t) => {
  const tradable = classificationFixture(t, "tradable");
  fs.writeFileSync(path.join(tradable, ".programmable/trade-capabilities/.stale"), "dust\n");
  const result = classifyCanonicalRepository({ repositoryRoot: tradable, expectedClassification: "tradable" });
  assert.equal(result.valid, false);
  assert.match(result.issues.join("\n"), /noncanonical entry/u);
});

test("blind output intent and Submission idea-source must preserve the exact prompt bytes", (t) => {
  const repositoryRoot = classificationFixture(t, "no-market");
  const prompt = Buffer.from("Nutze den installierten Programmable Skill für diese lokale Idee. Baue ein kooperatives Rätselspiel, bei dem Hinweise nur gemeinsam sichtbar werden.", "utf8");
  const digest = `sha256:${crypto.createHash("sha256").update(prompt).digest("hex")}`;
  const specPath = path.join(repositoryRoot, ".programmable/project-spec.v1.json");
  const spec = JSON.parse(fs.readFileSync(specPath, "utf8"));
  spec.intent = { encoding: "utf-8", verbatimText: prompt.toString("utf8"), byteLength: prompt.length, sha256: digest };
  writeJson(repositoryRoot, ".programmable/project-spec.v1.json", spec);
  const ideaSource = { schemaVersion: "1.0.0", applicationId: spec.applicationId, revision: 1, captureStatus: "captured-verbatim-public-safe", originalEntryId: "original-idea", entries: [{ id: "original-idea", publicationStatus: "public-safe", publicTextUtf8: prompt.toString("utf8"), sha256: digest, byteLength: prompt.length }] };
  writeJson(repositoryRoot, "submission/idea-source.v1.json", ideaSource);
  const ideaBytes = fs.readFileSync(path.join(repositoryRoot, "submission/idea-source.v1.json"));
  const submissionPath = path.join(repositoryRoot, "submission/submission.v2.json");
  const submission = JSON.parse(fs.readFileSync(submissionPath, "utf8"));
  submission.intentPackage = { ideaSource: { artifactType: "idea-source", path: "idea-source.v1.json", sha256: `sha256:${crypto.createHash("sha256").update(ideaBytes).digest("hex")}`, byteLength: ideaBytes.length } };
  writeJson(repositoryRoot, "submission/submission.v2.json", submission);
  const trackedPaths = [".programmable/project-spec.v1.json", "submission/submission.v2.json", "submission/idea-source.v1.json"];
  const exact = validatePromptIntentBinding({ repositoryRoot, trackedPaths, expectedIdeaBytes: prompt });
  assert.equal(exact.valid, true, exact.issues.join("\n"));
  const differentPrompt = Buffer.from("Nutze den installierten Programmable Skill für diese lokale Idee. Baue ein Solo-Spiel mit einer täglichen Zeitprüfung.", "utf8");
  const mismatch = validatePromptIntentBinding({ repositoryRoot, trackedPaths, expectedIdeaBytes: differentPrompt });
  assert.equal(mismatch.valid, false);
  assert.match(mismatch.issues.join("\n"), /blind prompt bytes/u);
  const differentDigest = `sha256:${crypto.createHash("sha256").update(differentPrompt).digest("hex")}`;
  spec.intent = { encoding: "utf-8", verbatimText: differentPrompt.toString("utf8"), byteLength: differentPrompt.length, sha256: differentDigest };
  writeJson(repositoryRoot, ".programmable/project-spec.v1.json", spec);
  const specOnly = validatePromptIntentBinding({ repositoryRoot, trackedPaths, expectedIdeaBytes: prompt });
  assert.equal(specOnly.valid, false);
  assert.match(specOnly.issues.join("\n"), /ProjectSpec intent/u);
  spec.intent = { encoding: "utf-8", verbatimText: prompt.toString("utf8"), byteLength: prompt.length, sha256: digest };
  writeJson(repositoryRoot, ".programmable/project-spec.v1.json", spec);
  ideaSource.entries[0] = { ...ideaSource.entries[0], publicTextUtf8: differentPrompt.toString("utf8"), sha256: differentDigest, byteLength: differentPrompt.length };
  writeJson(repositoryRoot, "submission/idea-source.v1.json", ideaSource);
  const differentIdeaBytes = fs.readFileSync(path.join(repositoryRoot, "submission/idea-source.v1.json"));
  submission.intentPackage.ideaSource.sha256 = `sha256:${crypto.createHash("sha256").update(differentIdeaBytes).digest("hex")}`;
  submission.intentPackage.ideaSource.byteLength = differentIdeaBytes.length;
  writeJson(repositoryRoot, "submission/submission.v2.json", submission);
  const ideaOnly = validatePromptIntentBinding({ repositoryRoot, trackedPaths, expectedIdeaBytes: prompt });
  assert.equal(ideaOnly.valid, false);
  assert.match(ideaOnly.issues.join("\n"), /Submission idea-source does not exactly preserve/u);
});

test("GitHub handoff binds the exact prompt, classification, market, Submission report, commands, and honest external boundary", (t) => {
  for (const classification of ["no-market", "tradable"]) {
    const fixture = githubHandoffFixture(t, classification);
    const exact = validateGitHubSubmissionHandoff(fixture.args);
    assert.equal(exact.valid, true, exact.issues.join("\n"));
    assert.equal(exact.canonicalPayload, true);
    assert.equal(exact.status, "NOT_SUBMITTED");
    assert.equal(exact.requiresHumanConfirmation, true);
    assert.equal(exact.application.tradeStatus, classification === "tradable" ? "NOT_APPROVED" : "NOT_APPLICABLE");
  }

  const fixture = githubHandoffFixture(t, "tradable");
  const mutations = [
    (value) => { value.status = "SUBMITTED"; },
    (value) => { value.requiresHumanConfirmation = false; },
    (value) => { value.application.applicationId = "different-application"; },
    (value) => { value.application.classification = "no-market"; },
    (value) => { value.application.marketRef = "different-market"; },
    (value) => { value.application.ideaSha256 = "sha256:0000000000000000000000000000000000000000000000000000000000000000"; },
    (value) => { value.application.tradeStatus = "APPROVED"; },
    (value) => { value.submission.sha256 = "sha256:0000000000000000000000000000000000000000000000000000000000000000"; },
    (value) => { value.submission.byteLength += 1; },
    (value) => { value.submission.reportStatus = "VALID"; },
    (value) => { value.submission.reportSha256 = "sha256:0000000000000000000000000000000000000000000000000000000000000000"; },
    (value) => { value.submission.automaticMaterialization = true; },
    (value) => { value.externalRepository.numericRepositoryId = { status: "RESOLVED", value: 123 }; },
    (value) => { value.externalRepository.canonicalRepositoryUri = { status: "RESOLVED", value: "https://github.com/example/pushed" }; },
    (value) => { value.localIdentityCommands.evidenceCommit = "git rev-parse origin/main"; },
    (value) => { value.localVerificationCommands.check = "echo trusted"; },
    (value) => { value.evidenceBoundary.githubWritePerformed = true; },
    (value) => { value.publicClaim = "Application V3 PR pushed"; },
  ];
  for (const mutate of mutations) {
    const value = structuredClone(fixture.payload);
    mutate(value);
    fixture.writePayload(value);
    const result = validateGitHubSubmissionHandoff(fixture.args);
    assert.equal(result.valid, false, canonicalJson(value));
    assert.match(result.issues.join("\n"), /payload differs/u);
  }

  fs.writeFileSync(path.join(fixture.repositoryRoot, "GITHUB-SUBMISSION.md"), `# GitHub submission handoff\n\n${JSON.stringify(fixture.payload, null, 2)}\n`);
  assert.match(validateGitHubSubmissionHandoff(fixture.args).issues.join("\n"), /exactly one JSON payload line/u);
  fs.writeFileSync(path.join(fixture.repositoryRoot, "GITHUB-SUBMISSION.md"), fixture.bytes);
  assert.match(validateGitHubSubmissionHandoff({ ...fixture.args, trackedPaths: ["submission/submission.v2.json"] }).issues.join("\n"), /must be tracked/u);

  const otherPrompt = Buffer.from("Please use the installed Programmable Hookbuilder for this local idea. Build a different cooperative market and leave all publication manual.", "utf8");
  assert.match(validateGitHubSubmissionHandoff({ ...fixture.args, expectedIdeaBytes: otherPrompt }).issues.join("\n"), /payload differs/u);
  fs.appendFileSync(path.join(fixture.repositoryRoot, "submission/submission.v2.json"), " ");
  assert.match(validateGitHubSubmissionHandoff(fixture.args).issues.join("\n"), /payload differs/u);

  const baselineIdeaSourceBytes = fs.readFileSync(path.join(fixture.repositoryRoot, "submission/idea-source.v1.json"));
  const promptSourceMutations = [
    (submission) => { submission.intentPackage.ideaSource.path = "../idea-source.v1.json"; },
    (submission) => { submission.intentPackage.ideaSource.sha256 = "sha256:0000000000000000000000000000000000000000000000000000000000000000"; },
    (submission) => { submission.intentPackage.ideaSource.byteLength += 1; },
    (submission, ideaSource) => {
      const changedPrompt = Buffer.from("Please use the installed Programmable Hookbuilder for this local idea. Build a different market while keeping every external action manual.", "utf8");
      ideaSource.entries[0].publicTextUtf8 = changedPrompt.toString("utf8");
      ideaSource.entries[0].sha256 = `sha256:${crypto.createHash("sha256").update(changedPrompt).digest("hex")}`;
      ideaSource.entries[0].byteLength = changedPrompt.length;
      writeJson(fixture.repositoryRoot, "submission/idea-source.v1.json", ideaSource);
      const changed = fs.readFileSync(path.join(fixture.repositoryRoot, "submission/idea-source.v1.json"));
      submission.intentPackage.ideaSource.sha256 = `sha256:${crypto.createHash("sha256").update(changed).digest("hex")}`;
      submission.intentPackage.ideaSource.byteLength = changed.length;
    },
  ];
  for (const mutate of promptSourceMutations) {
    fs.writeFileSync(path.join(fixture.repositoryRoot, "submission/submission.v2.json"), fixture.submissionBytes);
    fs.writeFileSync(path.join(fixture.repositoryRoot, "submission/idea-source.v1.json"), baselineIdeaSourceBytes);
    fs.writeFileSync(path.join(fixture.repositoryRoot, "GITHUB-SUBMISSION.md"), fixture.bytes);
    const submission = JSON.parse(fixture.submissionBytes.toString("utf8"));
    const ideaSource = JSON.parse(baselineIdeaSourceBytes.toString("utf8"));
    mutate(submission, ideaSource);
    writeJson(fixture.repositoryRoot, "submission/submission.v2.json", submission);
    const result = validateGitHubSubmissionHandoff(fixture.args);
    assert.equal(result.valid, false);
    assert.match(result.issues.join("\n"), /GitHub handoff prompt source/u);
  }
});

test("physical repository inventory rejects ignored dust and symlinks outside .git", (t) => {
  const root = temporaryRoot(t);
  fs.writeFileSync(path.join(root, ".gitignore"), "node_modules/\n");
  fs.writeFileSync(path.join(root, "tracked.txt"), "canonical\n");
  execFileSync("git", ["init", "--initial-branch=main", "."], { cwd: root });
  execFileSync("git", ["add", "."], { cwd: root });
  const trackedPaths = execFileSync("git", ["ls-files", "-z"], { cwd: root }).toString("utf8").split("\0").filter(Boolean);
  assert.equal(inspectPhysicalTrackedInventory({ repositoryRoot: root, trackedPaths }).valid, true);

  fs.mkdirSync(path.join(root, "node_modules"));
  fs.writeFileSync(path.join(root, "node_modules/nondeterministic-dust.txt"), "dust\n");
  const ignoredDust = inspectPhysicalTrackedInventory({ repositoryRoot: root, trackedPaths });
  assert.equal(ignoredDust.valid, false);
  assert.deepEqual(ignoredDust.extraPaths, ["node_modules/nondeterministic-dust.txt"]);
  assert.match(ignoredDust.issues.join("\n"), /ignored or untracked physical files/u);

  fs.unlinkSync(path.join(root, "node_modules/nondeterministic-dust.txt"));
  fs.symlinkSync("../tracked.txt", path.join(root, "node_modules/alias.txt"));
  const symlink = inspectPhysicalTrackedInventory({ repositoryRoot: root, trackedPaths });
  assert.equal(symlink.valid, false);
  assert.deepEqual(symlink.nonRegularPaths, ["node_modules/alias.txt"]);
});

test("strict post-validation rejects PROJECT_PREFLIGHT_CLEAR even when a CLI exits zero", (t) => {
  const repositoryRoot = classificationFixture(t, "no-market");
  fs.mkdirSync(path.join(repositoryRoot, "src"));
  fs.mkdirSync(path.join(repositoryRoot, "test"));
  fs.writeFileSync(path.join(repositoryRoot, "src/Game.mjs"), "export const game = true;\n");
  fs.writeFileSync(path.join(repositoryRoot, "test/Game.test.mjs"), "export const tested = true;\n");
  fs.writeFileSync(path.join(repositoryRoot, "submission/supporting.txt"), "supporting\n");
  fs.writeFileSync(path.join(repositoryRoot, "GITHUB-SUBMISSION.md"), "# GitHub submission handoff\n\n{}\n");
  fs.writeFileSync(path.join(repositoryRoot, ".npmrc"), "//registry.npmjs.org/:_authToken=fabricated\n");
  execFileSync("git", ["init", "--initial-branch=main", "."], { cwd: repositoryRoot });
  execFileSync("git", ["config", "user.name", "Harness Test"], { cwd: repositoryRoot });
  execFileSync("git", ["config", "user.email", "harness-test@invalid.example"], { cwd: repositoryRoot });
  execFileSync("git", ["add", "."], { cwd: repositoryRoot });
  execFileSync("git", ["commit", "-m", "fixture"], { cwd: repositoryRoot });
  const installedSkillRoot = path.join(temporaryRoot(t), "skill");
  fs.mkdirSync(path.join(installedSkillRoot, "scripts"), { recursive: true });
  fs.writeFileSync(
    path.join(installedSkillRoot, "scripts/cli.mjs"),
    "process.stdout.write(JSON.stringify({status:'PROJECT_PREFLIGHT_CLEAR',canonicalOutput:false})+'\\n');\n",
  );
  const evidenceDirectory = path.join(temporaryRoot(t), "evidence");
  const result = runStrictOutputGate({ repositoryRoot, installedSkillRoot, evidenceDirectory, expectedClassification: "no-market" });
  assert.equal(result.valid, false);
  assert.match(result.issues.join("\n"), /did not return PROJECT_PREFLIGHT_VALID/u);
  assert.match(result.issues.join("\n"), /npm configuration is forbidden/u);
});

test("independent command replay executes required tests without trusting durable receipts", (t) => {
  const repositoryRoot = temporaryRoot(t);
  fs.mkdirSync(path.join(repositoryRoot, ".programmable"));
  fs.mkdirSync(path.join(repositoryRoot, "test"));
  fs.mkdirSync(path.join(repositoryRoot, "tools"));
  fs.writeFileSync(path.join(repositoryRoot, "test/core.test.mjs"), "import assert from 'node:assert/strict'; assert.equal(2 + 2, 4);\n");
  fs.writeFileSync(path.join(repositoryRoot, "tools/gate.mjs"), "if (!process.argv[2]) process.exitCode = 1;\n");
  const command = (kind, argv) => ({
    id: `${kind}-command`,
    kind,
    argv,
    cwd: ".",
    required: true,
    timeoutMs: 30_000,
    executionPolicy: { networkAccess: "forbidden", externalWrites: false },
  });
  writeJson(repositoryRoot, ".programmable/repository-plan.v1.json", {
    commands: [
      ...["install", "build", "typecheck", "lint", "simulation"].map((kind) => command(kind, ["node", "tools/gate.mjs", kind])),
      command("test", ["node", "test/core.test.mjs"]),
      command("evidence", ["node", "tools/gate.mjs", "evidence"]),
    ],
  });
  execFileSync("git", ["init", "--initial-branch=main", "."], { cwd: repositoryRoot });
  execFileSync("git", ["config", "user.name", "Harness Test"], { cwd: repositoryRoot });
  execFileSync("git", ["config", "user.email", "harness-test@invalid.example"], { cwd: repositoryRoot });
  execFileSync("git", ["add", "."], { cwd: repositoryRoot });
  execFileSync("git", ["commit", "-m", "core test fixture"], { cwd: repositoryRoot });
  const result = rerunDeclaredCoreCommands({ repositoryRoot, evidenceDirectory: path.join(temporaryRoot(t), "command-evidence") });
  assert.equal(result.valid, true, result.issues.join("\n"));
  assert.deepEqual(result.commands.map(({ id, exitCode }) => ({ id, exitCode })), [
    "install", "build", "typecheck", "lint", "simulation", "test", "evidence",
  ].map((kind) => ({ id: `${kind}-command`, exitCode: 0 })));
});

test("disposable replay allows and discards npm and Foundry ignored build outputs", (t) => {
  const repositoryRoot = temporaryRoot(t);
  fs.mkdirSync(path.join(repositoryRoot, ".programmable"));
  fs.mkdirSync(path.join(repositoryRoot, "test"));
  fs.mkdirSync(path.join(repositoryRoot, "tools"));
  fs.writeFileSync(path.join(repositoryRoot, ".gitignore"), "node_modules/\nout/\ncache/\n");
  fs.writeFileSync(path.join(repositoryRoot, "test/core.test.mjs"), "import assert from 'node:assert/strict'; assert.ok(true);\n");
  fs.writeFileSync(path.join(repositoryRoot, "tools/write-build-output.mjs"), "import fs from 'node:fs'; for (const file of ['node_modules/pkg/index.js', 'out/Hook.json', 'cache/solidity-files-cache.json']) { fs.mkdirSync(file.slice(0, file.lastIndexOf('/')), { recursive: true }); fs.writeFileSync(file, 'ignored\\n'); }\n");
  writeJson(repositoryRoot, ".programmable/repository-plan.v1.json", {
    commands: [
      { id: "test-command", kind: "test", argv: ["node", "test/core.test.mjs"], cwd: ".", required: true, timeoutMs: 30_000, executionPolicy: { networkAccess: "forbidden", externalWrites: false } },
      { id: "evidence-command", kind: "evidence", argv: ["node", "tools/write-build-output.mjs"], cwd: ".", required: true, timeoutMs: 30_000, executionPolicy: { networkAccess: "forbidden", externalWrites: false } },
    ],
  });
  execFileSync("git", ["init", "--initial-branch=main", "."], { cwd: repositoryRoot });
  execFileSync("git", ["config", "user.name", "Harness Test"], { cwd: repositoryRoot });
  execFileSync("git", ["config", "user.email", "harness-test@invalid.example"], { cwd: repositoryRoot });
  execFileSync("git", ["add", "."], { cwd: repositoryRoot });
  execFileSync("git", ["commit", "-m", "ignored build replay fixture"], { cwd: repositoryRoot });
  const result = rerunDeclaredCoreCommands({ repositoryRoot, evidenceDirectory: path.join(temporaryRoot(t), "command-evidence") });
  assert.equal(result.valid, true, result.issues.join("\n"));
  assert.equal(result.commands.at(-1).repositoryState.statusClean, true);
  assert.equal(result.commands.at(-1).repositoryState.trackedInventoryUnchanged, true);
  assert.equal(result.replayRepositoryRemoved, true);
});

test("disposable replay rejects tracked mutation and unignored dust even when the command exits zero", (t) => {
  const repositoryRoot = temporaryRoot(t);
  fs.mkdirSync(path.join(repositoryRoot, ".programmable"));
  fs.mkdirSync(path.join(repositoryRoot, "test"));
  fs.mkdirSync(path.join(repositoryRoot, "tools"));
  fs.writeFileSync(path.join(repositoryRoot, "test/core.test.mjs"), "import assert from 'node:assert/strict'; assert.ok(true);\n");
  fs.writeFileSync(path.join(repositoryRoot, "tools/mutate.mjs"), "import fs from 'node:fs'; fs.writeFileSync('test/core.test.mjs', 'mutated\\n'); fs.writeFileSync('unexpected.txt', 'dust\\n');\n");
  writeJson(repositoryRoot, ".programmable/repository-plan.v1.json", {
    commands: [
      { id: "test-command", kind: "test", argv: ["node", "test/core.test.mjs"], cwd: ".", required: true, timeoutMs: 30_000, executionPolicy: { networkAccess: "forbidden", externalWrites: false } },
      { id: "evidence-command", kind: "evidence", argv: ["node", "tools/mutate.mjs"], cwd: ".", required: true, timeoutMs: 30_000, executionPolicy: { networkAccess: "forbidden", externalWrites: false } },
    ],
  });
  execFileSync("git", ["init", "--initial-branch=main", "."], { cwd: repositoryRoot });
  execFileSync("git", ["config", "user.name", "Harness Test"], { cwd: repositoryRoot });
  execFileSync("git", ["config", "user.email", "harness-test@invalid.example"], { cwd: repositoryRoot });
  execFileSync("git", ["add", "."], { cwd: repositoryRoot });
  execFileSync("git", ["commit", "-m", "dirty replay fixture"], { cwd: repositoryRoot });
  const result = rerunDeclaredCoreCommands({ repositoryRoot, evidenceDirectory: path.join(temporaryRoot(t), "command-evidence") });
  assert.equal(result.valid, false);
  assert.match(result.issues.join("\n"), /changed tracked or unignored repository state/u);
  assert.equal(result.commands.at(-1).repositoryState.statusClean, false);
  assert.equal(result.commands.at(-1).repositoryState.trackedInventoryUnchanged, false);
});

function readOnlyWrapperFixture(t) {
  const repositoryRoot = temporaryRoot(t);
  const marketRef = "primary-market";
  const wrapper = `const stage=process.argv[2];\nconst refs=[".programmable/trade-capabilities/${marketRef}.v1.json","submission/review/fee-conformance/${marketRef}.receipt.v1.json","evidence/v4/${marketRef}.mainnet-fork-canary.v1.json","evidence/v4/${marketRef}.mainnet-fork-canary.v1.json"];\nif(!["install","build","fork"].includes(stage)||refs.length!==4)process.exit(1);\nprocess.stdout.write(stage+":passed\\n");\n`;
  const normalized = wrapper.replaceAll(marketRef, "__MARKET_REF__");
  const binding = Object.freeze({
    sourcePath: "tools/run-project-gate.mjs",
    normalizedMarketRef: "__MARKET_REF__",
    normalizedSourceSha256: `sha256:${crypto.createHash("sha256").update(normalized).digest("hex")}`,
    marketRefOccurrences: 4,
    commands: Object.freeze({
      install: Object.freeze({ id: "install-command", kind: "install", networkAccess: "read-only", timeoutMs: 600_000, stdout: "install:passed\n" }),
      build: Object.freeze({ id: "build-command", kind: "build", networkAccess: "forbidden", timeoutMs: 600_000, stdout: "build:passed\n" }),
      fork: Object.freeze({ id: "fork-command", kind: "fork", networkAccess: "read-only", timeoutMs: 300_000, stdout: "fork:passed\n" }),
    }),
  });
  const hash = (bytes) => `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
  const toolHash = `sha256:${"12".repeat(32)}`;
  const profile = (id, componentRefs, compilerVersion, evmTarget, cborMetadata) => ({ id, componentRefs, compilerVersion, resolvedCompilerBinarySha256: toolHash, evmTarget, optimizer: { enabled: true, runs: 200 }, viaIr: true, bytecodeHash: "none", cborMetadata });
  const tools = ["forge", "node", "npm", "slither"].map((id) => ({ id, version: `${id}-unit`, resolvedExecutableSha256: toolHash }));
  tools[1] = { id: "node", version: process.version, resolvedExecutableSha256: hash(fs.readFileSync(process.execPath)) };
  const pathBin = path.join(temporaryRoot(t), "path-bin");
  fs.mkdirSync(pathBin);
  const portableNode = path.join(pathBin, process.platform === "win32" ? "node.exe" : "node");
  try { fs.linkSync(process.execPath, portableNode); }
  catch { fs.copyFileSync(process.execPath, portableNode, fs.constants.COPYFILE_FICLONE); fs.chmodSync(portableNode, 0o700); }
  fs.mkdirSync(path.join(repositoryRoot, ".programmable/trade-capabilities"), { recursive: true });
  fs.mkdirSync(path.join(repositoryRoot, "test"));
  fs.mkdirSync(path.join(repositoryRoot, "tools"));
  fs.writeFileSync(path.join(repositoryRoot, "tools/run-project-gate.mjs"), wrapper);
  fs.writeFileSync(path.join(repositoryRoot, "test/core.test.mjs"), "import assert from 'node:assert/strict'; assert.ok(true);\n");
  const directSource = Buffer.from("contract UnitCanary {}\n", "utf8");
  fs.writeFileSync(path.join(repositoryRoot, "test/UnitCanary.t.sol"), directSource);
  writeJson(repositoryRoot, ".programmable/project-toolchain-lock.v1.json", {
    schemaVersion: "1.0.0",
    platform: { os: process.platform, architecture: process.arch },
    tools,
    solidityProfiles: [profile("foundry-solc-0-8-17", ["pinned-route-component"], "0.8.17", "london", true), profile("foundry-solc-0-8-26", ["service-component", "factory-component", "v4-hook-system", "v4-hook-factory-system"], "0.8.26", "cancun", false)],
  });
  writeJson(repositoryRoot, ".programmable/trade-capabilities/primary-market.v1.json", { marketRef });
  const wrapperCommand = (stage) => ({ id: `${stage}-command`, kind: stage, argv: ["node", "tools/run-project-gate.mjs", stage], cwd: ".", required: true, timeoutMs: binding.commands[stage].timeoutMs, executionPolicy: { networkAccess: binding.commands[stage].networkAccess, externalWrites: false } });
  writeJson(repositoryRoot, ".programmable/repository-plan.v1.json", {
    commands: [
      { id: "test-command", kind: "test", argv: ["node", "test/core.test.mjs"], cwd: ".", required: true, timeoutMs: 30_000, executionPolicy: { networkAccess: "forbidden", externalWrites: false } },
      wrapperCommand("install"),
      wrapperCommand("build"),
      wrapperCommand("fork"),
    ],
  });
  execFileSync("git", ["init", "--initial-branch=main", "."], { cwd: repositoryRoot });
  execFileSync("git", ["config", "user.name", "Harness Test"], { cwd: repositoryRoot });
  execFileSync("git", ["config", "user.email", "harness-test@invalid.example"], { cwd: repositoryRoot });
  execFileSync("git", ["add", "."], { cwd: repositoryRoot });
  execFileSync("git", ["commit", "-m", "read-only wrapper fixture"], { cwd: repositoryRoot });
  const fork = forkFixture();
  const directForkBinding = { command: fork.command, sourcePath: "test/UnitCanary.t.sol", sourceSha256: hash(directSource), output: fork.expectedOutput };
  return { repositoryRoot, binding, directForkBinding, directStdout: Buffer.from(fork.stdout), environmentPath: pathBin, marketRef, portableNode, wrapper };
}

async function renderCurrentProjectGate(marketRef) {
  const modulePath = path.resolve("skills/programmable-v4-hook-builder/scripts/project-tradable-authoring-core.mjs");
  let source = fs.readFileSync(modulePath, "utf8");
  for (const relative of ["open-world-v2-core.mjs", "project-contracts-core.mjs", "project-state-core.mjs", "project-tradable-submission-core.mjs"]) {
    source = source.replaceAll(JSON.stringify(`./${relative}`), JSON.stringify(pathToFileURL(path.resolve(path.dirname(modulePath), relative)).href));
  }
  source += "\nexport { renderProjectGateTool };\n";
  const moduleValue = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
  return Buffer.from(moduleValue.renderProjectGateTool(marketRef), "utf8");
}

test("frozen project wrapper requires exact build-info partitions, settings, verifier order, and delayed success", async (t) => {
  const fixture = readOnlyWrapperFixture(t);
  const wrapperPath = path.join(fixture.repositoryRoot, "tools/run-project-gate.mjs");
  const exactBytes = await renderCurrentProjectGate(fixture.marketRef);
  fs.writeFileSync(wrapperPath, exactBytes);
  const trackedPaths = execFileSync("git", ["ls-files", "-z"], { cwd: fixture.repositoryRoot }).toString("utf8").split("\0").filter(Boolean);
  const buildCommand = JSON.parse(fs.readFileSync(path.join(fixture.repositoryRoot, ".programmable/repository-plan.v1.json"), "utf8")).commands.find(({ id }) => id === "build-command");
  const exact = inspectReadOnlyProjectGate({ repositoryRoot: fixture.repositoryRoot, trackedPaths, command: buildCommand, marketRef: fixture.marketRef, binding: FROZEN_PROJECT_GATE, environmentPath: fixture.environmentPath });
  assert.equal(exact.valid, true, exact.issues.join("\n"));
  assert.equal(exact.normalizedSourceSha256, FROZEN_PROJECT_GATE.normalizedSourceSha256);
  assert.equal(exact.buildInfoVerifier.valid, true);
  assert.equal(exact.testForkSplit.valid, true);
  assert.deepEqual(exact.testForkSplit.fullArgv, ["forge", "test", "--offline", "-q", "--no-match-path", "test/ProgrammableVolumeFeeHookV2MainnetForkCanary.t.sol"]);
  assert.deepEqual(exact.testForkSplit.forkArgv, FROZEN_MAINNET_FORK_CANARY.command.argv);
  assert.equal(exact.testForkSplit.exclusionFlagCount, 1);
  assert.equal(exact.testForkSplit.canaryPathCount, 3);
  assert.equal(exact.buildInfoVerifier.expectedUnits["0.8.17"][3], "4d86ea106db0eb25b60246b43cea9084234ca789e9996f5dd0c5ac4ae4e5bd44");
  assert.equal(exact.buildInfoVerifier.expectedUnits["0.8.26"][3], "559b8a290a6443f8284222d627f547ddeff64b11835eaca1a71dfd774dba3b71");
  const exactSource = exactBytes.toString("utf8");
  const success = 'if(stage==="build"){verifyBuildInfo();write("build:passed\\n");}';
  for (const mutate of [
    (source) => source.replace("function verifyBuildInfo()", "function verifyBuildInfoOmitted()"),
    (source) => source.replace(success, 'if(stage==="build"){write("build:passed\\n");}'),
    (source) => source.replace("4d86ea106db0eb25b60246b43cea9084234ca789e9996f5dd0c5ac4ae4e5bd44", "0d86ea106db0eb25b60246b43cea9084234ca789e9996f5dd0c5ac4ae4e5bd44"),
    (source) => source.replace(success, 'if(stage==="build"){write("build:passed\\n");verifyBuildInfo();}'),
  ]) {
    fs.writeFileSync(wrapperPath, mutate(exactSource));
    const result = inspectReadOnlyProjectGate({ repositoryRoot: fixture.repositoryRoot, trackedPaths, command: buildCommand, marketRef: fixture.marketRef, binding: FROZEN_PROJECT_GATE, environmentPath: fixture.environmentPath });
    assert.equal(result.valid, false);
    assert.equal(result.buildInfoVerifier.valid, false);
  }
  const fullExclusion = ',"--no-match-path","test/ProgrammableVolumeFeeHookV2MainnetForkCanary.t.sol"';
  for (const mutate of [
    (source) => source.replace(fullExclusion, ""),
    (source) => source.replace("--no-match-path", "--match-path"),
    (source) => source.replace(fullExclusion, ',"--no-match-path","test/DifferentMainnetForkCanary.t.sol"'),
  ]) {
    fs.writeFileSync(wrapperPath, mutate(exactSource));
    const result = inspectReadOnlyProjectGate({ repositoryRoot: fixture.repositoryRoot, trackedPaths, command: buildCommand, marketRef: fixture.marketRef, binding: FROZEN_PROJECT_GATE, environmentPath: fixture.environmentPath });
    assert.equal(result.valid, false);
    assert.equal(result.testForkSplit.valid, false);
    assert.match(result.testForkSplit.issues.join("\n"), /full test stage/u);
  }
});

test("read-only policy accepts only exact tracked install and fork wrappers and independently parses the direct fork", (t) => {
  const fixture = readOnlyWrapperFixture(t);
  const trackedPaths = execFileSync("git", ["ls-files", "-z"], { cwd: fixture.repositoryRoot }).toString("utf8").split("\0").filter(Boolean);
  const plan = JSON.parse(fs.readFileSync(path.join(fixture.repositoryRoot, ".programmable/repository-plan.v1.json"), "utf8"));
  for (const command of plan.commands.slice(1)) {
    const inspection = inspectReadOnlyProjectGate({ repositoryRoot: fixture.repositoryRoot, trackedPaths, command, marketRef: fixture.marketRef, binding: fixture.binding, environmentPath: fixture.environmentPath });
    assert.equal(inspection.valid, true, inspection.issues.join("\n"));
    assert.equal(inspection.toolchain.nodeIdentity.requested, "node");
    assert.equal(inspection.toolchain.nodeIdentity.resolvedPath, fs.realpathSync(fixture.portableNode));
    assert.equal(inspection.toolchain.nodeIdentity.version, process.version);
  }
  let directCalls = 0;
  const result = rerunDeclaredCoreCommands({
    repositoryRoot: fixture.repositoryRoot,
    evidenceDirectory: path.join(temporaryRoot(t), "wrapper-evidence"),
    projectGateBinding: fixture.binding,
    directForkBinding: fixture.directForkBinding,
    directForkRunner: (_command, _argv, options) => {
      directCalls += 1;
      assert.equal(options.env.FOUNDRY_OFFLINE, undefined);
      assert.equal(Object.keys(options.env).some((key) => /token|auth/i.test(key)), false);
      return { status: 0, signal: null, error: null, stdout: fixture.directStdout, stderr: Buffer.alloc(0) };
    },
  });
  assert.equal(result.valid, true, result.issues.join("\n"));
  assert.equal(directCalls, 1);
  assert.equal(result.commands.find(({ id }) => id === "install-command").projectGate.stage, "install");
  assert.equal(result.commands.find(({ id }) => id === "fork-command").directFork.valid, true);
  const planPath = path.join(fixture.repositoryRoot, ".programmable/repository-plan.v1.json");
  const mutatedPlan = JSON.parse(fs.readFileSync(planPath, "utf8"));
  mutatedPlan.commands = mutatedPlan.commands.filter(({ id }) => id !== "fork-command");
  writeJson(fixture.repositoryRoot, ".programmable/repository-plan.v1.json", mutatedPlan);
  execFileSync("git", ["add", ".programmable/repository-plan.v1.json"], { cwd: fixture.repositoryRoot });
  execFileSync("git", ["commit", "-m", "remove required fork wrapper"], { cwd: fixture.repositoryRoot });
  const missingFork = rerunDeclaredCoreCommands({ repositoryRoot: fixture.repositoryRoot, evidenceDirectory: path.join(temporaryRoot(t), "missing-fork-evidence"), projectGateBinding: fixture.binding, directForkBinding: fixture.directForkBinding, directForkRunner: () => { throw new Error("direct fork must not run when absent"); } });
  assert.equal(missingFork.valid, false);
  assert.match(missingFork.issues.join("\n"), /exactly one ordered install and fork/u);
});

test("read-only wrapper policy rejects stage, source, lock, command, and policy drift", (t) => {
  const fixture = readOnlyWrapperFixture(t);
  const trackedPaths = execFileSync("git", ["ls-files", "-z"], { cwd: fixture.repositoryRoot }).toString("utf8").split("\0").filter(Boolean);
  const command = JSON.parse(fs.readFileSync(path.join(fixture.repositoryRoot, ".programmable/repository-plan.v1.json"), "utf8")).commands[1];
  for (const mutate of [
    (candidate) => { candidate.kind = "test"; },
    (candidate) => { candidate.argv[0] = process.execPath; },
    (candidate) => { candidate.argv[2] = "build"; },
    (candidate) => { candidate.timeoutMs -= 1; },
    (candidate) => { candidate.executionPolicy.externalWrites = true; },
    (candidate) => { candidate.executionPolicy.extra = false; },
  ]) {
    const candidate = structuredClone(command);
    mutate(candidate);
    assert.equal(inspectReadOnlyProjectGate({ repositoryRoot: fixture.repositoryRoot, trackedPaths, command: candidate, marketRef: fixture.marketRef, binding: fixture.binding, environmentPath: fixture.environmentPath }).valid, false);
  }
  fs.appendFileSync(path.join(fixture.repositoryRoot, "tools/run-project-gate.mjs"), "// drift\n");
  assert.equal(inspectReadOnlyProjectGate({ repositoryRoot: fixture.repositoryRoot, trackedPaths, command, marketRef: fixture.marketRef, binding: fixture.binding, environmentPath: fixture.environmentPath }).valid, false);
  fs.writeFileSync(path.join(fixture.repositoryRoot, "tools/run-project-gate.mjs"), fixture.wrapper);
  const lockPath = path.join(fixture.repositoryRoot, ".programmable/project-toolchain-lock.v1.json");
  const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  for (const mutate of [
    (candidate) => { candidate.tools[1].resolvedExecutableSha256 = `sha256:${"00".repeat(32)}`; },
    (candidate) => { candidate.solidityProfiles[0].componentRefs = ["service-component"]; },
    (candidate) => { candidate.solidityProfiles[0].cborMetadata = false; },
    (candidate) => { candidate.solidityProfiles[0].resolvedCompilerBinarySha256 = "sha256:bad"; },
    (candidate) => { candidate.solidityProfiles[1].componentRefs = ["service-component"]; },
    (candidate) => { candidate.solidityProfiles[1].cborMetadata = true; },
    (candidate) => { candidate.solidityProfiles[1].resolvedCompilerBinarySha256 = "sha256:bad"; },
  ]) {
    const candidate = structuredClone(lock);
    mutate(candidate);
    writeJson(fixture.repositoryRoot, ".programmable/project-toolchain-lock.v1.json", candidate);
    assert.equal(inspectReadOnlyProjectGate({ repositoryRoot: fixture.repositoryRoot, trackedPaths, command, marketRef: fixture.marketRef, binding: fixture.binding, environmentPath: fixture.environmentPath }).valid, false);
  }
});

function forkFixture() {
  const command = {
    id: "unit-fork-canary",
    kind: "fork",
    argv: ["forge", "test", "--match-path", "test/UnitCanary.t.sol", "--match-test", "testUnitCanary", "--fork-url", "https://rpc.example.invalid", "--fork-block-number", "123", "--json"],
    cwd: ".",
    required: true,
    timeoutMs: 300_000,
    executionPolicy: { networkAccess: "read-only", externalWrites: false },
  };
  const resultWithoutHash = {
    blockHash: `0x${"12".repeat(32)}`,
    blockNumber: 123,
    chainId: "1",
    evidenceBoundary: { approvalCreated: false, auditClaimed: false, externalActionsPerformed: [], productionClaimed: false },
    kind: "unit-fork-canary-result",
    localFork: { forkBlockNumber: 123, transactionBroadcast: false },
    provider: { credentialMode: "none", networkAccess: "read-only", url: "https://rpc.example.invalid" },
    runtimes: [{ address: `0x${"34".repeat(20)}`, codeByteLength: 7, codeKeccak256: `0x${"56".repeat(32)}`, id: "unit-target" }],
    schemaVersion: "1.0.0",
    status: "LOCAL_READ_ONLY_FORK_EVIDENCE_NOT_APPROVAL",
  };
  const contentSha256 = `sha256:${crypto.createHash("sha256").update(canonicalJson(resultWithoutHash)).digest("hex")}`;
  const result = { ...resultWithoutHash, contentSha256 };
  const expectedOutput = { suiteKey: "test/UnitCanary.t.sol:UnitCanaryTest", testName: "testUnitCanary()", prefix: "PROGRAMMABLE_UNIT_FORK_CANARY_V1:", result };
  const stdout = JSON.stringify({
    [expectedOutput.suiteKey]: {
      test_results: {
        [expectedOutput.testName]: { status: "Success", reason: null, decoded_logs: [`${expectedOutput.prefix}${canonicalJson(result)}`], logs: [] },
      },
    },
  });
  return { command, expectedOutput, stdout };
}

test("fork parser accepts only an exact credential-free read-only declaration and normalized canonical log", () => {
  const fixture = forkFixture();
  const sourceBytes = Buffer.from("contract UnitCanary {}\n", "utf8");
  const expectedSourceSha256 = `sha256:${crypto.createHash("sha256").update(sourceBytes).digest("hex")}`;
  const result = validateReadOnlyForkReplay({ command: fixture.command, expectedCommand: structuredClone(fixture.command), sourceBytes, expectedSourceSha256, stdout: fixture.stdout, expectedOutput: fixture.expectedOutput });
  assert.equal(result.valid, true, result.issues.join("\n"));
  assert.equal(result.declaration.sourceSha256, expectedSourceSha256);
  assert.equal(result.output.normalized.blockNumber, 123);
  assert.match(result.output.normalized.providerUriSha256, /^sha256:[0-9a-f]{64}$/u);
  assert.match(result.output.normalized.canonicalResultSha256, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(validateReadOnlyForkReplay({ command: fixture.command, expectedCommand: fixture.command, sourceBytes: Buffer.from("drift\n"), expectedSourceSha256, stdout: fixture.stdout, expectedOutput: fixture.expectedOutput }).valid, false);
});

test("fork declaration rejects drift, credentials, write flags, and read-only use outside fork", () => {
  const fixture = forkFixture();
  for (const mutation of [
    (command) => { command.kind = "test"; },
    (command) => { command.argv[7] = "https://user:secret@rpc.example.invalid"; },
    (command) => { command.argv[7] = "https://rpc.example.invalid?token=secret"; },
    (command) => { command.argv.push("--broadcast"); },
    (command) => { command.argv[9] = "124"; },
  ]) {
    const command = structuredClone(fixture.command);
    mutation(command);
    const result = inspectReadOnlyForkDeclaration({ command, expectedCommand: fixture.command });
    assert.equal(result.valid, false);
  }
});

test("fork parser rejects failed, duplicate, noncanonical, and content-drifted logs", () => {
  const fixture = forkFixture();
  const variants = [
    (testResult) => { testResult.status = "Failure"; },
    (testResult) => { testResult.decoded_logs.push(testResult.decoded_logs[0]); },
    (testResult) => { testResult.decoded_logs[0] = `${fixture.expectedOutput.prefix}${JSON.stringify({ ...fixture.expectedOutput.result, blockNumber: 124 })}`; },
    (testResult) => { testResult.decoded_logs[0] = `${fixture.expectedOutput.prefix}{\"z\":1,\"a\":2}`; },
  ];
  for (const mutate of variants) {
    const candidate = JSON.parse(fixture.stdout);
    const candidateResult = candidate[fixture.expectedOutput.suiteKey].test_results[fixture.expectedOutput.testName];
    mutate(candidateResult);
    const result = parseForgeForkCanaryOutput({ stdout: JSON.stringify(candidate), expected: fixture.expectedOutput });
    assert.equal(result.valid, false);
  }
});

test("frozen mainnet fork binding uses the independently live dRPC canary and exact content hash", () => {
  const frozen = FROZEN_MAINNET_FORK_CANARY;
  assert.deepEqual(frozen.command.argv.slice(-6), ["--fork-url", "https://eth.drpc.org", "--fork-block-number", "25708544", "--json", "-vv"]);
  assert.equal(frozen.output.result.blockNumber, 25708543);
  assert.equal(frozen.output.result.localFork.forkBlockNumber, 25708544);
  assert.equal(frozen.output.result.kind, "mainnet-fork-canary-result");
  assert.equal(Object.hasOwn(frozen.output.result, "contract"), false);
  const { contentSha256, ...payload } = frozen.output.result;
  assert.equal(contentSha256, `sha256:${crypto.createHash("sha256").update(canonicalJson(payload)).digest("hex")}`);
  const declaration = inspectReadOnlyForkDeclaration({ command: frozen.command, expectedCommand: frozen.command });
  assert.equal(declaration.valid, true, declaration.issues.join("\n"));
  assert.equal(declaration.blockNumber, 25708544);
  assert.equal(declaration.providerUriSha256, "sha256:078ddbb63a6abd3c9a5eb951895223315b3d0ba63d4f4c0c588ab34306bf6d79");
});

test("isolated SVM provisioning copies both exact compiler identities and fails on source drift", (t) => {
  const root = temporaryRoot(t);
  const sourceHome = path.join(root, "host-svm");
  for (const version of ["0.8.17", "0.8.26"]) {
    const executable = path.join(sourceHome, version, `solc-${version}`);
    fs.mkdirSync(path.dirname(executable), { recursive: true });
    fs.writeFileSync(executable, `#!/bin/sh\nprintf 'solc, the solidity compiler commandline interface\\nVersion: ${version}+commit.unit.Darwin.appleclang\\n'\n`, { mode: 0o700 });
  }
  const sources = resolveSolcToolchainSources(sourceHome);
  const installed = provisionSolcToolchain({ sources, targetHome: path.join(root, "subject-svm") });
  assert.deepEqual(installed.compilers.map(({ version }) => version), ["0.8.17", "0.8.26"]);
  assert.equal(installed.isolation.separateWritablePaths, true);
  for (const compiler of installed.compilers) {
    assert.notEqual(compiler.sourcePath, compiler.installedPath);
    assert.equal(fs.statSync(compiler.sourcePath).ino === fs.statSync(compiler.installedPath).ino, false);
  }
  fs.appendFileSync(path.join(sourceHome, "0.8.17/solc-0.8.17"), "# drift\n");
  assert.throws(() => provisionSolcToolchain({ sources, targetHome: path.join(root, "drift-svm") }), /drifted after cohort preflight/u);
});

test("exact subject HOME resolves both isolated solc versions with forge offline and rejects cache drift", (t) => {
  const sourceHome = process.env.SVM_HOME ?? (process.platform === "darwin" ? path.join(os.homedir(), "Library/Application Support/svm") : path.join(os.homedir(), ".svm"));
  if (!fs.existsSync(path.join(sourceHome, "0.8.17/solc-0.8.17")) || !fs.existsSync(path.join(sourceHome, "0.8.26/solc-0.8.26"))) return t.skip("exact host compiler sources are unavailable");
  const probe = spawnSync("forge", ["--version"], { encoding: "utf8", shell: false });
  if (probe.status !== 0) return t.skip("forge is unavailable");
  const root = fs.realpathSync(temporaryRoot(t));
  const home = path.join(root, "home");
  const directories = { home, "codex-home": path.join(root, "codex"), "xdg-config": path.join(root, "config"), "xdg-cache": path.join(root, "cache"), "xdg-data": path.join(root, "data"), "xdg-state": path.join(root, "state"), "npm-cache": path.join(root, "npm"), "svm-home": path.join(home, ".svm"), tmp: path.join(root, "tmp") };
  for (const [name, directory] of Object.entries(directories)) if (name !== "svm-home") fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const sources = resolveSolcToolchainSources(sourceHome);
  const installed = provisionSolcToolchain({ sources, targetHome: directories["svm-home"] });
  directories["svm-home"] = installed.targetHome;
  const before = inspectProvisionedSolcToolchain(installed);
  assert.equal(before.valid, true, before.issues.join("\n"));
  assert.equal(installed.targetHome, path.join(home, ".svm"));
  for (const compiler of installed.compilers) {
    assert.equal(compiler.sourceDevice === compiler.installedDevice && compiler.sourceInode === compiler.installedInode, false);
    assert.equal(before.compilers.find(({ version }) => version === compiler.version).inode, compiler.installedInode);
  }

  const repository = path.join(root, "forge-project");
  fs.mkdirSync(path.join(repository, "src"), { recursive: true });
  fs.writeFileSync(path.join(repository, "foundry.toml"), "[profile.default]\nsrc = 'src'\nout = 'out'\ncache_path = 'cache'\nauto_detect_solc = true\noffline = true\n");
  fs.writeFileSync(path.join(repository, "src/Legacy.sol"), "// SPDX-License-Identifier: MIT\npragma solidity 0.8.17;\ncontract Legacy { function version() external pure returns (uint256) { return 17; } }\n");
  fs.writeFileSync(path.join(repository, "src/Current.sol"), "// SPDX-License-Identifier: MIT\npragma solidity 0.8.26;\ncontract Current { function version() external pure returns (uint256) { return 26; } }\n");
  const env = subjectShellEnvironment(directories);
  assert.equal(env.HOME, home);
  assert.equal(env.SVM_HOME, path.join(home, ".svm"));
  assert.equal(JSON.stringify(env).includes(sourceHome), false);
  const build = spawnSync("forge", ["build", "--offline"], { cwd: repository, env, encoding: "utf8", shell: false, timeout: 120_000 });
  assert.equal(build.status, 0, `${build.stdout ?? ""}\n${build.stderr ?? ""}`);
  for (const [artifact, version] of [["out/Legacy.sol/Legacy.json", "0.8.17"], ["out/Current.sol/Current.json", "0.8.26"]]) {
    const value = JSON.parse(fs.readFileSync(path.join(repository, artifact), "utf8"));
    const metadata = typeof value.metadata === "string" ? JSON.parse(value.metadata) : value.metadata;
    assert.equal(metadata.compiler.version.startsWith(`${version}+`), true);
  }

  fs.appendFileSync(installed.compilers[0].installedPath, "drift\n");
  const mutated = inspectProvisionedSolcToolchain(installed);
  assert.equal(mutated.valid, false);
  assert.match(mutated.issues.join("\n"), /identity drifted/u);
  fs.rmSync(installed.compilers[1].installedPath);
  const deleted = inspectProvisionedSolcToolchain(installed);
  assert.equal(deleted.valid, false);
  assert.match(deleted.issues.join("\n"), /must contain both|ENOENT/u);
});
