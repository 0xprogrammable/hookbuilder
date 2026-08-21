import crypto from "node:crypto";

import { CliFailure } from "./cli-runtime.mjs";
import { canonicalJson } from "./submission-core.mjs";

export const SUBMIT_PROJECT_SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;
export const SUBMIT_PROJECT_TRUSTED_TARGET = Object.freeze({
  repository: "0xprogrammable/submit-launch",
  repositoryId: "1320171831",
  base: "main",
  draft: true
});

const CONTRACT_SNAPSHOT_SCHEMA = "programmable.submit-launch-contract-snapshot.v1";
const WORKSPACE_SNAPSHOT_SCHEMA = "programmable.submit-launch-workspace-snapshot.v1";
const EVALUATION_RECEIPT_SCHEMA = "programmable.submit-launch-evaluation-receipt.v1";

export async function resolveJourneyContract(input, adapters) {
  try {
    const value = await adapters.resolveCurrentContract({
      repositoryRoot: input.repositoryRoot,
      workspaceRoot: input.workspaceRoot,
      target: SUBMIT_PROJECT_TRUSTED_TARGET,
      stage: "submit",
      routeState: input.routeState ?? "unresolved",
      includeFullSnapshot: false
    });
    if (value?.ok === false) return value;
    const binding = value?.ok === true && value.binding !== undefined ? value.binding : value;
    if (!validContractSnapshot(binding)) {
      return {
        ok: false,
        code: "SUBMIT_LAUNCH_CONTRACT_UNSUPPORTED",
        diagnostics: [diagnostic(
          "SUBMIT_LAUNCH_CONTRACT_UNSUPPORTED",
          "INTEGRATION",
          "The protected Submit Launch resolver returned an unsupported snapshot.",
          "Update the Builder adapter and resolve the exact protected contract again.",
          resumeCommand(input)
        )]
      };
    }
    return { ok: true, binding };
  } catch (error) {
    const code = typeof error?.code === "string" ? error.code : "POLICY_UNRESOLVED";
    return {
      ok: false,
      code,
      diagnostics: [diagnostic(
        code,
        "INTEGRATION",
        code === "SUBMIT_LAUNCH_CONTRACT_DRIFT"
          ? "The protected Submit Launch head changed during resolution."
          : "The exact current Submit Launch contract could not be resolved.",
        "Retry the same command after the protected contract is stable and reachable.",
        resumeCommand(input)
      )]
    };
  }
}

export function trustedTargetFromContract(contract) {
  const binding = contract?.snapshotBinding;
  if (
    binding?.repository !== SUBMIT_PROJECT_TRUSTED_TARGET.repository
    || binding?.numericRepositoryId !== SUBMIT_PROJECT_TRUSTED_TARGET.repositoryId
    || binding?.branch !== SUBMIT_PROJECT_TRUSTED_TARGET.base
  ) {
    return SUBMIT_PROJECT_TRUSTED_TARGET;
  }
  return SUBMIT_PROJECT_TRUSTED_TARGET;
}

export function bindApplicationToContract(applicationPackage, contract) {
  return {
    ...(applicationPackage ?? {}),
    submitLaunchContract: {
      snapshotSha256: contract.snapshotBinding.snapshotSha256,
      stageSha256: contract.projectStage.stageSha256,
      applicationContract: contract.applicationContract,
      projectStage: contract.projectStage
    }
  };
}

export function planBindsContract(plan, contract) {
  return plan?.submitLaunchContract?.snapshotSha256 === contract.snapshotBinding.snapshotSha256
    && plan?.submitLaunchContract?.stageSha256 === contract.projectStage.stageSha256;
}

export function appendContractEvaluation(previous, contract, { event, status, code }) {
  const snapshots = Array.isArray(previous?.snapshots) ? previous.snapshots.map((record) => structuredClone(record)) : [];
  const evaluations = Array.isArray(previous?.evaluations) ? previous.evaluations.map((receipt) => structuredClone(receipt)) : [];
  verifyEvaluationHistory(evaluations);
  const snapshotWithoutRecordDigest = {
    schemaVersion: WORKSPACE_SNAPSHOT_SCHEMA,
    snapshotSha256: contract.snapshotBinding.snapshotSha256,
    stageSha256: contract.projectStage.stageSha256,
    snapshotBinding: contract.snapshotBinding,
    currentness: contract.currentness,
    applicationContract: contract.applicationContract
  };
  const snapshotRecord = {
    ...snapshotWithoutRecordDigest,
    recordSha256: canonicalDigest(snapshotWithoutRecordDigest)
  };
  const priorSnapshot = snapshots.find(({ snapshotSha256 }) => snapshotSha256 === snapshotRecord.snapshotSha256);
  if (priorSnapshot === undefined) {
    snapshots.push(snapshotRecord);
  } else if (canonicalJson(priorSnapshot) !== canonicalJson(snapshotRecord)) {
    throw new CliFailure("WORKSPACE_SNAPSHOT_COLLISION", "a protected snapshot digest resolved to different persisted bytes", { exitCode: 2 });
  }
  const previousEvaluationSha256 = evaluations.at(-1)?.evaluationSha256 ?? null;
  const receiptWithoutDigest = {
    schemaVersion: EVALUATION_RECEIPT_SCHEMA,
    sequence: evaluations.length + 1,
    previousEvaluationSha256,
    event,
    status,
    code,
    snapshotSha256: contract.snapshotBinding.snapshotSha256,
    snapshotRecordSha256: snapshotRecord.recordSha256,
    stageSha256: contract.projectStage.stageSha256,
    stage: contract.projectStage.stage,
    routeState: contract.projectStage.routeState,
    projectStage: contract.projectStage
  };
  evaluations.push({
    ...receiptWithoutDigest,
    evaluationSha256: canonicalDigest(receiptWithoutDigest)
  });
  return {
    schemaVersion: "programmable.submit-launch-workspace-history.v1",
    activeSnapshotSha256: contract.snapshotBinding.snapshotSha256,
    activeSnapshotRecordSha256: snapshotRecord.recordSha256,
    activeStageSha256: contract.projectStage.stageSha256,
    snapshots,
    evaluations
  };
}

function validContractSnapshot(value) {
  return value?.schemaVersion === CONTRACT_SNAPSHOT_SCHEMA
    && value?.snapshotBinding?.repository === SUBMIT_PROJECT_TRUSTED_TARGET.repository
    && value?.snapshotBinding?.numericRepositoryId === SUBMIT_PROJECT_TRUSTED_TARGET.repositoryId
    && value?.snapshotBinding?.branch === SUBMIT_PROJECT_TRUSTED_TARGET.base
    && /^[0-9a-f]{40}$/u.test(value?.snapshotBinding?.baseCommit ?? "")
    && /^[0-9a-f]{40}$/u.test(value?.snapshotBinding?.baseTree ?? "")
    && SUBMIT_PROJECT_SHA256_PATTERN.test(value?.snapshotBinding?.snapshotSha256 ?? "")
    && value?.currentness?.status === "CURRENT"
    && value?.applicationContract !== null
    && typeof value?.applicationContract === "object"
    && value?.projectStage?.schemaVersion === "programmable.submit-launch-stage-plan.v1"
    && value?.projectStage?.stage === "submit"
    && SUBMIT_PROJECT_SHA256_PATTERN.test(value?.projectStage?.stageSha256 ?? "");
}

function verifyEvaluationHistory(evaluations) {
  let previous = null;
  for (const [index, receipt] of evaluations.entries()) {
    const { evaluationSha256, ...withoutDigest } = receipt ?? {};
    if (
      receipt?.schemaVersion !== EVALUATION_RECEIPT_SCHEMA
      || receipt.sequence !== index + 1
      || receipt.previousEvaluationSha256 !== previous
      || !SUBMIT_PROJECT_SHA256_PATTERN.test(evaluationSha256 ?? "")
      || canonicalDigest(withoutDigest) !== evaluationSha256
    ) {
      throw new CliFailure("WORKSPACE_EVALUATION_HISTORY_INVALID", "Applicant evaluation receipts are not one immutable append-only hash chain", { exitCode: 2 });
    }
    previous = evaluationSha256;
  }
}

function canonicalDigest(value) {
  return `sha256:${crypto.createHash("sha256").update(Buffer.from(canonicalJson(value), "utf8")).digest("hex")}`;
}

function diagnostic(code, causeClass, summary, repair, safeNextCommand, writePerformed = false) {
  return { code, causeClass, summary, repair, safeNextCommand, writePerformed };
}

function resumeCommand(input) {
  return `node cli.mjs submit-project ${shellQuote(input.repositoryRoot)} --workspace-root ${shellQuote(input.workspaceRoot)} --resume`;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}
