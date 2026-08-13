const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/u;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const UINT = /^(0|[1-9][0-9]{0,77})$/u;
const INT = /^-?(0|[1-9][0-9]{0,77})$/u;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._+/-]{0,127}$/u;
const PORTABLE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/u;
const UINT256_MAX = (1n << 256n) - 1n;

export const CHAINLINK_KNOWLEDGE_RECEIPT_SHA256_V1 = "sha256:e95511be2bfceb7b6fcd7093a4623a998df823bb7b5657564c7290cee98986cf";

export const CHAINLINK_INTEGRATION_IDS_V1 = Object.freeze([
  "ccip",
  "cre",
  "data-feeds",
  "data-streams",
  "vrf-v2-5"
]);

export function validateChainlinkProviderProfileV1(input) {
  const errors = [];
  const add = reporter(errors);
  exactObject(input, [
    "schemaVersion", "kind", "profileId", "subject", "projectPlan", "runtimeCoverage", "targetChainIds",
    "sourceReceipt", "authorityBoundary", "sourceCoverage", "productionInvariants", "integrations", "evidence"
  ], "$", add);
  equal(input?.schemaVersion, "1.0.0", "$.schemaVersion", add);
  equal(input?.kind, "programmable-chainlink-provider-profile", "$.kind", add);
  pattern(input?.profileId, SLUG, "$.profileId", add);
  validateArtifactBinding(input?.subject, "$.subject", add);
  equal(input?.subject?.kind, "source", "$.subject.kind", add);
  validateArtifactBinding(input?.projectPlan, "$.projectPlan", add);
  equal(input?.projectPlan?.kind, "config", "$.projectPlan.kind", add);

  exactObject(input?.runtimeCoverage, ["executionFamily", "scope"], "$.runtimeCoverage", add);
  equal(input?.runtimeCoverage?.executionFamily, "evm", "$.runtimeCoverage.executionFamily", add);
  equal(input?.runtimeCoverage?.scope, "EVM_ONLY", "$.runtimeCoverage.scope", add);
  validateSortedUniqueUint256(input?.targetChainIds, "$.targetChainIds", add);

  exactObject(input?.sourceReceipt, ["path", "sha256"], "$.sourceReceipt", add);
  equal(input?.sourceReceipt?.path, "references/provider-knowledge-source-receipt-2026-08-13.json", "$.sourceReceipt.path", add);
  equal(input?.sourceReceipt?.sha256, CHAINLINK_KNOWLEDGE_RECEIPT_SHA256_V1, "$.sourceReceipt.sha256", add);

  exactObject(input?.authorityBoundary, [
    "executionAuthorityEffect", "validationNetworkAccess", "secrets", "automaticDeployment", "automaticApproval"
  ], "$.authorityBoundary", add);
  equal(input?.authorityBoundary?.executionAuthorityEffect, "NONE", "$.authorityBoundary.executionAuthorityEffect", add);
  equal(input?.authorityBoundary?.validationNetworkAccess, "forbidden", "$.authorityBoundary.validationNetworkAccess", add);
  equal(input?.authorityBoundary?.secrets, "backend-only", "$.authorityBoundary.secrets", add);
  equal(input?.authorityBoundary?.automaticDeployment, false, "$.authorityBoundary.automaticDeployment", add);
  equal(input?.authorityBoundary?.automaticApproval, false, "$.authorityBoundary.automaticApproval", add);

  exactObject(input?.sourceCoverage, ["automation", "functions", "confidentialAi", "ace", "nonEvm"], "$.sourceCoverage", add);
  equal(input?.sourceCoverage?.automation, "not-covered-by-reviewed-source", "$.sourceCoverage.automation", add);
  equal(input?.sourceCoverage?.functions, "not-covered-by-reviewed-source", "$.sourceCoverage.functions", add);
  equal(input?.sourceCoverage?.confidentialAi, "excluded-alpha", "$.sourceCoverage.confidentialAi", add);
  equal(input?.sourceCoverage?.ace, "excluded-separate-legal-license-security-review", "$.sourceCoverage.ace", add);
  equal(input?.sourceCoverage?.nonEvm, "out-of-scope", "$.sourceCoverage.nonEvm", add);

  validateProductionInvariants(input?.productionInvariants, "$.productionInvariants", add);
  validateChainlinkIntegrations(input?.integrations, input?.targetChainIds, add);
  validateArtifactBindings(input?.evidence, "$.evidence", add);
  return errors;
}

export function collectChainlinkProviderArtifactBindingsV1(input) {
  const bindings = [];
  if (isObject(input?.subject)) bindings.push(input.subject);
  if (isObject(input?.projectPlan)) bindings.push(input.projectPlan);
  if (Array.isArray(input?.evidence)) bindings.push(...input.evidence);
  for (const integration of Array.isArray(input?.integrations) ? input.integrations : []) {
    if (Array.isArray(integration?.evidence)) bindings.push(...integration.evidence);
    for (const deployment of Array.isArray(integration?.deployments) ? integration.deployments : []) {
      if (isObject(deployment?.dependencyLock)) bindings.push(deployment.dependencyLock);
      for (const role of Array.isArray(deployment?.contractRoles) ? deployment.contractRoles : []) {
        if (isObject(role?.deploymentEvidence)) bindings.push(role.deploymentEvidence);
      }
    }
  }
  return bindings;
}

export function requiredChainlinkGenericCapabilitiesV1(input) {
  return [...new Set((Array.isArray(input?.integrations) ? input.integrations : [])
    .flatMap((integration) => Array.isArray(integration?.genericCapabilities) ? integration.genericCapabilities : []))]
    .sort((left, right) => Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")));
}

function validateProductionInvariants(value, path, add) {
  exactObject(value, ["liveness", "accountExecution", "indexerRpc", "chainCapability", "futureProtocol"], path, add);
  requireTrueObject(value?.liveness, [
    "callerBound", "authorizationBound", "gasPayerBound", "fundingAndIncentiveBound",
    "deadlineBound", "workBounded", "retryIdempotent", "stuckExitBound"
  ], `${path}.liveness`, add);
  const account = value?.accountExecution;
  exactObject(account, [
    "supportedModels", "nonceBound", "deadlineBound", "domainBound", "replayRejected",
    "codeLengthAssumptionsForbidden", "mutableSignatureValidityHandled", "persistentDelegationHandled"
  ], `${path}.accountExecution`, add);
  validateSortedUniqueEnum(account?.supportedModels, ["eip7702", "eoa", "erc1271", "erc4337", "relayer-session-key"], `${path}.accountExecution.supportedModels`, add);
  for (const key of [
    "nonceBound", "deadlineBound", "domainBound", "replayRejected", "codeLengthAssumptionsForbidden",
    "mutableSignatureValidityHandled", "persistentDelegationHandled"
  ]) equal(account?.[key], true, `${path}.accountExecution.${key}`, add);
  requireTrueObject(value?.indexerRpc, [
    "runtimeHashBound", "abiAndTopicBound", "startBlockHashBound", "blockTagBound", "boundedLogChunks",
    "removedLogsHandled", "deterministicReplay", "providerDisagreementFailsClosed", "freshnessBound"
  ], `${path}.indexerRpc`, add);
  const chain = value?.chainCapability;
  exactObject(chain, [
    "inclusionFinalityWithdrawalSeparated", "feeAndTimeSemanticsBound", "sequencerPolicy",
    "opcodePrecompileCompilerBound", "bridgeReplayDomainBound", "deterministicAddressAssumptionsForbidden"
  ], `${path}.chainCapability`, add);
  for (const key of [
    "inclusionFinalityWithdrawalSeparated", "feeAndTimeSemanticsBound", "opcodePrecompileCompilerBound",
    "bridgeReplayDomainBound", "deterministicAddressAssumptionsForbidden"
  ]) equal(chain?.[key], true, `${path}.chainCapability.${key}`, add);
  oneOf(chain?.sequencerPolicy, ["bound", "not-applicable-with-chain-proof"], `${path}.chainCapability.sequencerPolicy`, add);
  requireTrueObject(value?.futureProtocol, [
    "forkInclusionRequired", "executionSpecCommitRequired", "targetRuntimeProofRequired", "fallbackOrMigrationBound"
  ], `${path}.futureProtocol`, add);
}

function validateChainlinkIntegrations(value, targetChainIds, add) {
  if (!Array.isArray(value) || value.length === 0 || value.length > CHAINLINK_INTEGRATION_IDS_V1.length) {
    add("$.integrations", `must contain 1..${CHAINLINK_INTEGRATION_IDS_V1.length} reviewed integrations`);
    return;
  }
  const ids = value.map((entry) => entry?.id);
  if (bytewiseOrderInvalid(ids)) add("$.integrations", "must be unique and sorted by integration id");
  for (const [index, integration] of value.entries()) {
    const path = `$.integrations[${index}]`;
    exactObject(integration, ["id", "status", "genericCapabilities", "executionOperations", "deployments", "properties", "evidence"], path, add);
    oneOf(integration?.id, CHAINLINK_INTEGRATION_IDS_V1, `${path}.id`, add);
    oneOf(integration?.status, ["planned", "implemented-structure", "deployment-evidence-declared"], `${path}.status`, add);
    validateGenericCapabilities(integration?.id, integration?.genericCapabilities, `${path}.genericCapabilities`, add);
    validateExecutionOperations(integration?.id, integration?.executionOperations, `${path}.executionOperations`, add);
    validateDeployments(integration?.deployments, targetChainIds, `${path}.deployments`, add);
    validateIntegrationProperties(integration?.id, integration?.status, integration?.properties, integration?.deployments, integration?.evidence, `${path}.properties`, add, targetChainIds);
    validateArtifactBindings(integration?.evidence, `${path}.evidence`, add);
    if (["implemented-structure", "deployment-evidence-declared"].includes(integration?.status)) {
      requireEvidenceKind(integration?.evidence, "source", `${path}.evidence`, add);
      requireEvidenceKind(integration?.evidence, "config", `${path}.evidence`, add);
      requireEvidenceKind(integration?.evidence, "dependency-lock", `${path}.evidence`, add);
      requireEvidenceKind(integration?.evidence, "test", `${path}.evidence`, add);
    }
    if (integration?.status === "deployment-evidence-declared") {
      if (integration?.id !== "cre" && (!Array.isArray(integration?.deployments) || integration.deployments.length === 0)) {
        add(`${path}.deployments`, "deployment-evidence-declared requires at least one exact EVM deployment binding");
      }
      if (!Array.isArray(integration?.evidence) || integration.evidence.length < 2) {
        add(`${path}.evidence`, "deployment-evidence-declared requires at least two content-addressed artifacts");
      }
      requireEvidenceKind(integration?.evidence, integration?.id === "cre" ? "receipt" : "deployment", `${path}.evidence`, add);
    }
  }
}

function validateGenericCapabilities(id, value, path, add) {
  const expected = {
    ccip: ["cross-chain-messaging"],
    cre: ["keeper-automation"],
    "data-feeds": ["oracle-data"],
    "data-streams": ["oracle-data"],
    "vrf-v2-5": ["randomness"]
  }[id];
  if (expected && (!Array.isArray(value) || value.length !== expected.length || value.some((entry, index) => entry !== expected[index]))) {
    add(path, `must equal ${JSON.stringify(expected)}`);
  }
}

function validateExecutionOperations(id, value, path, add) {
  const fixed = {
    ccip: ["async-callback-outside-hook"],
    cre: ["offchain-deterministic-runtime"],
    "data-streams": ["report-verification-outside-hook"],
    "vrf-v2-5": ["async-callback-outside-hook"]
  }[id];
  if (fixed && (!Array.isArray(value) || value.length !== fixed.length || value.some((entry, index) => entry !== fixed[index]))) {
    add(path, `must equal ${JSON.stringify(fixed)}`);
    return;
  }
  if (id === "data-feeds" && (!Array.isArray(value) || value.length !== 1 || !["async-read-outside-hook", "bounded-sync-read-in-hook"].includes(value[0]))) {
    add(path, "must select exactly one bounded Data Feeds read operation");
  }
}

function validateDeployments(value, targetChainIds, path, add) {
  if (!Array.isArray(value) || value.length > 4) {
    add(path, "must be an array of at most four exact EVM deployments");
    return;
  }
  const ids = value.map((deployment) => deployment?.chainId);
  if (bytewiseNumericOrderInvalid(ids)) add(path, "must be unique and numerically sorted by chainId");
  for (const [index, deployment] of value.entries()) {
    const deploymentPath = `${path}[${index}]`;
    exactObject(deployment, ["chainId", "dependencyLock", "contractRoles"], deploymentPath, add);
    positiveUint256(deployment?.chainId, `${deploymentPath}.chainId`, add);
    if (Array.isArray(targetChainIds) && !targetChainIds.includes(deployment?.chainId)) add(`${deploymentPath}.chainId`, "must be declared in root targetChainIds");
    validateArtifactBinding(deployment?.dependencyLock, `${deploymentPath}.dependencyLock`, add);
    equal(deployment?.dependencyLock?.kind, "dependency-lock", `${deploymentPath}.dependencyLock.kind`, add);
    if (!Array.isArray(deployment?.contractRoles) || deployment.contractRoles.length === 0 || deployment.contractRoles.length > 16) {
      add(`${deploymentPath}.contractRoles`, "must contain 1..16 exact contract roles");
      continue;
    }
    const roles = deployment.contractRoles.map((role) => role?.role);
    if (bytewiseOrderInvalid(roles)) add(`${deploymentPath}.contractRoles`, "must be unique and sorted by role");
    for (const [roleIndex, role] of deployment.contractRoles.entries()) {
      const rolePath = `${deploymentPath}.contractRoles[${roleIndex}]`;
      exactObject(role, ["role", "address", "runtimeCodeKeccak256", "deploymentEvidence"], rolePath, add);
      pattern(role?.role, SLUG, `${rolePath}.role`, add);
      pattern(role?.address, ADDRESS, `${rolePath}.address`, add);
      pattern(role?.runtimeCodeKeccak256, BYTES32, `${rolePath}.runtimeCodeKeccak256`, add);
      validateArtifactBinding(role?.deploymentEvidence, `${rolePath}.deploymentEvidence`, add);
      equal(role?.deploymentEvidence?.kind, "deployment", `${rolePath}.deploymentEvidence.kind`, add);
    }
  }
}

function validateIntegrationProperties(id, status, value, deployments, evidence, path, add, targetChainIds) {
  if (id === "vrf-v2-5") validateVrf(value, status, deployments, path, add);
  else if (id === "data-feeds") validateDataFeeds(value, status, deployments, path, add);
  else if (id === "ccip") validateCcip(value, status, deployments, evidence, path, add);
  else if (id === "data-streams") validateDataStreams(value, status, deployments, evidence, path, add);
  else if (id === "cre") validateCre(value, evidence, path, add);
  else if (isObject(value)) add(path, "cannot validate properties for an unknown integration id");
  else add(path, "must be an object");
  const productChains = id === "ccip" ? [value?.sourceChainId, value?.destinationChainId] : id === "cre" ? [] : [value?.chainId];
  for (const chainId of productChains) if (Array.isArray(targetChainIds) && !targetChainIds.includes(chainId)) add(`${path}.${id === "ccip" && chainId === value?.destinationChainId ? "destinationChainId" : id === "ccip" ? "sourceChainId" : "chainId"}`, "must be declared in root targetChainIds");
}

function validateVrf(value, status, deployments, path, add) {
  exactObject(value, [
    "chainId", "paymentMode", "coordinatorKeyHash", "subscriptionId", "minimumRequestConfirmations", "callbackGasLimit", "numWords", "coordinatorMaximumNumWords", "fundingAsset",
    "requestIdentityBound", "frozenInputBound", "replacementRerollAllowed", "callbackCanRevert", "callbackWorkPolicy",
    "duplicateFulfillmentPolicy", "unknownRequestPolicy", "timeoutPolicy", "outOfOrderFulfillmentTested", "storageBounded"
  ], path, add);
  positiveUint256(value?.chainId, `${path}.chainId`, add);
  oneOf(value?.paymentMode, ["direct-funding", "subscription"], `${path}.paymentMode`, add);
  pattern(value?.coordinatorKeyHash, BYTES32, `${path}.coordinatorKeyHash`, add);
  if (value?.paymentMode === "subscription") positiveUint256(value?.subscriptionId, `${path}.subscriptionId`, add);
  else equal(value?.subscriptionId, null, `${path}.subscriptionId`, add);
  positiveUintBound(value?.minimumRequestConfirmations, 65_535n, `${path}.minimumRequestConfirmations`, add);
  positiveUintBound(value?.callbackGasLimit, 2_500_000n, `${path}.callbackGasLimit`, add);
  positiveUintBound(value?.numWords, 4_294_967_295n, `${path}.numWords`, add);
  positiveUintBound(value?.coordinatorMaximumNumWords, 4_294_967_295n, `${path}.coordinatorMaximumNumWords`, add);
  if (validUnsigned(value?.numWords) && validUnsigned(value?.coordinatorMaximumNumWords) && BigInt(value.numWords) > BigInt(value.coordinatorMaximumNumWords)) add(`${path}.numWords`, "must not exceed coordinatorMaximumNumWords");
  if (value?.fundingAsset !== "native") pattern(value?.fundingAsset, ADDRESS, `${path}.fundingAsset`, add);
  for (const key of ["requestIdentityBound", "frozenInputBound", "outOfOrderFulfillmentTested", "storageBounded"]) equal(value?.[key], true, `${path}.${key}`, add);
  equal(value?.replacementRerollAllowed, false, `${path}.replacementRerollAllowed`, add);
  equal(value?.callbackCanRevert, false, `${path}.callbackCanRevert`, add);
  equal(value?.callbackWorkPolicy, "minimal-store-only", `${path}.callbackWorkPolicy`, add);
  equal(value?.duplicateFulfillmentPolicy, "idempotent-ignore", `${path}.duplicateFulfillmentPolicy`, add);
  equal(value?.unknownRequestPolicy, "record-and-return", `${path}.unknownRequestPolicy`, add);
  equal(value?.timeoutPolicy, "cancel-or-refund-without-reroll", `${path}.timeoutPolicy`, add);
  if (status === "deployment-evidence-declared") requireRolesOnChain(deployments, value?.chainId, ["consumer", "coordinator", ...(value?.paymentMode === "direct-funding" ? ["wrapper"] : [])], path, add);
}

function validateDataFeeds(value, status, deployments, path, add) {
  exactObject(value, [
    "chainId", "pair", "quoteUnit", "inversion", "decimals", "maximumAgeSeconds", "minimumAnswer", "maximumAnswer", "roundCompleteness",
    "sequencerPolicy", "sequencerGracePeriodSeconds", "futureTimestampRejected", "nonPositiveRejected", "silentFallbackAllowed"
  ], path, add);
  positiveUint256(value?.chainId, `${path}.chainId`, add);
  boundedText(value?.pair, 1, 80, `${path}.pair`, add);
  boundedText(value?.quoteUnit, 1, 80, `${path}.quoteUnit`, add);
  oneOf(value?.inversion, ["direct", "inverted"], `${path}.inversion`, add);
  boundedInteger(value?.decimals, 0, 255, `${path}.decimals`, add);
  positiveUint256(value?.maximumAgeSeconds, `${path}.maximumAgeSeconds`, add);
  signedInt256(value?.minimumAnswer, `${path}.minimumAnswer`, add);
  signedInt256(value?.maximumAnswer, `${path}.maximumAnswer`, add);
  if (validSigned(value?.minimumAnswer) && validSigned(value?.maximumAnswer) && BigInt(value.minimumAnswer) >= BigInt(value.maximumAnswer)) add(`${path}.maximumAnswer`, "must be greater than minimumAnswer");
  equal(value?.roundCompleteness, "updated-at-nonzero", `${path}.roundCompleteness`, add);
  oneOf(value?.sequencerPolicy, ["not-applicable-with-chain-proof", "official-uptime-feed"], `${path}.sequencerPolicy`, add);
  if (value?.sequencerPolicy === "official-uptime-feed") positiveUint256(value?.sequencerGracePeriodSeconds, `${path}.sequencerGracePeriodSeconds`, add);
  else equal(value?.sequencerGracePeriodSeconds, null, `${path}.sequencerGracePeriodSeconds`, add);
  equal(value?.futureTimestampRejected, true, `${path}.futureTimestampRejected`, add);
  equal(value?.nonPositiveRejected, true, `${path}.nonPositiveRejected`, add);
  if (validSigned(value?.minimumAnswer) && BigInt(value.minimumAnswer) < 1n) add(`${path}.minimumAnswer`, "must be positive when nonPositiveRejected is true");
  equal(value?.silentFallbackAllowed, false, `${path}.silentFallbackAllowed`, add);
  if (status === "deployment-evidence-declared") requireRolesOnChain(deployments, value?.chainId, ["current-aggregator", "feed-proxy", ...(value?.sequencerPolicy === "official-uptime-feed" ? ["sequencer-uptime-feed"] : [])], path, add);
}

function validateCcip(value, status, deployments, evidence, path, add) {
  exactObject(value, [
    "direction", "sourceChainId", "sourceChainSelector", "destinationChainId", "destinationChainSelector", "sender", "receiver",
    "payloadSchemaSha256", "applicationDomain", "maximumPayloadBytes", "maximumPendingMessages", "finalityPolicySha256",
    "rateLimitPolicySha256", "feeFundingPolicySha256", "recoveryBeneficiary", "replayRejected", "reorderingHandled", "ownerRedirectAllowed"
  ], path, add);
  equal(value?.direction, "source-to-destination", `${path}.direction`, add);
  positiveUint256(value?.sourceChainId, `${path}.sourceChainId`, add);
  positiveUintBound(value?.sourceChainSelector, 18_446_744_073_709_551_615n, `${path}.sourceChainSelector`, add);
  positiveUint256(value?.destinationChainId, `${path}.destinationChainId`, add);
  positiveUintBound(value?.destinationChainSelector, 18_446_744_073_709_551_615n, `${path}.destinationChainSelector`, add);
  if (value?.sourceChainId === value?.destinationChainId) add(`${path}.destinationChainId`, "must differ from sourceChainId");
  if (value?.sourceChainSelector === value?.destinationChainSelector) add(`${path}.destinationChainSelector`, "must differ from sourceChainSelector");
  pattern(value?.sender, ADDRESS, `${path}.sender`, add);
  pattern(value?.receiver, ADDRESS, `${path}.receiver`, add);
  for (const key of ["payloadSchemaSha256", "finalityPolicySha256", "rateLimitPolicySha256", "feeFundingPolicySha256"]) pattern(value?.[key], SHA256, `${path}.${key}`, add);
  requireEvidenceDigest(evidence, value?.payloadSchemaSha256, ["schema"], `${path}.payloadSchemaSha256`, add);
  for (const key of ["finalityPolicySha256", "rateLimitPolicySha256", "feeFundingPolicySha256"]) {
    requireEvidenceDigest(evidence, value?.[key], ["config"], `${path}.${key}`, add);
  }
  pattern(value?.applicationDomain, BYTES32, `${path}.applicationDomain`, add);
  positiveUint256(value?.maximumPayloadBytes, `${path}.maximumPayloadBytes`, add);
  positiveUint256(value?.maximumPendingMessages, `${path}.maximumPendingMessages`, add);
  pattern(value?.recoveryBeneficiary, ADDRESS, `${path}.recoveryBeneficiary`, add);
  equal(value?.replayRejected, true, `${path}.replayRejected`, add);
  equal(value?.reorderingHandled, true, `${path}.reorderingHandled`, add);
  equal(value?.ownerRedirectAllowed, false, `${path}.ownerRedirectAllowed`, add);
  if (status === "deployment-evidence-declared") {
    requireRolesOnChain(deployments, value?.sourceChainId, ["sender", "source-router"], path, add);
    requireRolesOnChain(deployments, value?.destinationChainId, ["destination-router", "receiver"], path, add);
    requireRoleAddress(deployments, value?.sourceChainId, "sender", value?.sender, `${path}.sender`, add);
    requireRoleAddress(deployments, value?.destinationChainId, "receiver", value?.receiver, `${path}.receiver`, add);
  }
}

function validateDataStreams(value, status, deployments, evidence, path, add) {
  exactObject(value, [
    "chainId", "feedId", "reportSchemaSha256", "reportSchemaVersion", "maximumObservationAgeSeconds", "maximumFutureSeconds",
    "maximumReportBytes", "maximumVerificationGas", "validFromEnforced", "expiresAtEnforced", "marketStatusPolicy", "ripcordPolicy", "billingRoute", "credentials"
  ], path, add);
  positiveUint256(value?.chainId, `${path}.chainId`, add);
  pattern(value?.feedId, BYTES32, `${path}.feedId`, add);
  pattern(value?.reportSchemaSha256, SHA256, `${path}.reportSchemaSha256`, add);
  requireEvidenceDigest(evidence, value?.reportSchemaSha256, ["schema"], `${path}.reportSchemaSha256`, add);
  pattern(value?.reportSchemaVersion, VERSION, `${path}.reportSchemaVersion`, add);
  positiveUint256(value?.maximumObservationAgeSeconds, `${path}.maximumObservationAgeSeconds`, add);
  positiveUint256(value?.maximumFutureSeconds, `${path}.maximumFutureSeconds`, add);
  positiveUint256(value?.maximumReportBytes, `${path}.maximumReportBytes`, add);
  positiveUint256(value?.maximumVerificationGas, `${path}.maximumVerificationGas`, add);
  equal(value?.validFromEnforced, true, `${path}.validFromEnforced`, add);
  equal(value?.expiresAtEnforced, true, `${path}.expiresAtEnforced`, add);
  oneOf(value?.marketStatusPolicy, ["bound-and-reject-unsupported"], `${path}.marketStatusPolicy`, add);
  oneOf(value?.ripcordPolicy, ["bound-and-fail-closed"], `${path}.ripcordPolicy`, add);
  pattern(value?.billingRoute, SLUG, `${path}.billingRoute`, add);
  equal(value?.credentials, "backend-only", `${path}.credentials`, add);
  if (status === "deployment-evidence-declared") requireRolesOnChain(deployments, value?.chainId, ["verifier"], path, add);
}

function validateCre(value, evidence, path, add) {
  exactObject(value, [
    "language", "typescriptRuntime", "sdkVersion", "compilerVersion", "workflowId", "workflowArtifactSha256", "configSha256",
    "targetId", "donId", "triggerType", "randomnessSource", "runtimeTimeOnly", "floatingPointEconomicArithmeticForbidden",
    "networkWorkBounded", "reportVerificationBound", "retryIdempotent", "localSimulationProof"
  ], path, add);
  oneOf(value?.language, ["go", "typescript"], `${path}.language`, add);
  if (value?.language === "typescript") {
    equal(value?.typescriptRuntime, "quickjs-wasm", `${path}.typescriptRuntime`, add);
    equal(value?.randomnessSource, "not-used", `${path}.randomnessSource`, add);
  } else if (value?.language === "go") {
    equal(value?.typescriptRuntime, null, `${path}.typescriptRuntime`, add);
    oneOf(value?.randomnessSource, ["cre-runtime-rand", "not-used"], `${path}.randomnessSource`, add);
  }
  for (const key of ["sdkVersion", "compilerVersion"]) pattern(value?.[key], VERSION, `${path}.${key}`, add);
  for (const key of ["workflowId", "targetId", "donId", "triggerType"]) pattern(value?.[key], SLUG, `${path}.${key}`, add);
  pattern(value?.workflowArtifactSha256, SHA256, `${path}.workflowArtifactSha256`, add);
  pattern(value?.configSha256, SHA256, `${path}.configSha256`, add);
  requireEvidenceDigest(evidence, value?.workflowArtifactSha256, ["source"], `${path}.workflowArtifactSha256`, add);
  requireEvidenceDigest(evidence, value?.configSha256, ["config"], `${path}.configSha256`, add);
  for (const key of ["runtimeTimeOnly", "floatingPointEconomicArithmeticForbidden", "networkWorkBounded", "reportVerificationBound", "retryIdempotent"]) equal(value?.[key], true, `${path}.${key}`, add);
  equal(value?.localSimulationProof, "single-node-only", `${path}.localSimulationProof`, add);
}

function requireRolesOnChain(deployments, chainId, requiredRoles, path, add) {
  const deployment = Array.isArray(deployments) ? deployments.find((entry) => entry?.chainId === chainId) : null;
  if (!deployment) {
    add(path, `requires deployment for chain ${typeof chainId === "string" ? chainId : "<invalid>"}`);
    return;
  }
  const roles = Array.isArray(deployment.contractRoles) ? deployment.contractRoles.map((role) => role?.role) : [];
  for (const role of requiredRoles) if (!roles.includes(role)) add(path, `chain ${chainId} requires exact ${role} deployment role`);
}

function requireRoleAddress(deployments, chainId, roleName, expectedAddress, path, add) {
  const deployment = Array.isArray(deployments) ? deployments.find((entry) => entry?.chainId === chainId) : null;
  const role = Array.isArray(deployment?.contractRoles) ? deployment.contractRoles.find((entry) => entry?.role === roleName) : null;
  if (role?.address !== expectedAddress) add(path, `must equal the ${roleName} deployment role address on chain ${typeof chainId === "string" ? chainId : "<invalid>"}`);
}

function requireEvidenceDigest(evidence, digest, kinds, path, add) {
  if (!Array.isArray(evidence) || !evidence.some((entry) => entry?.sha256 === digest && kinds.includes(entry?.kind))) {
    add(path, `must bind an evidence artifact of kind: ${kinds.join(", ")}`);
  }
}

function requireEvidenceKind(evidence, kind, path, add) {
  if (!Array.isArray(evidence) || !evidence.some((entry) => entry?.kind === kind)) add(path, `requires a ${kind} artifact`);
}

function validateArtifactBindings(value, path, add) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 64) {
    add(path, "must contain 1..64 content-addressed artifact bindings");
    return;
  }
  const paths = value.map((entry) => entry?.path);
  if (bytewiseOrderInvalid(paths)) add(path, "must be unique and sorted by artifact path");
  for (const [index, entry] of value.entries()) validateArtifactBinding(entry, `${path}[${index}]`, add);
}

function validateArtifactBinding(value, path, add) {
  exactObject(value, ["path", "sha256", "kind"], path, add);
  pattern(value?.path, PORTABLE_PATH, `${path}.path`, add);
  pattern(value?.sha256, SHA256, `${path}.sha256`, add);
  oneOf(value?.kind, ["config", "dependency-lock", "deployment", "receipt", "review", "runtime", "schema", "simulation", "source", "test"], `${path}.kind`, add);
}

function validateSortedUniqueUint256(value, path, add) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 16) {
    add(path, "must contain 1..16 target chain ids");
    return;
  }
  for (const [index, entry] of value.entries()) positiveUint256(entry, `${path}[${index}]`, add);
  if (bytewiseNumericOrderInvalid(value)) add(path, "must be unique and numerically sorted");
}

function validateSortedUniqueEnum(value, allowed, path, add) {
  if (!Array.isArray(value) || value.length === 0) {
    add(path, "must be a non-empty array");
    return;
  }
  for (const [index, entry] of value.entries()) oneOf(entry, allowed, `${path}[${index}]`, add);
  if (bytewiseOrderInvalid(value)) add(path, "must be unique and bytewise sorted");
}

function exactObject(value, keys, path, add) {
  if (!isObject(value)) {
    add(path, "must be an object");
    return false;
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) add(path, `must contain exactly: ${expected.join(", ")}`);
  return true;
}

function pattern(value, expression, path, add) {
  if (typeof value !== "string" || !expression.test(value)) add(path, "has invalid format");
}

function oneOf(value, allowed, path, add) {
  if (!allowed.includes(value)) add(path, `must be one of: ${allowed.join(", ")}`);
}

function equal(actual, expected, path, add) {
  if (actual !== expected) add(path, `must equal ${expected}`);
}

function positiveUint256(value, path, add) {
  pattern(value, UINT, path, add);
  if (typeof value === "string" && UINT.test(value) && (BigInt(value) === 0n || BigInt(value) > UINT256_MAX)) add(path, "must be in uint256 range 1..2^256-1");
}

function positiveUintBound(value, maximum, path, add) {
  pattern(value, UINT, path, add);
  if (typeof value === "string" && UINT.test(value) && (BigInt(value) === 0n || BigInt(value) > maximum)) add(path, `must be in range 1..${maximum}`);
}

function signedInt256(value, path, add) {
  pattern(value, INT, path, add);
  if (validSigned(value)) {
    const parsed = BigInt(value);
    if (parsed < -(1n << 255n) || parsed > (1n << 255n) - 1n) add(path, "must fit int256");
  }
}

function boundedInteger(value, minimum, maximum, path, add) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) add(path, `must be an integer from ${minimum} through ${maximum}`);
}

function boundedText(value, minimum, maximum, path, add) {
  if (typeof value !== "string" || value.length < minimum || value.length > maximum || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) add(path, `must be ${minimum}..${maximum} printable characters`);
}

function validSigned(value) {
  return typeof value === "string" && INT.test(value);
}

function validUnsigned(value) {
  return typeof value === "string" && UINT.test(value);
}

function bytewiseOrderInvalid(values) {
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string")) return true;
  return new Set(values).size !== values.length || values.some((value, index) => index > 0 && Buffer.compare(Buffer.from(values[index - 1]), Buffer.from(value)) >= 0);
}

function bytewiseNumericOrderInvalid(values) {
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string" || !UINT.test(value))) return true;
  return new Set(values).size !== values.length || values.some((value, index) => index > 0 && BigInt(values[index - 1]) >= BigInt(value));
}

function requireTrueObject(value, keys, path, add) {
  exactObject(value, keys, path, add);
  for (const key of keys) equal(value?.[key], true, `${path}.${key}`, add);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function reporter(errors) {
  return (path, message) => errors.push(`${path}: ${message}`);
}
