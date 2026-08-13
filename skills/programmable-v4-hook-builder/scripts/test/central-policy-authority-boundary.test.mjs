import assert from "node:assert/strict";
import crypto from "node:crypto";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  OPEN_WORLD_V2_ARTIFACTS,
  OPEN_WORLD_V2_SUBMISSION_FILE,
  OPEN_WORLD_V2_SUPPORTING_ARTIFACTS,
  createLegacyFeeV2DraftPackage,
  createOpenWorldDraftPackage,
  validateLegacyFeeV2OpenWorldV2Package,
  validateOpenWorldV2Package
} from "../open-world-v2-core.mjs";
import {
  composeTemplate,
  loadTemplateCatalog,
  renderTemplateFiles
} from "../template-catalog-core.mjs";

const LEGACY_FEE_V2_DRAFT_AGGREGATE_SHA256 = "775b67bd6b1edb671544944b6150fb8fd347c259b459036814d779ce54a0f3d7";
const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function aggregatePackageFiles(files) {
  const preimage = [...files]
    .sort((left, right) => Buffer.from(left.path).compare(Buffer.from(right.path)))
    .map(({ path, byteLength, sha256 }) => `${path}\0${byteLength}\0${sha256.slice("sha256:".length)}`)
    .join("\n");
  return crypto.createHash("sha256").update(preimage).digest("hex");
}

test("current default build owns no local Programmable fee requirement", () => {
  const draft = createOpenWorldDraftPackage({
    applicationId: "central-policy-default",
    publicIdeaText: "Build a creative Uniswap v4 hook without inventing platform economics.",
    sourceRef: "central-policy-authority-test"
  });

  assert.equal(draft.materializationAllowed, true, JSON.stringify(draft.report));
  assert.equal(draft.report.findings.some(({ code }) => code.startsWith("PROGRAMMABLE_FEE_")), false);

  const filesByPath = new Map(draft.files.map((file) => [file.path, file]));
  const submission = JSON.parse(filesByPath.get("submission.v2.json").content);
  assert.equal(Object.hasOwn(submission, "programmableFee"), false);
  assert.equal(Object.hasOwn(submission.supportingPackage, "feePolicySchema"), false);
  assert.equal(Object.hasOwn(submission.supportingPackage, "feePolicy"), false);
  assert.equal(filesByPath.has("fee-policy-v2.schema.json"), false);
  assert.equal(filesByPath.has("fee-policy.v2.json"), false);

  const catalog = loadTemplateCatalog({ skillRoot });
  const plan = composeTemplate({ catalog, starterId: "ordinary-launch" });
  assert.equal(plan.selection.selectedPackIds.includes("programmable-volume-fee"), false);
  assert.equal(Object.hasOwn(plan, "feePolicy"), false);
  const rendered = new Map(renderTemplateFiles(plan, { catalog }));
  const codeLegos = JSON.parse(rendered.get("programmable-code-legos.json"));
  assert.equal(Object.hasOwn(codeLegos, "feePolicy"), false);
  assert.doesNotMatch([...rendered.values()].join("\n"), /10 bps|0\.1 percent|4957f49620AFf3Adbbe8195a4f633E49cc93376c/u);
});

test("explicit frozen Fee V2 replay remains byte-compatible and opt-in", () => {
  const legacy = createLegacyFeeV2DraftPackage({
    applicationId: "legacy-fee-v2-replay",
    publicIdeaText: "Preserve this exact frozen legacy Fee V2 draft.",
    sourceRef: "legacy-test-message"
  });
  assert.equal(legacy.materializationAllowed, true, JSON.stringify(legacy.report));
  assert.equal(aggregatePackageFiles(legacy.files), LEGACY_FEE_V2_DRAFT_AGGREGATE_SHA256);

  const files = new Map(legacy.files.map(({ path: filePath, content }) => [filePath, Buffer.from(content, "utf8")]));
  const submissionBytes = files.get(OPEN_WORLD_V2_SUBMISSION_FILE);
  const submission = JSON.parse(submissionBytes);
  const records = Object.fromEntries(Object.entries(OPEN_WORLD_V2_ARTIFACTS).map(([key, spec]) => [key, { value: JSON.parse(files.get(spec.file)), bytes: files.get(spec.file) }]));
  const supportingRecords = Object.fromEntries(["feePolicySchema", "securityAssessmentSchema", "securityAssessment"].map((key) => { const spec = OPEN_WORLD_V2_SUPPORTING_ARTIFACTS[key]; return [key, { value: JSON.parse(files.get(spec.file)), bytes: files.get(spec.file) }]; }));
  const currentReport = validateOpenWorldV2Package({ submission, submissionBytes, records, supportingRecords });
  assert.ok(currentReport.findings.some(({ code }) => code === "FROZEN_LEGACY_FEE_V2_ENTRYPOINT_REQUIRED"));
  assert.equal(validateLegacyFeeV2OpenWorldV2Package({ submission, submissionBytes, records, supportingRecords }).valid, true);

  const catalog = loadTemplateCatalog({ skillRoot });
  assert.throws(() => composeTemplate({ catalog, starterId: "blank-custom", packIds: ["programmable-volume-fee"] }), ({ code }) => code === "FROZEN_LEGACY_FEE_V2_PROFILE_REQUIRED");
});
