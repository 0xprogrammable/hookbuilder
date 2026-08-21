import fs from "node:fs";
import path from "node:path";

import { CliFailure, canonicalJson, sha256Canonical } from "./open-world-shared.mjs";
import {
  parseApplicationContractFromSnapshot,
  validateApplicationContractDocument
} from "./application-v3-contract-adapter.mjs";
import { SUBMIT_LAUNCH_REPOSITORY } from "./registry-intake-contract.mjs";
import { parseBoundedStrictJsonBytes } from "./strict-json-core.mjs";
import {
  assertCurrentSubmitLaunchContractCurrent,
  resolveCurrentSubmitLaunchContract
} from "./submit-launch-policy-github.mjs";

const MAX_APPLICANT_WORKSPACE_BYTES = 256 * 1024;
const MAX_CONTRACT_RECORD_BYTES = 512 * 1024;
const MAX_EVALUATION_CHAIN_LENGTH = 4096;
const WORKSPACE_FILE = "applicant-workspace.v1.json";
const CONTRACT_HISTORY_DIRECTORY = "submit-launch-contract";
const CONTRACT_EVALUATION_DIRECTORY = "evaluations";
const contractSnapshotByApplicationPackage = new WeakMap();

export function createSubmitLaunchTransportContractBinding({ isPlainObject }) {
  async function currentSubmitLaunchContractForApplication({ applicationPackage, transport }) {
    let resolution = contractSnapshotByApplicationPackage.get(applicationPackage);
    if (resolution === undefined) {
      resolution = Promise.resolve(loadPersistedSubmitLaunchContract(applicationPackage) ?? resolveCurrentSubmitLaunchContract({
        authenticatedTransport: transport,
        includeFullSnapshot: false,
        routeState: "unresolved",
        stage: "submit"
      }));
      contractSnapshotByApplicationPackage.set(applicationPackage, resolution);
    }
    let snapshot;
    try {
      snapshot = await resolution;
    } catch (error) {
      contractSnapshotByApplicationPackage.delete(applicationPackage);
      throw error;
    }
    const applicationContract = parseApplicationContractFromSnapshot(snapshot);
    const validation = validateApplicationContractDocument({
      application: applicationPackage.application,
      applicationContract
    });
    if (validation.valid !== true) {
      throw new CliFailure(
        validation.findings?.[0]?.code ?? "APPLICATION_CONTRACT_UNSUPPORTED",
        "the Application package does not satisfy the resolved current or supported legacy contract",
        { exitCode: 1 }
      );
    }
    await assertCurrentSubmitLaunchContractCurrent(snapshot.snapshotBinding, {
      authenticatedTransport: transport
    });
    return snapshot;
  }

  async function assertApplicationV3PlanSubmitLaunchContractCurrent({ applicationPackage, transport, plan }) {
    const contract = plan?.submitLaunchContract;
    const projectStage = contract?.projectStage;
    const { stageSha256, ...stageWithoutDigest } = projectStage ?? {};
    if (
      contract?.schemaVersion !== "programmable.submit-launch-plan-binding.v1"
      || contract.snapshotSha256 !== contract.snapshotBinding?.snapshotSha256
      || contract.stageSha256 !== stageSha256
      || projectStage?.schemaVersion !== "programmable.submit-launch-stage-plan.v1"
      || projectStage.stage !== "submit"
      || sha256Canonical(stageWithoutDigest) !== stageSha256
      || contract.snapshotBinding.repository !== SUBMIT_LAUNCH_REPOSITORY
      || contract.snapshotBinding.baseCommit !== plan?.target?.baseCommit
      || contract.snapshotBinding.baseTree !== plan?.target?.baseTree
    ) {
      throw new CliFailure("MUTATION_RECEIPT_BINDING_MISMATCH", "the receipt plan has no valid unified Submit Launch contract binding", { exitCode: 1 });
    }
    const snapshot = deepFreezeValue({
      schemaVersion: "programmable.submit-launch-contract-snapshot.v1",
      snapshotBinding: contract.snapshotBinding,
      currentness: {
        status: "CURRENT",
        refCheckedBefore: true,
        refCheckedAfter: true,
        retryCount: 0,
        cacheStatus: "PERSISTED_PLAN"
      },
      applicationContract: contract.applicationContract,
      projectStage,
      authority: {
        approvalGranted: false,
        launchAuthorized: false,
        promotionAuthorized: false,
        reviewAuthorized: false
      }
    });
    let applicationContract;
    let validation;
    try {
      applicationContract = parseApplicationContractFromSnapshot(snapshot);
      validation = validateApplicationContractDocument({
        application: applicationPackage.application,
        applicationContract
      });
    } catch (error) {
      throw new CliFailure(
        error?.code ?? "APPLICATION_CONTRACT_UNSUPPORTED",
        `the receipt plan does not bind a supported Application contract adapter (${error?.code ?? "unknown"})`,
        { exitCode: 1, cause: error }
      );
    }
    if (
      validation.valid !== true
      || canonicalJson(projectSubmitLaunchContractBinding(snapshot)) !== canonicalJson(contract)
      || canonicalJson(projectLegacyCentralContract(snapshot)) !== canonicalJson(plan.centralContract)
    ) {
      throw new CliFailure("MUTATION_RECEIPT_BINDING_MISMATCH", "the receipt plan disagrees with its unified Submit Launch contract projection", { exitCode: 1 });
    }
    return assertCurrentSubmitLaunchContractCurrent(contract.snapshotBinding, {
      authenticatedTransport: transport
    });
  }

  function loadPersistedSubmitLaunchContract(applicationPackage) {
    const workspace = path.dirname(applicationPackage.root);
    const statePath = path.join(workspace, WORKSPACE_FILE);
    if (!fs.existsSync(statePath)) return null;
    const state = readCanonicalJsonRecord(statePath, MAX_APPLICANT_WORKSPACE_BYTES, "Applicant workspace");
    const history = state.submitLaunch;
    if (
      state.schemaVersion !== "1.0.0"
      || state.kind !== "programmable-applicant-workspace"
      || state.paths?.applicationPackage !== applicationPackage.root
      || history?.schemaVersion !== "programmable.submit-launch-workspace-history.v1"
      || !/^sha256:[0-9a-f]{64}$/u.test(history.activeSnapshotSha256 ?? "")
      || !/^sha256:[0-9a-f]{64}$/u.test(history.activeSnapshotRecordSha256 ?? "")
      || !/^sha256:[0-9a-f]{64}$/u.test(history.activeStageSha256 ?? "")
      || !Array.isArray(history.snapshots)
      || !isPlainObject(history.evaluationHead)
      || !Number.isSafeInteger(history.evaluationHead.sequence)
      || history.evaluationHead.sequence < 1
    ) {
      throw new CliFailure("WORKSPACE_STATE_INVALID", "Applicant workspace has no valid active Submit Launch snapshot", { exitCode: 2 });
    }
    const snapshotMetadata = history.snapshots.find(({ recordSha256 }) => (
      recordSha256 === history.activeSnapshotRecordSha256
    ));
    const evaluationMetadata = history.evaluationHead;
    if (
      snapshotMetadata?.snapshotSha256 !== history.activeSnapshotSha256
      || evaluationMetadata.snapshotRecordSha256 !== history.activeSnapshotRecordSha256
      || evaluationMetadata.snapshotSha256 !== history.activeSnapshotSha256
      || evaluationMetadata.stageSha256 !== history.activeStageSha256
      || !/^sha256:[0-9a-f]{64}$/u.test(evaluationMetadata.evaluationSha256 ?? "")
    ) {
      throw new CliFailure("WORKSPACE_EVALUATION_HISTORY_INVALID", "Applicant workspace Submit Launch heads disagree", { exitCode: 2 });
    }
    assertContractRecordPath({
      workspace,
      recordPath: snapshotMetadata.path,
      directory: "snapshots",
      digest: snapshotMetadata.recordSha256
    });
    assertContractRecordPath({
      workspace,
      recordPath: evaluationMetadata.path,
      directory: "evaluations",
      digest: evaluationMetadata.evaluationSha256
    });
    const snapshotRecord = readCanonicalJsonRecord(snapshotMetadata.path, MAX_CONTRACT_RECORD_BYTES, "Submit Launch snapshot");
    const evaluation = readEvaluationChain({ workspace, head: evaluationMetadata });
    const { recordSha256, ...snapshotWithoutDigest } = snapshotRecord;
    const { evaluationSha256, ...evaluationWithoutDigest } = evaluation;
    const { stageSha256, ...stageWithoutDigest } = evaluation.projectStage ?? {};
    if (
      snapshotRecord.schemaVersion !== "programmable.submit-launch-workspace-snapshot.v1"
      || sha256Canonical(snapshotWithoutDigest) !== recordSha256
      || recordSha256 !== snapshotMetadata.recordSha256
      || snapshotRecord.snapshotSha256 !== history.activeSnapshotSha256
      || evaluation.schemaVersion !== "programmable.submit-launch-evaluation-receipt.v1"
      || sha256Canonical(evaluationWithoutDigest) !== evaluationSha256
      || evaluationSha256 !== evaluationMetadata.evaluationSha256
      || evaluation.snapshotRecordSha256 !== recordSha256
      || evaluation.snapshotSha256 !== snapshotRecord.snapshotSha256
      || evaluation.stageSha256 !== history.activeStageSha256
      || stageSha256 !== evaluation.stageSha256
      || sha256Canonical(stageWithoutDigest) !== stageSha256
      || evaluation.projectStage?.stage !== "submit"
      || evaluation.currentness?.status !== "CURRENT"
    ) {
      throw new CliFailure("WORKSPACE_EVALUATION_HISTORY_INVALID", "Submit Launch content-addressed records are inconsistent", { exitCode: 2 });
    }
    return deepFreezeValue({
      schemaVersion: snapshotRecord.contractSchemaVersion,
      snapshotBinding: snapshotRecord.snapshotBinding,
      currentness: evaluation.currentness,
      applicationContract: snapshotRecord.applicationContract,
      projectStage: evaluation.projectStage,
      authority: snapshotRecord.authority
    });
  }

  function readEvaluationChain({ workspace, head }) {
    const seen = new Set();
    let expectedDigest = head.evaluationSha256;
    let expectedSequence = head.sequence;
    let latest = null;
    for (let length = 0; expectedDigest !== null; length += 1) {
      if (length >= MAX_EVALUATION_CHAIN_LENGTH) {
        throw new CliFailure("WORKSPACE_EVALUATION_HISTORY_INVALID", "Submit Launch evaluation history exceeds its bounded chain length", { exitCode: 2 });
      }
      if (!/^sha256:[0-9a-f]{64}$/u.test(expectedDigest) || seen.has(expectedDigest)) {
        throw new CliFailure("WORKSPACE_EVALUATION_HISTORY_INVALID", "Submit Launch evaluation history contains an invalid or cyclic digest", { exitCode: 2 });
      }
      seen.add(expectedDigest);
      const recordPath = path.join(
        workspace,
        CONTRACT_HISTORY_DIRECTORY,
        CONTRACT_EVALUATION_DIRECTORY,
        `${expectedDigest.slice("sha256:".length)}.json`
      );
      if (length === 0 && recordPath !== head.path) {
        throw new CliFailure("WORKSPACE_EVALUATION_HISTORY_INVALID", "Submit Launch evaluation head path disagrees with its digest", { exitCode: 2 });
      }
      const receipt = readCanonicalJsonRecord(recordPath, MAX_CONTRACT_RECORD_BYTES, "Submit Launch evaluation");
      const { evaluationSha256, ...withoutDigest } = receipt;
      if (
        receipt.schemaVersion !== "programmable.submit-launch-evaluation-receipt.v1"
        || receipt.sequence !== expectedSequence
        || evaluationSha256 !== expectedDigest
        || sha256Canonical(withoutDigest) !== evaluationSha256
      ) {
        throw new CliFailure("WORKSPACE_EVALUATION_HISTORY_INVALID", "Submit Launch evaluation receipt breaks the append-only hash chain", { exitCode: 2 });
      }
      latest ??= receipt;
      if (receipt.sequence === 1) {
        if (receipt.previousEvaluationSha256 !== null) {
          throw new CliFailure("WORKSPACE_EVALUATION_HISTORY_INVALID", "Submit Launch evaluation genesis receipt has a predecessor", { exitCode: 2 });
        }
        expectedDigest = null;
        expectedSequence = 0;
      } else {
        if (!/^sha256:[0-9a-f]{64}$/u.test(receipt.previousEvaluationSha256 ?? "")) {
          throw new CliFailure("WORKSPACE_EVALUATION_HISTORY_INVALID", "Submit Launch evaluation predecessor digest is invalid", { exitCode: 2 });
        }
        expectedDigest = receipt.previousEvaluationSha256;
        expectedSequence = receipt.sequence - 1;
      }
    }
    if (latest === null || expectedSequence !== 0) {
      throw new CliFailure("WORKSPACE_EVALUATION_HISTORY_INVALID", "Submit Launch evaluation history is incomplete", { exitCode: 2 });
    }
    return latest;
  }

  function readCanonicalJsonRecord(recordPath, maximumBytes, label) {
    const stat = fs.lstatSync(recordPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > maximumBytes) {
      throw new CliFailure("WORKSPACE_STATE_INVALID", `${label} must be one bounded regular file`, { exitCode: 2 });
    }
    const bytes = fs.readFileSync(recordPath);
    let value;
    try {
      value = parseBoundedStrictJsonBytes(bytes, { maxSourceBytes: maximumBytes, maxDepth: 256, maxNodes: 250_000 });
    } catch {
      throw new CliFailure("WORKSPACE_STATE_INVALID", `${label} must be duplicate-free UTF-8 JSON`, { exitCode: 2 });
    }
    if (bytes.toString("utf8") !== `${canonicalJson(value)}\n`) {
      throw new CliFailure("WORKSPACE_STATE_INVALID", `${label} must be canonical JSON`, { exitCode: 2 });
    }
    return value;
  }

  function assertContractRecordPath({ workspace, recordPath, directory, digest }) {
    const expected = path.join(
      workspace,
      CONTRACT_HISTORY_DIRECTORY,
      directory,
      `${digest.slice("sha256:".length)}.json`
    );
    if (recordPath !== expected) {
      throw new CliFailure("WORKSPACE_STATE_INVALID", "Submit Launch record path is not content-addressed below the Applicant workspace", { exitCode: 2 });
    }
  }

  function projectSubmitLaunchContractBinding(snapshot) {
    return Object.freeze({
      schemaVersion: "programmable.submit-launch-plan-binding.v1",
      snapshotSha256: snapshot.snapshotBinding.snapshotSha256,
      stageSha256: snapshot.projectStage.stageSha256,
      snapshotBinding: snapshot.snapshotBinding,
      applicationContract: snapshot.applicationContract,
      projectStage: snapshot.projectStage
    });
  }

  function projectLegacyCentralContract(snapshot) {
    const binding = snapshot.snapshotBinding;
    const application = snapshot.applicationContract.current;
    const policy = binding.policy;
    return Object.freeze({
      activeContractManifestPath: binding.activeContractV1.path,
      activeContractManifestGitBlobOid: binding.activeContractV1.gitBlobOid,
      activeContractManifestSha256: binding.activeContractV1.sha256,
      contractId: "submit-launch",
      schemaPath: application.path,
      schemaGitBlobOid: application.gitBlobOid ?? null,
      schemaSha256: application.sha256,
      policy: Object.freeze({
        path: policy.path,
        schemaPath: binding.policySchema.path,
        policyId: policy.policyId,
        policyVersion: policy.policyVersion,
        policyBinding: policy,
        buildPolicyBinding: Object.freeze({ ...policy, profileId: "build" }),
        policySchemaBinding: binding.policySchema,
        activeBuildRuleIds: snapshot.projectStage.requirementIds,
        activeProductionRuleIds: [],
        buildProfileEnabled: snapshot.projectStage.profileEnabled,
        productionProfileEnabled: false
      })
    });
  }

  return Object.freeze({
    currentSubmitLaunchContractForApplication,
    assertApplicationV3PlanSubmitLaunchContractCurrent,
    projectSubmitLaunchContractBinding,
    projectLegacyCentralContract
  });
}

function deepFreezeValue(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const entry of Object.values(value)) deepFreezeValue(entry);
  return Object.freeze(value);
}
