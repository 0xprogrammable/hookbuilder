import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { toolDefinitions } from "../mcp/server-core.mjs";
import {
  CENTRAL_BASE_BRANCH,
  CENTRAL_REPOSITORY,
  CENTRAL_REPOSITORY_ID,
  INTAKE_STATUS_PATH
} from "../skills/programmable-v4-hook-builder/scripts/github-application-constants.mjs";
import { parseIntakeStatusBytes } from "../skills/programmable-v4-hook-builder/scripts/github-application-status-core.mjs";
import { PROGRAMMABLE_REGISTRY_NUMERIC_REPOSITORY_ID } from "../skills/programmable-v4-hook-builder/scripts/launch-bundle-v2-shared.mjs";
import {
  CENTRAL_GITHUB_BASE_BRANCH,
  CENTRAL_GITHUB_NUMERIC_REPOSITORY_ID,
  CENTRAL_GITHUB_REPOSITORY
} from "../skills/programmable-v4-hook-builder/scripts/open-world-shared.mjs";
import { REGISTRY_NUMERIC_ID } from "../skills/programmable-v4-hook-builder/scripts/registry-acceptance-v3-github-constants.mjs";
import { PROGRAMMABLE_REGISTRY } from "../skills/programmable-v4-hook-builder/scripts/registry-discovery-definitions.mjs";
import {
  HOOKBUILDER_LEGACY_APPLICANT_PULL_REQUESTS,
  SUBMIT_LAUNCH_INTAKE_CONTRACT,
  SUBMIT_LAUNCH_INTAKE_SCHEMA_VERSION,
  SUBMIT_LAUNCH_INTAKE_STATUS_PATH,
  SUBMIT_LAUNCH_REPOSITORY,
  SUBMIT_LAUNCH_REPOSITORY_ID,
  isSubmitLaunchIntakeStatusDocument
} from "../skills/programmable-v4-hook-builder/scripts/registry-intake-contract.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("one canonical contract owns every active one-off intake identity", () => {
  assert.equal(SUBMIT_LAUNCH_REPOSITORY, "0xprogrammable/submit-launch");
  assert.equal(SUBMIT_LAUNCH_REPOSITORY_ID, "1320171831");
  assert.equal(SUBMIT_LAUNCH_INTAKE_SCHEMA_VERSION, 2);
  assert.equal(SUBMIT_LAUNCH_INTAKE_CONTRACT.repository.defaultBranch, "main");
  assert.equal(SUBMIT_LAUNCH_INTAKE_CONTRACT.draftOnly, true);
  assert.deepEqual(HOOKBUILDER_LEGACY_APPLICANT_PULL_REQUESTS, [10, 11, 12, 14, 15, 18, 19, 20]);

  assert.equal(CENTRAL_REPOSITORY, SUBMIT_LAUNCH_REPOSITORY);
  assert.equal(CENTRAL_REPOSITORY_ID, SUBMIT_LAUNCH_REPOSITORY_ID);
  assert.equal(CENTRAL_BASE_BRANCH, SUBMIT_LAUNCH_INTAKE_CONTRACT.repository.defaultBranch);
  assert.equal(INTAKE_STATUS_PATH, SUBMIT_LAUNCH_INTAKE_STATUS_PATH);
  assert.equal(CENTRAL_GITHUB_REPOSITORY, SUBMIT_LAUNCH_REPOSITORY);
  assert.equal(CENTRAL_GITHUB_NUMERIC_REPOSITORY_ID, SUBMIT_LAUNCH_REPOSITORY_ID);
  assert.equal(CENTRAL_GITHUB_BASE_BRANCH, SUBMIT_LAUNCH_INTAKE_CONTRACT.repository.defaultBranch);
  assert.equal(PROGRAMMABLE_REGISTRY.repository, SUBMIT_LAUNCH_REPOSITORY);
  assert.equal(PROGRAMMABLE_REGISTRY.numericRepositoryId, SUBMIT_LAUNCH_REPOSITORY_ID);
  assert.equal(PROGRAMMABLE_REGISTRY_NUMERIC_REPOSITORY_ID, SUBMIT_LAUNCH_REPOSITORY_ID);
  assert.equal(REGISTRY_NUMERIC_ID, SUBMIT_LAUNCH_REPOSITORY_ID);
});

test("released schema-2 intake status is exact and rejects drift", () => {
  const current = {
    continuingPullRequests: [],
    schemaVersion: 2,
    state: "prelaunch"
  };
  assert.equal(isSubmitLaunchIntakeStatusDocument(current), true);
  const parsed = parseIntakeStatusBytes(Buffer.from(`${JSON.stringify(current)}\n`, "utf8"));
  assert.equal(parsed.schemaVersion, 2);
  assert.equal(parsed.state, "prelaunch");
  assert.deepEqual(parsed.continuingPullRequests, []);

  for (const drift of [
    { ...current, schemaVersion: 3 },
    { ...current, state: "unknown" },
    { ...current, repository: SUBMIT_LAUNCH_REPOSITORY },
    { schemaVersion: 2, state: "prelaunch" }
  ]) {
    assert.equal(isSubmitLaunchIntakeStatusDocument(drift), false);
    assert.throws(
      () => parseIntakeStatusBytes(Buffer.from(`${JSON.stringify(drift)}\n`, "utf8")),
      /trusted intake status/u
    );
  }
});

test("active docs and package metadata agree on Submit a Launch", () => {
  const activeSurfaces = [
    "README.md",
    "CONTRIBUTING.md",
    "docs/AGENT_SKILL.md",
    "docs/ARCHITECTURE.md",
    "docs/PUBLIC_GITHUB_PR_BETA.md",
    "skills/programmable-v4-hook-builder/SKILL.md",
    "skills/programmable-v4-hook-builder/references/agent-entry-and-application.md",
    "skills/programmable-v4-hook-builder/references/github-application-journey.md",
    "skills/programmable-v4-hook-builder/references/output-contract.md",
    "skills/programmable-v4-hook-builder/references/submission-workflow.md",
    "skills/programmable-v4-hook-builder/references/workflow.md"
  ];
  for (const relativePath of activeSurfaces) {
    const contents = fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");
    assert.match(contents, /0xprogrammable\/submit-launch/u, relativePath);
    assert.doesNotMatch(contents, /0xprogrammable\/programmable-registry:main/u, relativePath);
  }

  const metadata = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "config/plugin.json"), "utf8"));
  const openAi = fs.readFileSync(
    path.join(repositoryRoot, "skills/programmable-v4-hook-builder/agents/openai.yaml"),
    "utf8"
  );
  assert.match(metadata.description, /Submit a Launch/u);
  assert.match(metadata.longDescription, /0xprogrammable\/submit-launch/u);
  assert.match(metadata.defaultPrompt[0], /Submit a Launch/u);
  assert.match(openAi, /Submit a Launch/u);
});

test("MCP and both generated GitHub transports remain canonical and draft-only", () => {
  const applicationTools = toolDefinitions.filter(({ name }) => name.startsWith("programmable_application_"));
  for (const tool of applicationTools.filter(({ name }) => name !== "programmable_application_validate")) {
    assert.match(tool.description, /0xprogrammable\/submit-launch/u, tool.name);
  }

  const releasedTransport = fs.readFileSync(path.join(
    repositoryRoot,
    "skills/programmable-v4-hook-builder/scripts/github-application-transport-core.mjs"
  ), "utf8");
  assert.match(releasedTransport, /draft:\s*true/u);
  assert.match(releasedTransport, /maintainer_can_modify:\s*false/u);

  const candidateTransport = fs.readFileSync(path.join(
    repositoryRoot,
    "skills/programmable-v4-hook-builder/scripts/open-world-github-mutation-execution.mjs"
  ), "utf8");
  assert.match(candidateTransport, /draft:\s*true/u);
});
