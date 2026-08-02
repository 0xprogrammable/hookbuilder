import crypto from "node:crypto";
import { canonicalJson } from "./submission-core.mjs";

export const BUILDER_LIFECYCLE_SCHEMA_VERSION = "1.0.0";
export const NORMAL_RELEASE_WINDOW_MS = 24 * 60 * 60 * 1_000;

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const SEMVER_PATTERN = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u;
const DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)$/u;
const FULL_GIT_OBJECT_PATTERN = /^[0-9a-f]{40}$/u;
const RELEASE_CHANNELS = new Set(["stable", "canary"]);
const RELEASE_CHANGE_KINDS = new Set([
  "breaking-change",
  "bug-fix",
  "documentation",
  "feature",
  "maintenance",
  "security-advisory",
  "security-fix"
]);
const SECURITY_CHANGE_KINDS = new Set(["security-advisory", "security-fix"]);
const HOTFIX_SEVERITIES = new Set(["low", "medium", "high", "critical"]);
const SEMANTIC_CLASSIFICATIONS = new Set(["major", "minor", "patch"]);
const TEST_ONLY_PIN_PREFIX = "TEST-ONLY-";
const TEST_ONLY_KEY_IDS = new Set([
  "56475aa75463474c0285df5dbf2bcab73da651358839e9b77481b2eab107708c"
]);
const EXTERNAL_W5_REQUIREMENTS = Object.freeze([
  Object.freeze({
    id: "w5-candidate-bytes-and-visibility",
    statement: "Independently bind the exact candidate, source commit/tree/tag, artifact, and release-manifest bytes and verify repository visibility and publication state."
  }),
  Object.freeze({
    id: "w5-release-history-and-time",
    statement: "Authenticate complete public release history and obtain trusted time before deciding cadence."
  }),
  Object.freeze({
    id: "w5-artifact-bytes-and-digests",
    statement: "Read every referenced package, evidence, and communication artifact and verify its content digest."
  }),
  Object.freeze({
    id: "w5-owner-authority",
    statement: "Authenticate owner identity, release authority, candidate-intent approval, and any security-hotfix exception."
  }),
  Object.freeze({
    id: "w5-independent-release-review",
    statement: "Complete independent W5 reproducibility, review, canary, and exact external-action authorization gates."
  })
]);
const PROTECTED_MIGRATION_SEGMENTS = Object.freeze({
  economics: new Set(["economics", "economic", "fee", "fees", "programmablefee", "rate", "rates", "tax", "taxes"]),
  wallet: new Set(["wallet", "wallets", "recipient", "recipients", "beneficiary", "beneficiaries", "owner", "owners"]),
  authority: new Set(["authority", "authorities", "role", "roles", "permission", "permissions", "admin", "admins"]),
  risk: new Set(["risk", "risks", "risktier", "riskdimensions", "threat", "threats"]),
  evidence: new Set(["evidence", "evidences", "receipt", "receipts", "proof", "proofs", "finding", "findings"])
});

export class BuilderLifecycleError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "BuilderLifecycleError";
    this.code = code;
    this.details = details;
  }
}

export function digestCanonical(value) {
  return `sha256:${crypto.createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}

export function releaseIntentDigest(candidate) {
  assertPlainObject(candidate, "release candidate");
  return digestCanonical({
    schemaVersion: BUILDER_LIFECYCLE_SCHEMA_VERSION,
    candidateId: candidate.candidateId,
    privateCandidate: candidate.privateCandidate,
    publicState: candidate.publicState,
    releaseVersion: candidate.releaseVersion,
    channel: candidate.channel,
    releaseKind: candidate.releaseKind,
    plannedRelease: cloneJson(candidate.plannedRelease),
    preparedAt: candidate.preparedAt,
    requestedReleaseAt: candidate.requestedReleaseAt,
    changeSetComplete: candidate.changeSetComplete,
    changes: cloneJson(candidate.changes),
    unbundledChangeIds: cloneJson(candidate.unbundledChangeIds),
    evidence: cloneJson(candidate.evidence),
    communications: cloneJson(candidate.communications),
    securityHotfix: {
      severity: candidate.securityHotfix?.severity ?? null,
      affectedVersions: cloneJson(candidate.securityHotfix?.affectedVersions ?? []),
      reasonCode: candidate.securityHotfix?.reasonCode ?? null,
      incidentRecordSha256: candidate.securityHotfix?.incidentRecordSha256 ?? null
    }
  });
}

export function versionStatus(state) {
  validateInstalledState(state);
  return {
    kind: "builder-version-status",
    schemaVersion: BUILDER_LIFECYCLE_SCHEMA_VERSION,
    installed: {
      channel: state.channel,
      releaseSequence: state.releaseSequence,
      releaseVersion: state.releaseVersion,
      standards: cloneJson(state.standards)
    },
    trust: {
      keyId: state.trustedKeyId,
      pinSha256: state.trustedPinSha256
    },
    historicalStandardsPreserved: true,
    networkAccessed: false,
    externalActionsPerformed: []
  };
}

export function checkSignedUpdate({ state, signedUpdate, trustedPin, now }) {
  validateInstalledState(state);
  const verified = verifySignedUpdate({ state, signedUpdate, trustedPin, now });
  const currentVersion = parseSemver(state.releaseVersion, "state.releaseVersion");
  const targetVersion = parseSemver(verified.payload.releaseVersion, "update.payload.releaseVersion");
  const versionOrder = compareSemver(targetVersion, currentVersion);
  const sequenceOrder = compareDecimal(verified.payload.releaseSequence, state.releaseSequence);

  if (versionOrder < 0 || sequenceOrder < 0) {
    throw new BuilderLifecycleError(
      "UPDATE_DOWNGRADE_REJECTED",
      "the authenticated update would downgrade release version or release sequence"
    );
  }
  if ((versionOrder === 0) !== (sequenceOrder === 0)) {
    throw new BuilderLifecycleError(
      "UPDATE_VERSION_SEQUENCE_CONFLICT",
      "release version and release sequence must advance together"
    );
  }
  if (compareSemver(currentVersion, parseSemver(verified.payload.minimumInstalledVersion, "update.payload.minimumInstalledVersion")) < 0) {
    throw new BuilderLifecycleError(
      "UPDATE_INTERMEDIATE_REQUIRED",
      "the installed release is older than the authenticated update's minimum supported version"
    );
  }
  let majorStandardChange = false;
  for (const field of ["skill", "engine", "policy", "schema", "submission"]) {
    const installedStandard = parseSemver(state.standards[field], `state.standards.${field}`);
    const candidateStandard = parseSemver(verified.payload.standards[field], `update.payload.standards.${field}`);
    if (compareSemver(candidateStandard, installedStandard) < 0) {
      throw new BuilderLifecycleError(
        "UPDATE_STANDARD_DOWNGRADE_REJECTED",
        `the authenticated update would downgrade the ${field} standard`
      );
    }
    if (candidateStandard.major !== installedStandard.major) majorStandardChange = true;
  }

  let status = "update-available";
  let blocker = null;
  if (verified.payload.channel !== state.channel) {
    status = "channel-mismatch";
    blocker = `installed channel is ${state.channel}; authenticated update is ${verified.payload.channel}`;
  } else if (versionOrder === 0) {
    status = "up-to-date";
  } else if (targetVersion.major !== currentVersion.major || majorStandardChange) {
    status = "major-migration-required";
    blocker = "a major release requires explicit migration review and consent";
  } else if (verified.payload.migration.required) {
    status = "migration-required";
    blocker = "the authenticated update requires an explicit field-by-field migration dry-run";
  }

  const fixtureOnly = trustedPin.pinId.startsWith(TEST_ONLY_PIN_PREFIX) || TEST_ONLY_KEY_IDS.has(trustedPin.keyId);
  return {
    kind: "builder-update-check",
    schemaVersion: BUILDER_LIFECYCLE_SCHEMA_VERSION,
    installed: {
      channel: state.channel,
      releaseSequence: state.releaseSequence,
      releaseVersion: state.releaseVersion,
      standards: cloneJson(state.standards)
    },
    candidate: {
      channel: verified.payload.channel,
      releaseSequence: verified.payload.releaseSequence,
      releaseVersion: verified.payload.releaseVersion,
      standards: cloneJson(verified.payload.standards),
      releasedAt: verified.payload.releasedAt,
      validUntil: verified.payload.validUntil,
      payloadSha256: verified.payloadSha256,
      artifacts: cloneJson(verified.payload.artifacts),
      evidence: cloneJson(verified.payload.evidence)
    },
    verification: {
      authenticated: true,
      authenticationScope: fixtureOnly ? "test-fixture-only" : "supplied-pinned-local-update",
      fixtureOnly,
      authenticatedToSuppliedInstalledPin: true,
      productionTrustEstablishedByThisCommand: false,
      keyId: verified.keyId,
      pinId: trustedPin.pinId,
      pinSha256: verified.pinSha256,
      signatureValid: true,
      timeValidAt: verified.now
    },
    status,
    blocker,
    compatibleUpdate: status === "update-available" && !fixtureOnly,
    activationAllowedThisSession: false,
    migrationDryRunRequired: new Set(["major-migration-required", "migration-required"]).has(status),
    historicalStandardsPreserved: true,
    networkAccessed: false,
    externalActionsPerformed: [],
    nextAction: nextUpdateAction(status, fixtureOnly)
  };
}

export function verifySignedUpdate({ state, signedUpdate, trustedPin, now }) {
  validateInstalledState(state);
  assertPlainObject(trustedPin, "trusted pin");
  assertExactKeys(
    trustedPin,
    ["schemaVersion", "pinId", "keyId", "publicKey", "validFrom", "validUntil", "channels", "minimumReleaseSequence"],
    "trusted pin"
  );
  if (trustedPin.schemaVersion !== BUILDER_LIFECYCLE_SCHEMA_VERSION) invalid("TRUST_PIN_INVALID", "unsupported trusted pin schema");
  requireText(trustedPin.pinId, "trusted pin id");
  requireKeyId(trustedPin.keyId, "trusted pin key id");
  const rawPublicKey = decodeCanonicalBase64Url(trustedPin.publicKey, 32, "trusted pin public key");
  const derivedKeyId = crypto.createHash("sha256").update(rawPublicKey).digest("hex");
  if (derivedKeyId !== trustedPin.keyId) invalid("TRUST_PIN_INVALID", "trusted pin key id does not match its public key");
  if (!Array.isArray(trustedPin.channels) || trustedPin.channels.length === 0 || trustedPin.channels.some((channel) => !RELEASE_CHANNELS.has(channel))) {
    invalid("TRUST_PIN_INVALID", "trusted pin channels are invalid");
  }
  if (new Set(trustedPin.channels).size !== trustedPin.channels.length) invalid("TRUST_PIN_INVALID", "trusted pin channels contain duplicates");
  requireDecimal(trustedPin.minimumReleaseSequence, "trusted pin minimum release sequence");

  const normalizedNow = normalizeTimestamp(now, "trusted time");
  const pinValidFrom = timestampMs(trustedPin.validFrom, "trusted pin validFrom");
  const pinValidUntil = timestampMs(trustedPin.validUntil, "trusted pin validUntil");
  const nowMs = timestampMs(normalizedNow, "trusted time");
  if (pinValidFrom > pinValidUntil || nowMs < pinValidFrom || nowMs > pinValidUntil) {
    throw new BuilderLifecycleError("TRUST_PIN_STALE", "trusted pin is not valid at the supplied trusted time");
  }
  const pinSha256 = digestCanonical(trustedPin);
  if (pinSha256 !== state.trustedPinSha256 || trustedPin.keyId !== state.trustedKeyId) {
    throw new BuilderLifecycleError("TRUST_PIN_MISMATCH", "trusted pin does not match the installed pinned trust identity");
  }

  assertPlainObject(signedUpdate, "signed update");
  assertExactKeys(signedUpdate, ["payload", "signature"], "signed update");
  validateUpdatePayload(signedUpdate.payload);
  validateUpdateSignature(signedUpdate.signature);
  if (!trustedPin.channels.includes(signedUpdate.payload.channel)) {
    throw new BuilderLifecycleError("UPDATE_CHANNEL_UNTRUSTED", "trusted pin does not authorize the update channel");
  }
  if (compareDecimal(signedUpdate.payload.releaseSequence, trustedPin.minimumReleaseSequence) < 0) {
    throw new BuilderLifecycleError("UPDATE_PIN_ROLLBACK", "update sequence is older than the trusted pin minimum");
  }
  if (signedUpdate.signature.keyId !== trustedPin.keyId) {
    throw new BuilderLifecycleError("UPDATE_SIGNATURE_KEY_MISMATCH", "update signature key does not match the trusted pin");
  }
  const issuedAt = timestampMs(signedUpdate.signature.issuedAt, "update signature issuedAt");
  const signatureValidUntil = timestampMs(signedUpdate.signature.validUntil, "update signature validUntil");
  const payloadValidUntil = timestampMs(signedUpdate.payload.validUntil, "update payload validUntil");
  if (issuedAt > signatureValidUntil || nowMs < issuedAt || nowMs > signatureValidUntil || nowMs > payloadValidUntil) {
    throw new BuilderLifecycleError("UPDATE_SIGNATURE_STALE", "update signature or payload is not valid at the supplied trusted time");
  }
  if (signatureValidUntil > payloadValidUntil) {
    throw new BuilderLifecycleError("UPDATE_SIGNATURE_WINDOW_INVALID", "update signature outlives its authenticated payload");
  }
  const payloadBytes = Buffer.from(canonicalJson(signedUpdate.payload), "utf8");
  const payloadSha256 = `sha256:${crypto.createHash("sha256").update(payloadBytes).digest("hex")}`;
  if (payloadSha256 !== signedUpdate.signature.payloadSha256) {
    throw new BuilderLifecycleError("UPDATE_PAYLOAD_HASH_MISMATCH", "update payload hash does not match the signature envelope");
  }
  const signatureBytes = decodeCanonicalBase64Url(signedUpdate.signature.signature, 64, "update signature");
  const spki = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), rawPublicKey]);
  const publicKey = crypto.createPublicKey({ key: spki, format: "der", type: "spki" });
  if (!crypto.verify(null, payloadBytes, publicKey, signatureBytes)) {
    throw new BuilderLifecycleError("UPDATE_SIGNATURE_INVALID", "update signature is invalid");
  }

  return {
    payload: cloneJson(signedUpdate.payload),
    payloadSha256,
    keyId: trustedPin.keyId,
    pinSha256,
    now: normalizedNow
  };
}

export function migrationDryRun({ currentDocument, proposal, verifiedUpdate }) {
  assertPlainObject(currentDocument, "current document");
  validateMigrationProposal(proposal);
  assertPlainObject(verifiedUpdate, "verified update");
  assertPlainObject(verifiedUpdate.payload, "verified update payload");
  if (proposal.expectedCurrentSha256 !== digestCanonical(currentDocument)) {
    throw new BuilderLifecycleError("MIGRATION_SOURCE_MISMATCH", "migration proposal does not bind the exact current document");
  }
  if (currentDocument.standardVersion !== proposal.fromStandard) {
    throw new BuilderLifecycleError("MIGRATION_STANDARD_MISMATCH", "migration source standard does not match the current document");
  }
  if (proposal.toStandard !== verifiedUpdate.payload.standards.submission) {
    throw new BuilderLifecycleError("MIGRATION_TARGET_UNAUTHENTICATED", "migration target does not match the authenticated update");
  }
  const fromVersion = parseSemver(proposal.fromStandard, "migration fromStandard");
  const toVersion = parseSemver(proposal.toStandard, "migration toStandard");
  if (compareSemver(toVersion, fromVersion) < 0) {
    throw new BuilderLifecycleError("MIGRATION_DOWNGRADE_REJECTED", "migration target is older than the current standard");
  }

  const reasonsByPath = new Map();
  const duplicateReasonPaths = [];
  for (const entry of proposal.changeReasons) {
    if (reasonsByPath.has(entry.path)) duplicateReasonPaths.push(entry.path);
    else reasonsByPath.set(entry.path, entry.reason);
  }
  const changes = diffValues(currentDocument, proposal.proposedDocument);
  const unexplainedPaths = changes.filter((entry) => !reasonsByPath.has(entry.path)).map((entry) => entry.path);
  const staleReasonPaths = [...reasonsByPath.keys()].filter((entry) => !changes.some((change) => change.path === entry));
  const annotated = changes.map((entry) => {
    const protectedClasses = classifyProtectedPath(entry.path);
    return {
      ...entry,
      reason: reasonsByPath.get(entry.path) ?? null,
      protectedClasses
    };
  });
  const confirmations = [];
  for (const entry of annotated) {
    for (const protectedClass of entry.protectedClasses) {
      confirmations.push({
        id: `confirm-${protectedClass}-${confirmationDigest(entry.path)}`,
        path: entry.path,
        kind: protectedClass,
        required: true,
        statement: `Confirm the explicit ${protectedClass} change at ${entry.path}; it is never migrated silently.`
      });
    }
  }
  if (fromVersion.major !== toVersion.major) {
    confirmations.push({
      id: "confirm-major-standard-migration",
      path: "/standardVersion",
      kind: "major-standard",
      required: true,
      statement: `Confirm migration from standard ${proposal.fromStandard} to incompatible standard ${proposal.toStandard}.`
    });
  }
  const uniqueConfirmations = uniqueSorted(confirmations, (entry) => `${entry.kind}\u0000${entry.path}`);
  const ambiguous = unexplainedPaths.length > 0 || duplicateReasonPaths.length > 0 || staleReasonPaths.length > 0;

  return {
    kind: "builder-migration-dry-run",
    schemaVersion: BUILDER_LIFECYCLE_SCHEMA_VERSION,
    status: ambiguous ? "blocked-ambiguous" : uniqueConfirmations.length > 0 ? "confirmation-required" : "review-ready",
    source: {
      standardVersion: proposal.fromStandard,
      documentSha256: proposal.expectedCurrentSha256
    },
    target: {
      standardVersion: proposal.toStandard,
      proposedDocumentSha256: digestCanonical(proposal.proposedDocument),
      authenticatedReleaseVersion: verifiedUpdate.payload.releaseVersion,
      authenticatedReleaseSequence: verifiedUpdate.payload.releaseSequence
    },
    changes: annotated,
    ambiguity: {
      unexplainedPaths: unexplainedPaths.sort(compareText),
      duplicateReasonPaths: [...new Set(duplicateReasonPaths)].sort(compareText),
      staleReasonPaths: staleReasonPaths.sort(compareText)
    },
    confirmations: uniqueConfirmations,
    protectedChangeSummary: Object.fromEntries(
      Object.keys(PROTECTED_MIGRATION_SEGMENTS).map((key) => [key, annotated.filter((entry) => entry.protectedClasses.includes(key)).length])
    ),
    dryRun: true,
    writePerformed: false,
    historicalDocumentPreserved: true,
    historicalStandardPreserved: true,
    autoApplyAllowed: false,
    networkAccessed: false,
    externalActionsPerformed: [],
    nextAction: ambiguous
      ? "Resolve every unexplained, duplicate, or stale migration reason and rerun the dry-run."
      : uniqueConfirmations.length > 0
        ? "Review the complete diff and collect every named confirmation in a separate owner-controlled step."
        : "Review the complete diff; applying it remains a separate explicit step."
  };
}

export function planPrivateRelease({ candidate, history, now }) {
  validateReleaseCandidate(candidate);
  validateReleaseHistory(history);
  const normalizedNow = normalizeTimestamp(now, "release planning time");
  const nowMs = timestampMs(normalizedNow, "release planning time");
  const preparedAtMs = timestampMs(candidate.preparedAt, "candidate preparedAt");
  const requestedReleaseAtMs = timestampMs(candidate.requestedReleaseAt, "candidate requestedReleaseAt");
  const intentSha256 = releaseIntentDigest(candidate);
  if (preparedAtMs > nowMs || preparedAtMs > requestedReleaseAtMs) {
    throw new BuilderLifecycleError("RELEASE_TIME_INVALID", "candidate preparation time must not be in the future or after its requested release time");
  }
  if (requestedReleaseAtMs < nowMs) {
    throw new BuilderLifecycleError("RELEASE_TIME_IN_PAST", "requested release time is earlier than the supplied planning time");
  }
  if (history.releases.some((entry) => timestampMs(entry.releasedAt, "history releasedAt") > nowMs)) {
    throw new BuilderLifecycleError("RELEASE_HISTORY_FUTURE", "release history contains an entry later than the caller-supplied planning time");
  }

  const declaredPlanningBlockers = [];
  const plannedRelease = evaluatePlannedReleaseIdentity(candidate.plannedRelease);
  if (!plannedRelease.callerDeclaredComplete) {
    declaredPlanningBlockers.push("Caller-declared planned release identity needs a full commit, tree, tag, builder artifact path/digest, and release-manifest path/digest.");
  }
  const evidence = {};
  for (const [id, slot] of Object.entries(candidate.evidence)) {
    const result = evaluateDeclaredEvidenceSlot(slot, `candidate.evidence.${id}`);
    evidence[id] = result;
    if (!result.callerDeclaredComplete) declaredPlanningBlockers.push(result.blocker);
  }
  const communications = {};
  for (const [id, slot] of Object.entries(candidate.communications)) {
    const result = evaluateDeclaredEvidenceSlot(slot, `candidate.communications.${id}`);
    communications[id] = result;
    if (!result.callerDeclaredComplete) declaredPlanningBlockers.push(result.blocker);
  }
  if (!candidate.changeSetComplete || candidate.unbundledChangeIds.length > 0) {
    declaredPlanningBlockers.push("Caller must declare one complete bundled change set and clear unbundledChangeIds.");
  }

  const sameChannelReleases = history.releases.filter((entry) => entry.channel === candidate.channel);
  for (const release of sameChannelReleases) {
    if (compareSemver(parseSemver(candidate.releaseVersion, "candidate releaseVersion"), parseSemver(release.releaseVersion, "history releaseVersion")) <= 0) {
      declaredPlanningBlockers.push(`Candidate version must be newer than caller-supplied ${candidate.channel} release ${release.releaseVersion}.`);
      break;
    }
  }

  const normalReleases = history.releases
    .filter((entry) => entry.releaseKind === "normal")
    .map((entry) => ({ ...entry, releasedAtMs: timestampMs(entry.releasedAt, "history releasedAt") }))
    .filter((entry) => entry.releasedAtMs <= requestedReleaseAtMs)
    .sort((left, right) => right.releasedAtMs - left.releasedAtMs);
  const previousNormal = normalReleases[0] ?? null;
  const nextNormalReleaseAtMs = previousNormal === null ? null : previousNormal.releasedAtMs + NORMAL_RELEASE_WINDOW_MS;
  const callerDeclaredNormalWindowOpen = nextNormalReleaseAtMs === null || requestedReleaseAtMs >= nextNormalReleaseAtMs;

  let hotfixException = {
    applicable: candidate.releaseKind === "security-hotfix",
    callerDeclaredComplete: false,
    callerDeclaredCriticalSeverity: false,
    callerDeclaredCadenceExceptionEligible: false,
    severity: null,
    affectedVersions: [],
    reasonCode: null,
    incidentRecordSha256: null,
    ownerOverrideEvidenceSha256: null,
    releaseIntentSha256: null,
    ownerOverrideGrantedAt: null,
    ownerOverrideNotBeforePreparedAt: false,
    ownerOverrideNotAfterPlanningTime: false,
    evidenceArtifactRead: false,
    ownerIdentityAuthenticated: false,
    ownerAuthorityVerified: false,
    cadenceExceptionProven: false
  };
  if (candidate.releaseKind === "security-hotfix") {
    const override = candidate.securityHotfix;
    const ownerOverrideNotBeforePreparedAt = grantedAtNotBefore(override.ownerOverride, preparedAtMs);
    const ownerOverrideNotAfterPlanningTime = grantedAtNotAfter(override.ownerOverride, nowMs);
    const callerDeclaredComplete = Boolean(
      HOTFIX_SEVERITIES.has(override.severity)
      && override.affectedVersions.length > 0
      && requireOptionalText(override.reasonCode)
      && SHA256_PATTERN.test(override.incidentRecordSha256 ?? "")
      && validGrantedEvidence(override.ownerOverride, preparedAtMs, nowMs, intentSha256)
    );
    const callerDeclaredCriticalSeverity = override.severity === "critical";
    hotfixException = {
      applicable: true,
      callerDeclaredComplete,
      callerDeclaredCriticalSeverity,
      callerDeclaredCadenceExceptionEligible: callerDeclaredComplete && callerDeclaredCriticalSeverity,
      severity: override.severity,
      affectedVersions: cloneJson(override.affectedVersions),
      reasonCode: override.reasonCode,
      incidentRecordSha256: override.incidentRecordSha256,
      ownerOverrideEvidenceSha256: override.ownerOverride.evidenceSha256,
      releaseIntentSha256: override.ownerOverride.releaseIntentSha256,
      ownerOverrideGrantedAt: override.ownerOverride.grantedAt,
      ownerOverrideNotBeforePreparedAt,
      ownerOverrideNotAfterPlanningTime,
      evidenceArtifactRead: false,
      ownerIdentityAuthenticated: false,
      ownerAuthorityVerified: false,
      cadenceExceptionProven: false
    };
    if (!hotfixException.callerDeclaredComplete) {
      declaredPlanningBlockers.push("Caller-declared security-hotfix coordinates need severity, sorted affected versions, a reason code, incident digest, and an intent-bound owner override granted between candidate preparation and planning time.");
    }
  }
  if (!callerDeclaredNormalWindowOpen && !hotfixException.callerDeclaredCadenceExceptionEligible) {
    declaredPlanningBlockers.push(`Caller-supplied history calculates the next normal release at ${new Date(nextNormalReleaseAtMs).toISOString().replace(".000Z", "Z")}; only a complete caller-declared critical security hotfix may bypass this local calculation.`);
  }
  const callerDeclaredOwnerGoComplete = validGrantedEvidence(candidate.ownerReleaseGo, preparedAtMs, nowMs, intentSha256);
  if (!callerDeclaredOwnerGoComplete) {
    declaredPlanningBlockers.push("Caller-declared owner-GO coordinates are missing, outside candidate-preparedAt through planning-now, incomplete, or do not bind the exact candidate intent.");
  }

  const uniqueDeclaredPlanningBlockers = [...new Set(declaredPlanningBlockers)].sort(compareText);
  const externalVerificationRequirements = EXTERNAL_W5_REQUIREMENTS.map((entry) => ({
    ...entry,
    status: "not-performed"
  }));
  const externalVerificationBlockers = externalVerificationRequirements.map((entry) => `External W5 verification pending: ${entry.id}.`);
  const blockers = [...uniqueDeclaredPlanningBlockers, ...externalVerificationBlockers].sort(compareText);
  const callerDeclaredPlanComplete = uniqueDeclaredPlanningBlockers.length === 0;
  return {
    kind: "caller-declared-local-release-plan",
    schemaVersion: BUILDER_LIFECYCLE_SCHEMA_VERSION,
    planningBoundary: {
      inputAuthority: "caller-supplied-untrusted-data",
      callerDeclarationsOnly: true,
      candidateBytesBound: false,
      plannedReleaseIdentityVerified: false,
      sourceCommitTreeTagVerified: false,
      releaseArtifactBytesRead: false,
      releaseManifestBytesRead: false,
      repositoryVisibilityChecked: false,
      releaseHistoryAuthenticated: false,
      trustedTimeAuthenticated: false,
      evidenceArtifactsRead: false,
      evidenceDigestsVerified: false,
      ownerIdentityAuthenticated: false,
      ownerAuthorityVerified: false,
      externalW5VerificationPerformed: false
    },
    candidate: {
      candidateId: candidate.candidateId,
      releaseVersion: candidate.releaseVersion,
      channel: candidate.channel,
      releaseKind: candidate.releaseKind,
      plannedRelease,
      preparedAt: candidate.preparedAt,
      requestedReleaseAt: normalizeTimestamp(candidate.requestedReleaseAt, "candidate requestedReleaseAt"),
      releaseIntentSha256: intentSha256,
      callerDeclaredPrivateCandidate: candidate.privateCandidate,
      callerDeclaredPublicState: candidate.publicState,
      privacyProven: false,
      publicationStateVerified: false,
      liveStateVerified: false
    },
    cadence: {
      rule: "one-normal-public-release-per-rolling-24-hours",
      operationalTimestampRule: "independently-verified-github-release-published-at-or-earliest-public-exposure",
      calculationOnly: true,
      inputAuthority: "caller-supplied-release-history-and-time",
      callerSuppliedHistoryEntries: history.releases.length,
      declaredPreviousNormalReleaseAt: previousNormal?.releasedAt ?? null,
      calculatedNextNormalReleaseAt: nextNormalReleaseAtMs === null ? null : new Date(nextNormalReleaseAtMs).toISOString().replace(".000Z", "Z"),
      callerDeclaredNormalWindowOpen,
      timezoneRule: "absolute-rfc3339-instants",
      releaseHistoryAuthenticated: false,
      trustedTimeAuthenticated: false,
      cadenceComplianceProven: false,
      hotfixException
    },
    bundledChanges: {
      callerDeclaredComplete: candidate.changeSetComplete && candidate.unbundledChangeIds.length === 0,
      changeIds: candidate.changes.map((entry) => entry.id).sort(compareText),
      changes: candidate.changes.map((entry) => ({ id: entry.id, kind: entry.kind })).sort((left, right) => compareText(left.id, right.id)),
      unbundledChangeIds: [...candidate.unbundledChangeIds].sort(compareText)
    },
    evidence,
    communications,
    ownerReleaseGo: {
      callerDeclaredStatus: candidate.ownerReleaseGo.status,
      callerDeclaredComplete: callerDeclaredOwnerGoComplete,
      evidenceCoordinatesComplete: validEvidenceCoordinates(candidate.ownerReleaseGo),
      intentDigestMatches: candidate.ownerReleaseGo.releaseIntentSha256 === intentSha256,
      evidenceSha256: candidate.ownerReleaseGo.evidenceSha256,
      releaseIntentSha256: candidate.ownerReleaseGo.releaseIntentSha256,
      grantedAt: candidate.ownerReleaseGo.grantedAt,
      grantedNotBeforePreparedAt: grantedAtNotBefore(candidate.ownerReleaseGo, preparedAtMs),
      grantedNotAfterPlanningTime: grantedAtNotAfter(candidate.ownerReleaseGo, nowMs),
      evidenceArtifactRead: false,
      evidenceDigestVerified: false,
      identityAuthenticated: false,
      authorityVerified: false
    },
    declaredPlanningBlockers: uniqueDeclaredPlanningBlockers,
    externalVerificationRequirements,
    blockers,
    callerDeclaredPlanComplete,
    externalW5VerificationRequired: true,
    releaseReadinessProven: false,
    releaseActionAuthorized: false,
    readyForOwnerControlledReleaseAction: false,
    publicationPerformed: false,
    networkAccessed: false,
    externalActionsPerformed: [],
    publicClaimAllowed: false,
    nextAction: callerDeclaredPlanComplete
      ? "Send the exact candidate and referenced bytes to independent W5 verification; this local calculation cannot authorize a release."
      : "Complete the caller-declared planning inputs, rerun locally, then send the exact candidate and bytes to independent W5 verification."
  };
}

export function renderHumanStatus(result) {
  assertPlainObject(result, "lifecycle result");
  if (result.kind === "builder-version-status") {
    return [
      `Builder ${result.installed.releaseVersion} (${result.installed.channel})`,
      `Standard: ${result.installed.standards.submission}`,
      "State: local version record only; no network or publication."
    ].join("\n");
  }
  if (result.kind === "builder-update-check") {
    const lines = [
      `Update: ${result.status}`,
      `Installed ${result.installed.releaseVersion} -> candidate ${result.candidate.releaseVersion}`,
      result.blocker === null ? `Next: ${result.nextAction}` : `Blocked: ${result.blocker}`,
      "No update was downloaded, activated, or published."
    ];
    lines.splice(
      2,
      0,
      result.verification.fixtureOnly
        ? "Trust: TEST FIXTURE ONLY; no production trust is established."
        : "Trust: signature matches the supplied installed pin; production-root provenance remains external."
    );
    return lines.join("\n");
  }
  if (result.kind === "builder-migration-dry-run") {
    const blocker = result.status === "blocked-ambiguous"
      ? `Blocked: ${result.ambiguity.unexplainedPaths.length} unexplained, ${result.ambiguity.duplicateReasonPaths.length} duplicate, ${result.ambiguity.staleReasonPaths.length} stale reason paths.`
      : `${result.confirmations.length} explicit confirmation(s) required.`;
    return [
      `Migration dry-run: ${result.source.standardVersion} -> ${result.target.standardVersion}`,
      `Diff: ${result.changes.length} field change(s). ${blocker}`,
      `Next: ${result.nextAction}`,
      "No file was changed. Historical standards remain preserved."
    ].join("\n");
  }
  if (result.kind === "caller-declared-local-release-plan") {
    const state = result.callerDeclaredPlanComplete ? "caller-declared inputs complete" : "caller-declared inputs incomplete";
    return [
      `Local release calculation ${result.candidate.releaseVersion} (${result.candidate.channel}): ${state}`,
      "Proof: privacy, cadence, planned source identity, artifact and release-manifest bytes, owner authority, and release readiness are all unverified.",
      result.declaredPlanningBlockers.length === 0
        ? "Caller-declared blockers: none. External W5 verification remains mandatory."
        : `Caller-declared blockers: ${result.declaredPlanningBlockers.join(" | ")}`,
      `Next: ${result.nextAction}`,
      "This command performed no publication and authorized no release."
    ].join("\n");
  }
  throw new BuilderLifecycleError("HUMAN_RENDER_UNSUPPORTED", "unsupported lifecycle result kind");
}

function validateInstalledState(state) {
  assertPlainObject(state, "installed state");
  assertExactKeys(
    state,
    ["schemaVersion", "releaseVersion", "releaseSequence", "channel", "standards", "trustedPinSha256", "trustedKeyId"],
    "installed state"
  );
  if (state.schemaVersion !== BUILDER_LIFECYCLE_SCHEMA_VERSION) invalid("STATE_INVALID", "unsupported installed state schema");
  parseSemver(state.releaseVersion, "state.releaseVersion");
  requireDecimal(state.releaseSequence, "state.releaseSequence");
  if (!RELEASE_CHANNELS.has(state.channel)) invalid("STATE_INVALID", "installed channel is invalid");
  validateStandards(state.standards, "state.standards");
  if (!SHA256_PATTERN.test(state.trustedPinSha256 ?? "")) invalid("STATE_INVALID", "installed trust pin digest is invalid");
  requireKeyId(state.trustedKeyId, "installed trusted key id");
}

function validateUpdatePayload(payload) {
  assertPlainObject(payload, "update payload");
  assertExactKeys(
    payload,
    ["schemaVersion", "releaseSequence", "channel", "releaseVersion", "minimumInstalledVersion", "releasedAt", "validUntil", "standards", "migration", "artifacts", "evidence"],
    "update payload"
  );
  if (payload.schemaVersion !== BUILDER_LIFECYCLE_SCHEMA_VERSION) invalid("UPDATE_PAYLOAD_INVALID", "unsupported update payload schema");
  requireDecimal(payload.releaseSequence, "update releaseSequence");
  if (!RELEASE_CHANNELS.has(payload.channel)) invalid("UPDATE_PAYLOAD_INVALID", "update channel is invalid");
  const version = parseSemver(payload.releaseVersion, "update releaseVersion");
  parseSemver(payload.minimumInstalledVersion, "update minimumInstalledVersion");
  if (payload.channel === "stable" && version.prerelease.length > 0) invalid("UPDATE_PAYLOAD_INVALID", "stable update cannot be a prerelease");
  const releasedAt = timestampMs(payload.releasedAt, "update releasedAt");
  const validUntil = timestampMs(payload.validUntil, "update validUntil");
  if (releasedAt > validUntil) invalid("UPDATE_PAYLOAD_INVALID", "update validity ends before release time");
  validateStandards(payload.standards, "update standards");
  assertPlainObject(payload.migration, "update migration");
  assertExactKeys(payload.migration, ["required", "fromStandard", "toStandard", "majorConsentRequired"], "update migration");
  if (typeof payload.migration.required !== "boolean" || typeof payload.migration.majorConsentRequired !== "boolean") invalid("UPDATE_PAYLOAD_INVALID", "update migration booleans are invalid");
  parseSemver(payload.migration.fromStandard, "update migration fromStandard");
  parseSemver(payload.migration.toStandard, "update migration toStandard");
  if (payload.migration.toStandard !== payload.standards.submission) invalid("UPDATE_PAYLOAD_INVALID", "migration target and submission standard disagree");
  if (!Array.isArray(payload.artifacts) || payload.artifacts.length === 0 || payload.artifacts.length > 64) invalid("UPDATE_PAYLOAD_INVALID", "update artifacts are invalid");
  const artifactIds = new Set();
  for (const artifact of payload.artifacts) {
    assertPlainObject(artifact, "update artifact");
    assertExactKeys(artifact, ["id", "bytes", "sha256"], "update artifact");
    requireText(artifact.id, "update artifact id");
    if (artifactIds.has(artifact.id)) invalid("UPDATE_PAYLOAD_INVALID", "update artifact ids must be unique");
    artifactIds.add(artifact.id);
    if (!Number.isSafeInteger(artifact.bytes) || artifact.bytes < 1 || artifact.bytes > 268_435_456) invalid("UPDATE_PAYLOAD_INVALID", "update artifact byte length is invalid");
    if (!SHA256_PATTERN.test(artifact.sha256 ?? "")) invalid("UPDATE_PAYLOAD_INVALID", "update artifact digest is invalid");
  }
  if (payload.artifacts.map((entry) => entry.id).join("\n") !== [...payload.artifacts].sort((a, b) => compareText(a.id, b.id)).map((entry) => entry.id).join("\n")) {
    invalid("UPDATE_PAYLOAD_INVALID", "update artifacts must be sorted by id");
  }
  validateEvidenceMap(payload.evidence, "update evidence", ["checksums", "sbom", "evals", "canary"]);
  for (const id of ["checksums", "sbom", "evals", "canary"]) {
    if (payload.evidence[id].status !== "complete" || !validEvidenceCoordinates(payload.evidence[id])) {
      invalid("UPDATE_EVIDENCE_INCOMPLETE", `update evidence ${id} must be complete and content addressed`);
    }
  }
}

function validateUpdateSignature(signature) {
  assertPlainObject(signature, "update signature");
  assertExactKeys(signature, ["algorithm", "keyId", "issuedAt", "validUntil", "payloadSha256", "signature"], "update signature");
  if (signature.algorithm !== "Ed25519") invalid("UPDATE_SIGNATURE_INVALID", "update signature algorithm must be Ed25519");
  requireKeyId(signature.keyId, "update signature key id");
  timestampMs(signature.issuedAt, "update signature issuedAt");
  timestampMs(signature.validUntil, "update signature validUntil");
  if (!SHA256_PATTERN.test(signature.payloadSha256 ?? "")) invalid("UPDATE_SIGNATURE_INVALID", "update payload digest is invalid");
  decodeCanonicalBase64Url(signature.signature, 64, "update signature");
}

function validateStandards(value, location) {
  assertPlainObject(value, location);
  assertExactKeys(value, ["skill", "engine", "policy", "schema", "submission"], location);
  for (const field of ["skill", "engine", "policy", "schema", "submission"]) parseSemver(value[field], `${location}.${field}`);
}

function validateMigrationProposal(proposal) {
  assertPlainObject(proposal, "migration proposal");
  assertExactKeys(proposal, ["schemaVersion", "fromStandard", "toStandard", "expectedCurrentSha256", "proposedDocument", "changeReasons"], "migration proposal");
  if (proposal.schemaVersion !== BUILDER_LIFECYCLE_SCHEMA_VERSION) invalid("MIGRATION_PROPOSAL_INVALID", "unsupported migration proposal schema");
  parseSemver(proposal.fromStandard, "migration fromStandard");
  parseSemver(proposal.toStandard, "migration toStandard");
  if (!SHA256_PATTERN.test(proposal.expectedCurrentSha256 ?? "")) invalid("MIGRATION_PROPOSAL_INVALID", "migration current digest is invalid");
  assertPlainObject(proposal.proposedDocument, "migration proposed document");
  if (proposal.proposedDocument.standardVersion !== proposal.toStandard) invalid("MIGRATION_PROPOSAL_INVALID", "proposed document standard does not match migration target");
  if (!Array.isArray(proposal.changeReasons) || proposal.changeReasons.length > 4096) invalid("MIGRATION_PROPOSAL_INVALID", "migration change reasons are invalid");
  for (const entry of proposal.changeReasons) {
    assertPlainObject(entry, "migration change reason");
    assertExactKeys(entry, ["path", "reason"], "migration change reason");
    if (!isJsonPointer(entry.path)) invalid("MIGRATION_PROPOSAL_INVALID", "migration reason path must be a canonical JSON pointer");
    requireText(entry.reason, "migration change reason");
  }
}

function validateReleaseCandidate(candidate) {
  assertPlainObject(candidate, "release candidate");
  assertExactKeys(candidate, [
    "schemaVersion", "candidateId", "privateCandidate", "publicState", "releaseVersion", "channel", "releaseKind",
    "plannedRelease", "preparedAt", "requestedReleaseAt", "changeSetComplete", "changes", "unbundledChangeIds", "evidence",
    "communications", "ownerReleaseGo", "securityHotfix"
  ], "release candidate");
  if (candidate.schemaVersion !== BUILDER_LIFECYCLE_SCHEMA_VERSION) invalid("RELEASE_CANDIDATE_INVALID", "unsupported release candidate schema");
  requireText(candidate.candidateId, "release candidate id");
  if (candidate.privateCandidate !== true || candidate.publicState !== "not-published") invalid("RELEASE_CANDIDATE_INVALID", "candidate must declare privateCandidate true and publicState not-published; the planner does not verify either claim");
  parseSemver(candidate.releaseVersion, "candidate releaseVersion");
  if (!RELEASE_CHANNELS.has(candidate.channel)) invalid("RELEASE_CANDIDATE_INVALID", "candidate channel is invalid");
  if (candidate.channel === "stable" && parseSemver(candidate.releaseVersion, "candidate releaseVersion").prerelease.length > 0) invalid("RELEASE_CANDIDATE_INVALID", "stable candidate cannot be a prerelease");
  if (!new Set(["normal", "security-hotfix"]).has(candidate.releaseKind)) invalid("RELEASE_CANDIDATE_INVALID", "candidate release kind is invalid");
  validatePlannedReleaseIdentity(candidate.plannedRelease, candidate.releaseVersion);
  timestampMs(candidate.preparedAt, "candidate preparedAt");
  timestampMs(candidate.requestedReleaseAt, "candidate requestedReleaseAt");
  if (typeof candidate.changeSetComplete !== "boolean") invalid("RELEASE_CANDIDATE_INVALID", "candidate changeSetComplete must be boolean");
  if (!Array.isArray(candidate.changes) || candidate.changes.length === 0 || candidate.changes.length > 1024) invalid("RELEASE_CANDIDATE_INVALID", "candidate changes are invalid");
  const ids = new Set();
  for (const change of candidate.changes) {
    assertPlainObject(change, "candidate change");
    assertExactKeys(change, ["id", "kind", "summary"], "candidate change");
    requireText(change.id, "candidate change id");
    if (!RELEASE_CHANGE_KINDS.has(change.kind)) invalid("RELEASE_CANDIDATE_INVALID", "candidate change kind is invalid");
    requireText(change.summary, "candidate change summary");
    if (ids.has(change.id)) invalid("RELEASE_CANDIDATE_INVALID", "candidate change ids must be unique");
    ids.add(change.id);
  }
  if (!Array.isArray(candidate.unbundledChangeIds) || candidate.unbundledChangeIds.some((entry) => typeof entry !== "string" || entry.length === 0)) invalid("RELEASE_CANDIDATE_INVALID", "candidate unbundled change ids are invalid");
  if (new Set(candidate.unbundledChangeIds).size !== candidate.unbundledChangeIds.length) invalid("RELEASE_CANDIDATE_INVALID", "candidate unbundled change ids must be unique");
  validateEvidenceMap(candidate.evidence, "candidate evidence", ["checksums", "sbom", "evals", "canary"]);
  validateEvidenceMap(candidate.communications, "candidate communications", ["dailyReleaseNotes", "publicPostSummary"]);
  validateOwnerEvidence(candidate.ownerReleaseGo, "candidate owner release GO", ["missing", "granted"]);
  assertPlainObject(candidate.securityHotfix, "candidate security hotfix");
  assertExactKeys(candidate.securityHotfix, ["severity", "affectedVersions", "reasonCode", "incidentRecordSha256", "ownerOverride"], "candidate security hotfix");
  if (candidate.securityHotfix.severity !== null && !HOTFIX_SEVERITIES.has(candidate.securityHotfix.severity)) invalid("RELEASE_CANDIDATE_INVALID", "security hotfix severity is invalid");
  if (!Array.isArray(candidate.securityHotfix.affectedVersions) || candidate.securityHotfix.affectedVersions.length > 256) invalid("RELEASE_CANDIDATE_INVALID", "security hotfix affectedVersions is invalid");
  const affectedVersionIdentities = new Set();
  for (const version of candidate.securityHotfix.affectedVersions) {
    parseSemver(version, "security hotfix affected version");
    if (affectedVersionIdentities.has(version)) invalid("RELEASE_CANDIDATE_INVALID", "security hotfix affectedVersions must be unique");
    affectedVersionIdentities.add(version);
  }
  const sortedAffectedVersions = [...candidate.securityHotfix.affectedVersions].sort(compareSemverText);
  if (sortedAffectedVersions.some((version, index) => version !== candidate.securityHotfix.affectedVersions[index])) invalid("RELEASE_CANDIDATE_INVALID", "security hotfix affectedVersions must be sorted by semantic version");
  if (candidate.securityHotfix.reasonCode !== null) requireText(candidate.securityHotfix.reasonCode, "security hotfix reason code");
  if (candidate.securityHotfix.incidentRecordSha256 !== null && !SHA256_PATTERN.test(candidate.securityHotfix.incidentRecordSha256)) invalid("RELEASE_CANDIDATE_INVALID", "security hotfix incident digest is invalid");
  validateOwnerEvidence(candidate.securityHotfix.ownerOverride, "candidate security hotfix owner override", ["not-applicable", "missing", "granted"]);
  if (
    candidate.releaseKind === "normal"
    && (
      candidate.securityHotfix.severity !== null
      || candidate.securityHotfix.affectedVersions.length !== 0
      || candidate.securityHotfix.reasonCode !== null
      || candidate.securityHotfix.incidentRecordSha256 !== null
      || candidate.securityHotfix.ownerOverride.status !== "not-applicable"
    )
  ) invalid("RELEASE_CANDIDATE_INVALID", "normal release must not carry a security-hotfix override");
  if (
    candidate.releaseKind === "security-hotfix"
    && (
      candidate.securityHotfix.severity === null
      || candidate.securityHotfix.affectedVersions.length === 0
      || candidate.securityHotfix.reasonCode === null
      || candidate.securityHotfix.incidentRecordSha256 === null
      || candidate.securityHotfix.ownerOverride.status === "not-applicable"
    )
  ) invalid("RELEASE_CANDIDATE_INVALID", "security-hotfix release needs severity, affectedVersions, a reason code, an incident digest, and an owner override record");
  if (candidate.releaseKind === "security-hotfix" && candidate.changes.some((change) => !SECURITY_CHANGE_KINDS.has(change.kind))) {
    invalid("RELEASE_CANDIDATE_INVALID", "security-hotfix release may contain only security-fix or security-advisory changes");
  }
}

function validatePlannedReleaseIdentity(value, candidateReleaseVersion) {
  assertPlainObject(value, "candidate planned release");
  assertExactKeys(value, ["builder", "submissionStandard", "feePolicy", "source", "artifact", "releaseManifest"], "candidate planned release");

  assertPlainObject(value.builder, "candidate planned builder transition");
  assertExactKeys(value.builder, ["fromVersion", "toVersion", "semanticClassification"], "candidate planned builder transition");
  const builderFrom = parseSemver(value.builder.fromVersion, "candidate planned builder fromVersion");
  const builderTo = parseSemver(value.builder.toVersion, "candidate planned builder toVersion");
  if (compareSemver(builderTo, builderFrom) <= 0) invalid("RELEASE_CANDIDATE_INVALID", "planned builder version must advance");
  if (value.builder.toVersion !== candidateReleaseVersion) invalid("RELEASE_CANDIDATE_INVALID", "planned builder target must equal candidate releaseVersion");
  if (!SEMANTIC_CLASSIFICATIONS.has(value.builder.semanticClassification)) invalid("RELEASE_CANDIDATE_INVALID", "planned builder semantic classification is invalid");
  if (semanticClassification(builderFrom, builderTo) !== value.builder.semanticClassification) invalid("RELEASE_CANDIDATE_INVALID", "planned builder semantic classification does not match its version transition");

  validateNonDowngradeTransition(value.submissionStandard, "candidate planned submission standard");
  validateNonDowngradeTransition(value.feePolicy, "candidate planned fee policy");

  assertPlainObject(value.source, "candidate planned source");
  assertExactKeys(value.source, ["commitSha", "treeSha", "tagName"], "candidate planned source");
  for (const [field, objectValue] of [["commitSha", value.source.commitSha], ["treeSha", value.source.treeSha]]) {
    if (objectValue !== null && !FULL_GIT_OBJECT_PATTERN.test(objectValue)) invalid("RELEASE_CANDIDATE_INVALID", `candidate planned source ${field} must be null or a full lowercase 40-hex Git object id`);
  }
  if (value.source.tagName !== null) requireSafeGitTag(value.source.tagName, "candidate planned source tagName");

  validateDigestCoordinate(value.artifact, "candidate planned artifact");
  validateDigestCoordinate(value.releaseManifest, "candidate planned release manifest");
}

function validateNonDowngradeTransition(value, location) {
  assertPlainObject(value, location);
  assertExactKeys(value, ["fromVersion", "toVersion"], location);
  const from = parseSemver(value.fromVersion, `${location} fromVersion`);
  const to = parseSemver(value.toVersion, `${location} toVersion`);
  if (compareSemver(to, from) < 0) invalid("RELEASE_CANDIDATE_INVALID", `${location} must not downgrade`);
}

function validateDigestCoordinate(value, location) {
  assertPlainObject(value, location);
  assertExactKeys(value, ["path", "sha256"], location);
  if (value.path !== null) requireSafeRelativePath(value.path, `${location}.path`);
  if (value.sha256 !== null && !SHA256_PATTERN.test(value.sha256)) invalid("RELEASE_CANDIDATE_INVALID", `${location}.sha256 is invalid`);
}

function evaluatePlannedReleaseIdentity(value) {
  const sourceComplete = FULL_GIT_OBJECT_PATTERN.test(value.source.commitSha ?? "")
    && FULL_GIT_OBJECT_PATTERN.test(value.source.treeSha ?? "")
    && typeof value.source.tagName === "string";
  const artifactComplete = validDigestCoordinate(value.artifact);
  const releaseManifestComplete = validDigestCoordinate(value.releaseManifest);
  return {
    builder: cloneJson(value.builder),
    submissionStandard: cloneJson(value.submissionStandard),
    feePolicy: cloneJson(value.feePolicy),
    callerDeclaredVersionTransitionsConsistent: true,
    source: {
      commitSha: value.source.commitSha,
      treeSha: value.source.treeSha,
      tagName: value.source.tagName,
      callerDeclaredComplete: sourceComplete,
      commitVerified: false,
      treeVerified: false,
      tagVerified: false,
      publicExposureChecked: false
    },
    artifact: evaluateDigestCoordinate(value.artifact),
    releaseManifest: evaluateDigestCoordinate(value.releaseManifest),
    callerDeclaredComplete: sourceComplete && artifactComplete && releaseManifestComplete,
    externallyVerified: false
  };
}

function evaluateDigestCoordinate(value) {
  return {
    path: value.path,
    sha256: value.sha256,
    callerDeclaredCoordinatesComplete: validDigestCoordinate(value),
    bytesRead: false,
    digestVerified: false,
    externallyVerified: false
  };
}

function validDigestCoordinate(value) {
  return typeof value.path === "string" && value.path.trim().length > 0 && SHA256_PATTERN.test(value.sha256 ?? "");
}

function validateReleaseHistory(history) {
  assertPlainObject(history, "release history");
  assertExactKeys(history, ["schemaVersion", "releases"], "release history");
  if (history.schemaVersion !== BUILDER_LIFECYCLE_SCHEMA_VERSION || !Array.isArray(history.releases) || history.releases.length > 4096) invalid("RELEASE_HISTORY_INVALID", "release history is invalid");
  const identities = new Set();
  for (const entry of history.releases) {
    assertPlainObject(entry, "release history entry");
    assertExactKeys(entry, ["releaseVersion", "channel", "releaseKind", "releasedAt", "ownerGoEvidenceSha256"], "release history entry");
    parseSemver(entry.releaseVersion, "history releaseVersion");
    if (!RELEASE_CHANNELS.has(entry.channel) || !new Set(["normal", "security-hotfix"]).has(entry.releaseKind)) invalid("RELEASE_HISTORY_INVALID", "release history channel or kind is invalid");
    timestampMs(entry.releasedAt, "history releasedAt");
    if (!SHA256_PATTERN.test(entry.ownerGoEvidenceSha256 ?? "")) invalid("RELEASE_HISTORY_INVALID", "release history owner GO digest is invalid");
    const identity = `${entry.channel}\u0000${entry.releaseVersion}`;
    if (identities.has(identity)) invalid("RELEASE_HISTORY_INVALID", "release history contains a duplicate channel/version");
    identities.add(identity);
  }
}

function validateEvidenceMap(value, location, exactKeys) {
  assertPlainObject(value, location);
  assertExactKeys(value, exactKeys, location);
  for (const key of exactKeys) validateEvidenceSlot(value[key], `${location}.${key}`);
}

function validateEvidenceSlot(value, location) {
  assertPlainObject(value, location);
  assertExactKeys(value, ["status", "path", "evidenceSha256"], location);
  if (!new Set(["pending", "complete"]).has(value.status)) invalid("EVIDENCE_SLOT_INVALID", `${location}.status is invalid`);
  if (value.path !== null) requireSafeRelativePath(value.path, `${location}.path`);
  if (value.evidenceSha256 !== null && !SHA256_PATTERN.test(value.evidenceSha256)) invalid("EVIDENCE_SLOT_INVALID", `${location}.evidenceSha256 is invalid`);
}

function validateOwnerEvidence(value, location, statuses) {
  assertPlainObject(value, location);
  assertExactKeys(value, ["status", "path", "evidenceSha256", "releaseIntentSha256", "grantedAt"], location);
  if (!statuses.includes(value.status)) invalid("RELEASE_CANDIDATE_INVALID", `${location}.status is invalid`);
  if (value.path !== null) requireSafeRelativePath(value.path, `${location}.path`);
  if (value.evidenceSha256 !== null && !SHA256_PATTERN.test(value.evidenceSha256)) invalid("RELEASE_CANDIDATE_INVALID", `${location}.evidenceSha256 is invalid`);
  if (value.releaseIntentSha256 !== null && !SHA256_PATTERN.test(value.releaseIntentSha256)) invalid("RELEASE_CANDIDATE_INVALID", `${location}.releaseIntentSha256 is invalid`);
  if (value.grantedAt !== null) timestampMs(value.grantedAt, `${location}.grantedAt`);
  if (value.status !== "granted" && (value.path !== null || value.evidenceSha256 !== null || value.releaseIntentSha256 !== null || value.grantedAt !== null)) {
    invalid("RELEASE_CANDIDATE_INVALID", `${location} cannot carry evidence unless its status is granted`);
  }
}

function evaluateDeclaredEvidenceSlot(slot, location) {
  validateEvidenceSlot(slot, location);
  const coordinatesComplete = validEvidenceCoordinates(slot);
  const callerDeclaredComplete = slot.status === "complete" && coordinatesComplete;
  return {
    callerDeclaredStatus: slot.status,
    callerDeclaredComplete,
    evidenceCoordinatesComplete: coordinatesComplete,
    path: slot.path,
    evidenceSha256: slot.evidenceSha256,
    artifactRead: false,
    evidenceDigestVerified: false,
    externallyVerified: false,
    blocker: callerDeclaredComplete ? null : `${location} needs status complete, a nonempty path, and caller-declared SHA-256 coordinates before local planning can be complete.`
  };
}

function validEvidenceCoordinates(value) {
  return typeof value.path === "string" && value.path.trim().length > 0 && SHA256_PATTERN.test(value.evidenceSha256 ?? "");
}

function grantedAtNotBefore(value, earliestMs) {
  return value.grantedAt !== null && timestampMs(value.grantedAt, "owner evidence grantedAt") >= earliestMs;
}

function grantedAtNotAfter(value, latestMs) {
  return value.grantedAt !== null && timestampMs(value.grantedAt, "owner evidence grantedAt") <= latestMs;
}

function validGrantedEvidence(value, earliestMs, latestMs, expectedIntentSha256) {
  return value.status === "granted"
    && validEvidenceCoordinates(value)
    && value.releaseIntentSha256 === expectedIntentSha256
    && grantedAtNotBefore(value, earliestMs)
    && grantedAtNotAfter(value, latestMs);
}

function diffValues(left, right, path = "") {
  if (deepEqual(left, right)) return [];
  if (isPlainObject(left) && isPlainObject(right)) {
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort(compareText);
    return keys.flatMap((key) => diffValues(left[key], right[key], `${path}/${escapePointer(key)}`));
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    const length = Math.max(left.length, right.length);
    const changes = [];
    for (let index = 0; index < length; index += 1) changes.push(...diffValues(left[index], right[index], `${path}/${index}`));
    return changes;
  }
  return [{
    path: path || "",
    operation: left === undefined ? "add" : right === undefined ? "remove" : "replace",
    before: left === undefined ? null : cloneJson(left),
    after: right === undefined ? null : cloneJson(right)
  }];
}

function classifyProtectedPath(pointer) {
  const segments = pointer.split("/").slice(1).map((entry) => entry
    .replace(/~1/gu, "/")
    .replace(/~0/gu, "~")
    .toLowerCase()
    .replace(/[^a-z0-9]/gu, ""));
  return Object.entries(PROTECTED_MIGRATION_SEGMENTS)
    .filter(([name, names]) => segments.some((segment) => names.has(segment) || protectedSegmentMatch(name, segment)))
    .map(([name]) => name)
    .sort(compareText);
}

function confirmationDigest(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex").slice(0, 12);
}

function uniqueSorted(values, identity) {
  const map = new Map();
  for (const value of values) map.set(identity(value), value);
  return [...map.values()].sort((left, right) => compareText(identity(left), identity(right)));
}

function parseSemver(value, location) {
  if (typeof value !== "string") invalid("VERSION_INVALID", `${location} must be semantic version text`);
  const match = SEMVER_PATTERN.exec(value);
  if (!match) invalid("VERSION_INVALID", `${location} must be a strict semantic version`);
  const prerelease = match[4] === undefined ? [] : match[4].split(".");
  for (const identifier of prerelease) {
    if (/^[0-9]+$/u.test(identifier) && identifier.length > 1 && identifier.startsWith("0")) invalid("VERSION_INVALID", `${location} contains a noncanonical prerelease number`);
  }
  return {
    text: value,
    major: BigInt(match[1]),
    minor: BigInt(match[2]),
    patch: BigInt(match[3]),
    prerelease
  };
}

function compareSemver(left, right) {
  for (const field of ["major", "minor", "patch"]) if (left[field] !== right[field]) return left[field] < right[field] ? -1 : 1;
  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0;
  if (left.prerelease.length === 0) return 1;
  if (right.prerelease.length === 0) return -1;
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    if (left.prerelease[index] === undefined) return -1;
    if (right.prerelease[index] === undefined) return 1;
    if (left.prerelease[index] === right.prerelease[index]) continue;
    const leftNumeric = /^[0-9]+$/u.test(left.prerelease[index]);
    const rightNumeric = /^[0-9]+$/u.test(right.prerelease[index]);
    if (leftNumeric && rightNumeric) return BigInt(left.prerelease[index]) < BigInt(right.prerelease[index]) ? -1 : 1;
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return compareText(left.prerelease[index], right.prerelease[index]);
  }
  return 0;
}

function compareSemverText(left, right) {
  const order = compareSemver(parseSemver(left, "semantic version"), parseSemver(right, "semantic version"));
  return order === 0 ? compareText(left, right) : order;
}

function semanticClassification(from, to) {
  if (from.major !== to.major) return "major";
  if (from.minor !== to.minor) return "minor";
  return "patch";
}

function compareDecimal(left, right) {
  requireDecimal(left, "left decimal");
  requireDecimal(right, "right decimal");
  const leftValue = BigInt(left);
  const rightValue = BigInt(right);
  return leftValue === rightValue ? 0 : leftValue < rightValue ? -1 : 1;
}

function normalizeTimestamp(value, location) {
  const milliseconds = timestampMs(value, location);
  return new Date(milliseconds).toISOString().replace(".000Z", "Z");
}

function timestampMs(value, location) {
  if (typeof value !== "string") {
    invalid("TIMESTAMP_INVALID", `${location} must be second-precision RFC 3339 with an explicit offset`);
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(Z|([+-])(\d{2}):(\d{2}))$/u.exec(value);
  if (match === null) invalid("TIMESTAMP_INVALID", `${location} must be second-precision RFC 3339 with an explicit offset`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[7] === "Z" ? 0 : Number(match[9]);
  const offsetMinute = match[7] === "Z" ? 0 : Number(match[10]);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59) {
    invalid("TIMESTAMP_INVALID", `${location} is not a real RFC 3339 instant`);
  }
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const localDate = new Date(localAsUtc);
  if (
    localDate.getUTCFullYear() !== year
    || localDate.getUTCMonth() !== month - 1
    || localDate.getUTCDate() !== day
    || localDate.getUTCHours() !== hour
    || localDate.getUTCMinutes() !== minute
    || localDate.getUTCSeconds() !== second
  ) invalid("TIMESTAMP_INVALID", `${location} is not a real RFC 3339 instant`);
  const offsetSign = match[8] === "-" ? -1 : 1;
  const offsetMs = offsetSign * ((offsetHour * 60) + offsetMinute) * 60 * 1_000;
  const milliseconds = localAsUtc - offsetMs;
  if (!Number.isFinite(milliseconds)) invalid("TIMESTAMP_INVALID", `${location} is not a real RFC 3339 instant`);
  return milliseconds;
}

function protectedSegmentMatch(kind, segment) {
  const fragments = {
    economics: ["economic", "fee", "rate", "tax"],
    wallet: ["wallet", "recipient", "beneficiary", "owner"],
    authority: ["authority", "role", "permission", "admin", "controller", "upgrade", "pause"],
    risk: ["risk", "threat", "severity"],
    evidence: ["evidence", "receipt", "proof", "finding", "report"]
  }[kind];
  return fragments.some((fragment) => segment.includes(fragment));
}

function requireSafeRelativePath(value, location) {
  requireText(value, location);
  if (
    value.startsWith("/")
    || value.includes("\\")
    || value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) invalid("PATH_INVALID", `${location} must be a safe relative POSIX path`);
}

function requireSafeGitTag(value, location) {
  requireText(value, location);
  if (
    value.length > 256
    || value === "@"
    || value.startsWith("/")
    || value.endsWith("/")
    || value.endsWith(".")
    || value.includes("..")
    || value.includes("@{")
    || /[\u0000-\u0020\u007f~^:?*\[\]\\]/u.test(value)
    || value.split("/").some((segment) => segment.length === 0 || segment.startsWith(".") || segment.endsWith(".lock"))
  ) invalid("RELEASE_CANDIDATE_INVALID", `${location} must be a canonical planned Git tag name`);
}

function decodeCanonicalBase64Url(value, expectedBytes, location) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/u.test(value)) invalid("BASE64URL_INVALID", `${location} must be unpadded base64url`);
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length !== expectedBytes || bytes.toString("base64url") !== value) invalid("BASE64URL_INVALID", `${location} is not canonical ${expectedBytes}-byte base64url`);
  return bytes;
}

function nextUpdateAction(status, fixtureOnly = false) {
  if (fixtureOnly) return "Use these signed bytes only to exercise the local fixture workflow; never install, trust, or publish them as a production update.";
  if (status === "update-available") return "Stage the authenticated bytes for a later session; do not activate them in this session.";
  if (status === "major-migration-required" || status === "migration-required") return "Run migrate --dry-run, review every field diff, then request explicit consent in a later step.";
  if (status === "channel-mismatch") return "Keep the installed channel or explicitly change channel policy outside this command.";
  return "No update action is required.";
}

function requireDecimal(value, location) {
  if (typeof value !== "string" || !DECIMAL_PATTERN.test(value)) invalid("DECIMAL_INVALID", `${location} must be a canonical unsigned decimal string`);
}

function requireKeyId(value, location) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) invalid("KEY_ID_INVALID", `${location} must be 64 lowercase hexadecimal characters`);
}

function requireText(value, location) {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 8_192) invalid("TEXT_INVALID", `${location} must be nonempty bounded text`);
}

function requireOptionalText(value) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 8_192;
}

function isJsonPointer(value) {
  return typeof value === "string" && (value === "" || /^(?:\/(?:[^~/]|~[01])*)+$/u.test(value));
}

function assertPlainObject(value, location) {
  if (!isPlainObject(value)) invalid("OBJECT_INVALID", `${location} must be a plain JSON object`);
}

function assertExactKeys(value, keys, location) {
  const actual = Object.keys(value).sort(compareText);
  const expected = [...keys].sort(compareText);
  if (actual.length !== expected.length || actual.some((entry, index) => entry !== expected[index])) {
    invalid("OBJECT_KEYS_INVALID", `${location} has unsupported or missing fields`);
  }
}

function invalid(code, message) {
  throw new BuilderLifecycleError(code, message);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function deepEqual(left, right) {
  if (left === undefined || right === undefined) return left === right;
  return canonicalJson(left) === canonicalJson(right);
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function escapePointer(value) {
  return value.replace(/~/gu, "~0").replace(/\//gu, "~1");
}

function compareText(left, right) {
  return Buffer.from(left, "utf8").compare(Buffer.from(right, "utf8"));
}
