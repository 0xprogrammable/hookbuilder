import { canonicalJson, sha256Bytes } from "./open-world-v2-core.mjs";
import { derivePublicPrApplicationV3PreviousBinding } from "./public-pr-application-v3-core.mjs";
import {
  assertApplicationAdapterSelection,
  validateApplicationContractDocument
} from "./application-v3-contract-adapter.mjs";

const SHA256_PATTERN = /^sha256:(?!0{64}$)[0-9a-f]{64}$/u;
const POSITIVE_DECIMAL_PATTERN = /^[1-9][0-9]*$/u;
const GIT_OBJECT_PATTERN = /^[0-9a-f]{40}$/u;
const APPLICATION_V3_VERSIONS = new Set(["3.1.0", "3.2.0"]);

export function requireCurrentApplicationRevisionSelection(value, {
  requestedRoute,
  priorVersion = undefined,
  fail
} = {}) {
  try {
    const selection = assertApplicationAdapterSelection(value);
    if (
      selection.application?.version !== "3.2.0"
      || selection.requestedRoute !== requestedRoute
      || selection.transition?.toVersion !== "3.2.0"
    ) throw new Error("unsupported selection");
    if (priorVersion !== undefined) {
      const expected = priorVersion === null
        ? { kind: "new", fromVersion: null, appendOnlyRevision: false }
        : priorVersion === "3.1.0"
          ? { kind: "schema-migration", fromVersion: "3.1.0", appendOnlyRevision: true }
          : { kind: "revision", fromVersion: "3.2.0", appendOnlyRevision: true };
      if (
        selection.transition.kind !== expected.kind
        || selection.transition.fromVersion !== expected.fromVersion
        || selection.transition.appendOnlyRevision !== expected.appendOnlyRevision
      ) throw new Error("selection transition mismatch");
    }
  } catch {
    fail(
      "PREPARE_REVISION_CURRENT_CONTRACT_ADAPTER_REQUIRED",
      "Application V3.2 revision preparation requires one exact manifest-bound current adapter selection"
    );
  }
}

export function deriveApplicationV3RevisionFromV3({
  applicationDraft,
  predecessor,
  applicationSelection,
  sourceBindingFields,
  parseCanonicalPredecessorBytes,
  requirePullRequestNumber,
  incrementCanonicalDecimal,
  cloneCanonical,
  failPredecessorInvalid,
  fail
}) {
  const registryKeys = ["kind", "location", "applicationBytes", "packageSha256"];
  const draftKeys = [...registryKeys, "pullRequestNumber"];
  if (
    !["registry-base", "open-draft"].includes(predecessor.location)
    || !SHA256_PATTERN.test(predecessor.packageSha256 ?? "")
    || (predecessor.location === "registry-base" && !hasOnlyKeys(predecessor, registryKeys))
    || (predecessor.location === "open-draft" && !hasOnlyKeys(predecessor, draftKeys))
  ) {
    failPredecessorInvalid();
  }
  const pullRequestNumber = predecessor.location === "open-draft"
    ? requirePullRequestNumber(predecessor.pullRequestNumber)
    : null;
  const previousApplication = parseCanonicalPredecessorBytes(predecessor.applicationBytes);
  const previousVersion = previousApplication?.contract?.version;
  const targetVersion = applicationDraft?.contract?.version;
  if (
    previousApplication?.contract?.id !== "public-pr-application-v3"
    || !APPLICATION_V3_VERSIONS.has(previousVersion)
    || !APPLICATION_V3_VERSIONS.has(targetVersion)
    || previousApplication?.schemaVersion !== 3
    || previousApplication.applicationId !== applicationDraft.applicationId
    || previousApplication?.builder?.githubUserId !== applicationDraft?.builder?.githubUserId
  ) {
    fail(
      "PREPARE_REVISION_PREDECESSOR_IDENTITY_MISMATCH",
      "the predecessor does not match the target application identity"
    );
  }
  if (previousVersion === "3.2.0" && targetVersion === "3.1.0") {
    fail(
      "PREPARE_REVISION_CONTRACT_DOWNGRADE_FORBIDDEN",
      "Application V3.2 cannot be rewritten through the legacy V3.1 contract"
    );
  }
  if (targetVersion === "3.2.0") {
    requireCurrentApplicationRevisionSelection(applicationSelection, {
      requestedRoute: applicationDraft.launchRequest?.requestedRoute,
      priorVersion: previousVersion,
      fail
    });
  }
  const predecessorValidation = validateApplicationContractDocument({
    application: previousApplication,
    ...(previousVersion === "3.2.0" ? { applicationSelection } : {})
  });
  if (predecessorValidation?.valid !== true) failPredecessorInvalid();
  const applicationSha256 = sha256Bytes(predecessor.applicationBytes);
  let previousBinding;
  try {
    previousBinding = deriveV3PreviousBinding({
      application: previousApplication,
      applicationSha256,
      packageSha256: predecessor.packageSha256,
      targetVersion
    });
  } catch {
    failPredecessorInvalid();
  }
  requireV3PreviousBinding(previousBinding, { targetVersion, failPredecessorInvalid });

  const comparablePrevious = cloneCanonical(previousApplication);
  delete comparablePrevious.applicationRevision;
  delete comparablePrevious.lineage;
  if (canonicalJson(comparablePrevious) === canonicalJson(applicationDraft)) {
    fail(
      "PREPARE_REVISION_NO_CHANGES",
      "the requested revision has no semantic changes"
    );
  }
  const schemaMigration = previousVersion === "3.1.0" && targetVersion === "3.2.0";
  const sourceChanged = canonicalJson(sourceBindingProjection(previousApplication.source, {
    sourceBindingFields,
    cloneCanonical,
    fail
  })) !== canonicalJson(sourceBindingProjection(applicationDraft.source, {
    sourceBindingFields,
    cloneCanonical,
    fail
  }));
  if (
    schemaMigration
    && (sourceChanged
      || canonicalJson(schemaMigrationInvariantProjection(previousApplication, cloneCanonical))
        !== canonicalJson(schemaMigrationInvariantProjection(applicationDraft, cloneCanonical)))
  ) {
    fail(
      "PREPARE_REVISION_SCHEMA_MIGRATION_SCOPE_EXCEEDED",
      "Application V3.1 to V3.2 migration may only apply the closed contract, route, policy-neutrality, submission, and review-package transition"
    );
  }
  if (
    !schemaMigration
    && !sourceChanged
    && canonicalJson(normativeProjection(previousApplication, cloneCanonical))
      !== canonicalJson(normativeProjection(applicationDraft, cloneCanonical))
  ) {
    fail(
      "PREPARE_REVISION_NORMATIVE_CHANGE_REQUIRES_SOURCE_UPDATE",
      "same-source revisions may change only derived review and security evidence"
    );
  }
  const applicationRevision = incrementCanonicalDecimal(previousApplication.applicationRevision);
  const lineage = {
    kind: schemaMigration ? "schema-migration" : sourceChanged ? "source-update" : "recheck",
    previous: cloneCanonical(previousBinding)
  };
  return {
    applicationRevision,
    lineage,
    mode: schemaMigration
      ? "contract-schema-migration"
      : predecessor.location === "open-draft"
        ? "open-draft-update"
        : "merged-registry-successor",
    predecessor: {
      applicationContract: previousBinding.applicationContract,
      ...(targetVersion === "3.2.0" ? { applicationContractVersion: previousVersion } : {}),
      applicationRevision: previousBinding.applicationRevision,
      applicationSha256,
      packageSha256: predecessor.packageSha256,
      location: predecessor.location
    },
    sourceChanged,
    target: {
      githubNextAction: predecessor.location === "open-draft" ? "update" : "submit",
      pullRequestNumber
    }
  };
}

function sourceBindingProjection(source, { sourceBindingFields, cloneCanonical, fail }) {
  if (!isPlainObject(source) || !isPlainObject(source.primary) || !Array.isArray(source.companions)) {
    fail(
      "PREPARE_REVISION_DRAFT_INVALID",
      "the application draft does not satisfy the Application V3 preparation boundary"
    );
  }
  return {
    schemaVersion: source.schemaVersion,
    primary: sourceRepositoryBindingProjection(source.primary, { sourceBindingFields, cloneCanonical, fail }),
    companions: source.companions.map((repository) => sourceRepositoryBindingProjection(repository, {
      sourceBindingFields,
      cloneCanonical,
      fail
    }))
  };
}

function sourceRepositoryBindingProjection(repository, { sourceBindingFields, cloneCanonical, fail }) {
  if (!isPlainObject(repository)) {
    fail(
      "PREPARE_REVISION_DRAFT_INVALID",
      "the application draft does not satisfy the Application V3 preparation boundary"
    );
  }
  const projection = {};
  for (const field of sourceBindingFields) {
    if (!Object.hasOwn(repository, field)) {
      fail(
        "PREPARE_REVISION_DRAFT_INVALID",
        "the application draft does not satisfy the Application V3 preparation boundary"
      );
    }
    projection[field] = cloneCanonical(repository[field]);
  }
  return projection;
}

function normativeProjection(application, cloneCanonical) {
  const projection = cloneCanonical(application);
  delete projection.applicationRevision;
  delete projection.lineage;
  delete projection.fidelity;
  delete projection.securityBindings;
  delete projection.reviewPackage;
  if (isPlainObject(projection.source)) {
    delete projection.source.verificationReports;
    for (const repository of [projection.source.primary, ...(projection.source.companions ?? [])]) {
      if (isPlainObject(repository)) delete repository.githubActionsRunIds;
    }
  }
  return projection;
}

function schemaMigrationInvariantProjection(application, cloneCanonical) {
  const projection = normativeProjection(application, cloneCanonical);
  delete projection.contract;
  delete projection.launchRequest;
  if (isPlainObject(projection.policyBindings)) {
    for (const field of [
      "feePolicySchemaId",
      "programmableFeePolicyId",
      "programmableFeePolicyVersion",
      "programmableFeePolicyHashPreimage",
      "programmableFeePolicyHash",
      "feeApplicability",
      "feePolicySchemaPath",
      "feePolicySchemaRepositoryRef",
      "feePolicySchemaSha256",
      "feePolicyInstancePath",
      "feePolicyInstanceRepositoryRef",
      "feePolicyInstanceSha256",
      "submissionSha256"
    ]) delete projection.policyBindings[field];
  }
  return projection;
}

function deriveV3PreviousBinding({ application, applicationSha256, packageSha256, targetVersion }) {
  let binding;
  if (application.contract.version === "3.1.0") {
    binding = derivePublicPrApplicationV3PreviousBinding({
      application,
      applicationSha256,
      packageSha256
    });
  } else {
    const source = application.source.primary;
    const policy = application.policyBindings;
    binding = {
      applicationContract: application.contract.id,
      applicationSchemaVersion: application.schemaVersion,
      applicationRevision: application.applicationRevision,
      applicationSha256,
      packageSha256,
      sourceNumericRepositoryId: source.numericRepositoryId,
      sourceCommit: source.revisionObjectId,
      sourceTree: source.treeObjectId,
      submissionSchemaId: `urn:programmable:v4-hook-submission:${application.contract.submissionStandard}`,
      submissionStandard: application.contract.submissionStandard,
      submissionPath: policy.submissionPath,
      submissionSha256: policy.submissionSha256,
      feePolicyId: policy.programmableFeePolicyId,
      feePolicyVersion: policy.programmableFeePolicyVersion,
      feeApplicability: policy.feeApplicability,
      feePolicyInstanceSha256: policy.feePolicyInstanceSha256
    };
  }
  return targetVersion === "3.2.0"
    ? { ...binding, applicationContractVersion: application.contract.version }
    : binding;
}

function requireV3PreviousBinding(binding, { targetVersion, failPredecessorInvalid }) {
  if (
    !isPlainObject(binding)
    || binding.applicationContract !== "public-pr-application-v3"
    || binding.applicationSchemaVersion !== 3
    || (targetVersion === "3.2.0"
      ? !APPLICATION_V3_VERSIONS.has(binding.applicationContractVersion)
      : Object.hasOwn(binding, "applicationContractVersion"))
    || !POSITIVE_DECIMAL_PATTERN.test(binding.applicationRevision ?? "")
    || !SHA256_PATTERN.test(binding.applicationSha256 ?? "")
    || !SHA256_PATTERN.test(binding.packageSha256 ?? "")
    || !/^[1-9][0-9]{0,63}$/u.test(binding.sourceNumericRepositoryId ?? "")
    || !GIT_OBJECT_PATTERN.test(binding.sourceCommit ?? "")
    || !GIT_OBJECT_PATTERN.test(binding.sourceTree ?? "")
    || typeof binding.submissionSchemaId !== "string"
    || typeof binding.submissionStandard !== "string"
    || typeof binding.submissionPath !== "string"
    || binding.submissionPath.length === 0
    || !SHA256_PATTERN.test(binding.submissionSha256 ?? "")
    || !new Set(["unresolved", "applicable", "not-applicable", "not-selected"]).has(binding.feeApplicability)
    || (binding.feeApplicability === "not-selected"
      ? binding.feePolicyId !== null || binding.feePolicyVersion !== null
      : typeof binding.feePolicyId !== "string" || typeof binding.feePolicyVersion !== "string")
    || !(binding.feePolicyInstanceSha256 === null || SHA256_PATTERN.test(binding.feePolicyInstanceSha256 ?? ""))
    || (binding.feeApplicability === "not-selected" && binding.feePolicyInstanceSha256 !== null)
  ) {
    failPredecessorInvalid();
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(value, allowedKeys) {
  const allowed = new Set(allowedKeys);
  const keys = Object.keys(value);
  return keys.length === allowed.size && keys.every((key) => allowed.has(key));
}
