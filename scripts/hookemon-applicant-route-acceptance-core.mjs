import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { parseBoundedLosslessJson } from "../skills/programmable-v4-hook-builder/scripts/github-public-source-core.mjs";
import {
  CANONICAL_JSON_V2_PROFILE,
  canonicalJsonBytesV2
} from "../skills/programmable-v4-hook-builder/scripts/canonical-json-core.mjs";
import {
  checksumAddress,
  keccak256Bytes,
  keccak256Hex
} from "../skills/programmable-v4-hook-builder/scripts/evm-encoding-core.mjs";
import { validateAgainstSchema } from "../skills/programmable-v4-hook-builder/scripts/restricted-json-schema-core.mjs";

export const HOOKEMON_ROUTE_ACCEPTANCE_SCHEMA_VERSION = "1.0.0";
export const HOOKEMON_PLATFORM_CAPABILITY_OVERLAY_TYPE =
  "urn:programmable:hookemon-platform-capability-overlay:1.0.0";
export const HOOKEMON_ROUTE_ACCEPTANCE_CLAIM_TYPE =
  "urn:programmable:hookemon-applicant-route-acceptance:1.0.0";
export const HOOKEMON_APPLICATION_ACCEPTANCE_SUBJECT_TYPE =
  "programmable.hookemon-application-acceptance-subject.v1";
export const HOOKEMON_ROUTE_ACCEPTANCE_TRANSITION_TYPE =
  "programmable.hookemon-route-acceptance-transition.v1";
export const HOOKEMON_PLATFORM_CAPABILITY_ID =
  "exact-hookemon-completed-graph-adoption";
export const HOOKEMON_PLATFORM_CAPABILITY_VERSION = "1.0.0";
export const HOOKEMON_ROUTE_ACCEPTANCE_CANONICALIZATION = CANONICAL_JSON_V2_PROFILE.id;
export const HOOKEMON_ROUTE_ACCEPTANCE_PENDING_STATE =
  "disabled-pending-final-hashes";
export const MAXIMUM_HOOKEMON_ROUTE_ACCEPTANCE_BYTES = 64 * 1024;
export const HOOKEMON_PENDING_ACCEPTANCE_FIXTURE_SHA256 =
  "sha256:25e5a71c8e09b31f2f4f5eb7bdbbafac1efc1f2a89042b058bacfec9844d1aed";

// Activation deliberately requires a later reviewed change that replaces both
// sentinels with one immutable public claim. A populated candidate cannot make
// this pending overlay executable by itself.
export const HOOKEMON_FROZEN_ACCEPTANCE_CLAIM_SHA256 = null;
export const HOOKEMON_ACTIVE_CAPABILITY_STATE = null;

const EXPECTED_REQUIRED_PLATFORM_GATES = Object.freeze([
  "authority-compiler",
  "mainnet-currentness",
  "profile-security",
  "router-contract",
  "stage",
  "website-build"
]);

const FORBIDDEN_PROFILE_IDS = new Set([
  "direct-graph",
  "exact-shards-nested-factory"
]);
const STALE_HOOKEMON_PR_HEAD = "1ffc1fd19a9d890760911629942fbb109b7ec183";
const STALE_HOOKEMON_SOURCE_COMMIT = "23336e60ae5859dbb0ae9c0db3399af4ef4af8e8";
const STALE_HOOKEMON_SOURCE_TREE = "7624bde3bb09f654e77881880c419e356ed85c29";
const STALE_HOOKEMON_APPLICATION_MANIFEST_SHA256 =
  "sha256:ef8e6d36a5ea9e40c80e32b961d827ec76c4aa9102f6001587fcf4a2c59f67d8";

export const HOOKEMON_FINAL_BINDING_PATHS = Object.freeze([
  "$.capability.acceptedRoute.routeVersion",
  "$.capability.profile.profileId",
  "$.capability.profile.profileVersion",
  "$.capability.profile.profileKey",
  "$.reviewedRequest.finalHeadCommit",
  "$.reviewedRequest.applicationManifestSha256",
  "$.source.commit",
  "$.source.tree",
  "$.applicantActions[0].spender",
  "$.applicantActions[0].amountBaseUnits",
  "$.applicantActions[0].nonce",
  "$.applicantActions[0].gasLimit",
  "$.applicantActions[0].calldataSha256",
  "$.applicantActions[0].finalityBlocks",
  "$.applicantActions[1].nonce",
  "$.applicantActions[1].gasLimit",
  "$.applicantActions[1].initCodeSha256",
  "$.applicantActions[1].initCodeKeccak256",
  "$.applicantActions[1].expectedContractAddress",
  "$.applicantActions[1].expectedRuntimeCodeHash",
  "$.applicantActions[1].finalityBlocks",
  "$.applicantActions[2].to",
  "$.applicantActions[2].selector",
  "$.applicantActions[2].nonce",
  "$.applicantActions[2].gasLimit",
  "$.applicantActions[2].calldataSha256",
  "$.applicantActions[2].permitDigest",
  "$.applicantActions[2].currentnessHash",
  "$.applicantActions[2].expectedStampHash",
  "$.applicantActions[2].finalityBlocks",
  "$.immutableBindings.intake.mergeCommit",
  "$.immutableBindings.intake.mergeTree",
  "$.immutableBindings.intake.requestBlobSha256",
  "$.immutableBindings.sourceEvidence.reviewEvidenceSha256",
  "$.immutableBindings.sourceEvidence.artifactCodeLedgerSha256",
  "$.immutableBindings.sourceEvidence.codeHashesSha256",
  "$.immutableBindings.sourceEvidence.returnDeltaDispositionSha256",
  "$.immutableBindings.sourceEvidence.inlineAssemblyDispositionSha256",
  "$.immutableBindings.sourceEvidence.mainnetForkReceiptSha256",
  "$.immutableBindings.sourceEvidence.gasReceiptSha256",
  "$.immutableBindings.sourceEvidence.independentReviewSha256",
  "$.immutableBindings.reviewedPlan.planSchemaId",
  "$.immutableBindings.reviewedPlan.reviewedPlanSha256",
  "$.immutableBindings.reviewedPlan.profileManifestSha256",
  "$.immutableBindings.reviewedPlan.profileSchemaSha256",
  "$.immutableBindings.reviewedPlan.architecturePolicyHash",
  "$.immutableBindings.reviewedPlan.revenuePolicyHash",
  "$.immutableBindings.platformContracts.sourceCommit",
  "$.immutableBindings.platformContracts.sourceTree",
  "$.immutableBindings.platformContracts.kernelContractPath",
  "$.immutableBindings.platformContracts.kernelAbiSha256",
  "$.immutableBindings.platformContracts.kernelCreationCodeHash",
  "$.immutableBindings.platformContracts.kernelRuntimeCodeHash",
  "$.immutableBindings.platformContracts.kernelAddress",
  "$.immutableBindings.platformContracts.kernelDeploymentReceiptSha256",
  "$.immutableBindings.platformContracts.routerContractPath",
  "$.immutableBindings.platformContracts.routerAbiSha256",
  "$.immutableBindings.platformContracts.routerCreationCodeHash",
  "$.immutableBindings.platformContracts.routerRuntimeCodeHash",
  "$.immutableBindings.platformContracts.routerAddress",
  "$.immutableBindings.platformContracts.routerDeploymentReceiptSha256",
  "$.immutableBindings.platformContracts.profileContractPath",
  "$.immutableBindings.platformContracts.profileAbiSha256",
  "$.immutableBindings.platformContracts.profileCreationCodeHash",
  "$.immutableBindings.platformContracts.profileRuntimeCodeHash",
  "$.immutableBindings.platformContracts.profileAddress",
  "$.immutableBindings.platformContracts.profileDeploymentReceiptSha256",
  "$.immutableBindings.platformContracts.registryContractPath",
  "$.immutableBindings.platformContracts.registryAbiSha256",
  "$.immutableBindings.platformContracts.registryCreationCodeHash",
  "$.immutableBindings.platformContracts.registryAddress",
  "$.immutableBindings.platformContracts.registryRuntimeCodeHash",
  "$.immutableBindings.platformContracts.registryDeploymentReceiptSha256",
  "$.immutableBindings.architecture.position.manager",
  "$.immutableBindings.architecture.position.tokenId",
  "$.immutableBindings.architecture.position.owner",
  "$.immutableBindings.architecture.position.positionTimelock",
  "$.immutableBindings.architecture.position.poolKeyHash",
  "$.immutableBindings.architecture.position.tickLower",
  "$.immutableBindings.architecture.position.tickUpper",
  "$.immutableBindings.architecture.position.liquidity",
  "$.immutableBindings.architecture.position.dustHash",
  "$.immutableBindings.architecture.position.evidenceSha256",
  "$.immutableBindings.architecture.supportGraph.nodeCount",
  "$.immutableBindings.architecture.supportGraph.exclusiveComponentCount",
  "$.immutableBindings.architecture.supportGraph.sharedSupportNodeCount",
  "$.immutableBindings.architecture.supportGraph.factoryCount",
  "$.immutableBindings.architecture.supportGraph.codeChunkCount",
  "$.immutableBindings.architecture.supportGraph.topologyLedgerSha256",
  "$.immutableBindings.architecture.supportGraph.orderedFactoryChunkVectorSha256",
  "$.immutableBindings.architecture.architectureResultHash",
  "$.immutableBindings.architecture.currentArchitectureStateHash",
  "$.immutableBindings.architecture.currentnessHash",
  "$.immutableBindings.route.routePayloadHash",
  "$.immutableBindings.route.expectedResultHash",
  "$.immutableBindings.route.launchId",
  "$.immutableBindings.route.stampRequestHash",
  "$.immutableBindings.route.actionPlanSha256",
  "$.immutableBindings.authorityFacade.sourceCommit",
  "$.immutableBindings.authorityFacade.sourceTree",
  "$.immutableBindings.authorityFacade.sourceRepository",
  "$.immutableBindings.authorityFacade.sourceRepositoryId",
  "$.immutableBindings.authorityFacade.manifestSha256",
  "$.immutableBindings.authorityFacade.authorityContractPath",
  "$.immutableBindings.authorityFacade.authorityAbiSha256",
  "$.immutableBindings.authorityFacade.authorityCreationCodeHash",
  "$.immutableBindings.authorityFacade.authorityRuntimeCodeHash",
  "$.immutableBindings.authorityFacade.authorityAddress",
  "$.immutableBindings.authorityFacade.authorityDeploymentReceiptSha256",
  "$.immutableBindings.authorityFacade.facadeContractPath",
  "$.immutableBindings.authorityFacade.facadeAbiSha256",
  "$.immutableBindings.authorityFacade.facadeCreationCodeHash",
  "$.immutableBindings.authorityFacade.facadeRuntimeCodeHash",
  "$.immutableBindings.authorityFacade.facadeAddress",
  "$.immutableBindings.authorityFacade.facadeDeploymentReceiptSha256",
  "$.immutableBindings.authorityFacade.adoptionSelector",
  "$.immutableBindings.authorityFacade.policyHash",
  "$.immutableBindings.authorityFacade.currentnessHash",
  "$.immutableBindings.publicAcceptance.schemaSha256",
  "$.immutableBindings.publicAcceptance.claimUrl",
  "$.immutableBindings.publicAcceptance.claimSha256",
  "$.immutableBindings.publicAcceptance.recordUrl",
  "$.immutableBindings.publicAcceptance.recordSha256",
  "$.immutableBindings.publicAcceptance.transitionHash",
  "$.immutableBindings.platformAttestation.url",
  "$.immutableBindings.platformAttestation.sha256",
  "$.immutableBindings.platformAttestation.keyId",
  "$.immutableBindings.platformAttestation.publicKeyPemSha256",
  "$.immutableBindings.platformAttestation.payloadSha256",
  "$.immutableBindings.platformAttestation.signatureSha256",
  "$.immutableBindings.platformAttestation.releaseCommit",
  "$.immutableBindings.platformAttestation.releaseTree",
  "$.immutableBindings.platformAttestation.releaseManifestSha256",
  "$.immutableBindings.platformAttestation.profileBindingSha256",
  "$.immutableBindings.platformAttestation.gateReceiptsSha256",
  "$.immutableBindings.platformAttestation.issuedAt",
  "$.immutableBindings.platformAttestation.expiresAt"
]);

export function loadHookemonRouteAcceptanceSchema(repositoryRoot) {
  return JSON.parse(fs.readFileSync(
    path.join(
      repositoryRoot,
      "submissions",
      "schema",
      "hookemon-applicant-route-acceptance-v1.schema.json"
    ),
    "utf8"
  ));
}

export function parseHookemonRouteAcceptance(bytes) {
  if (!Buffer.isBuffer(bytes)) {
    throw new TypeError("Hookemon route acceptance bytes must be a Buffer");
  }
  if (bytes.length === 0 || bytes.length > MAXIMUM_HOOKEMON_ROUTE_ACCEPTANCE_BYTES) {
    throw new Error(
      `Hookemon route acceptance must contain 1 to ${MAXIMUM_HOOKEMON_ROUTE_ACCEPTANCE_BYTES} bytes`
    );
  }
  const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  parseBoundedLosslessJson(source);
  return JSON.parse(source);
}

export function validateHookemonRouteAcceptance(value, schema, { now = null } = {}) {
  const findings = validateAgainstSchema(value, schema).map((finding) => ({
    ...finding,
    remediation:
      "Make the claim match submissions/schema/hookemon-applicant-route-acceptance-v1.schema.json."
  }));
  const add = (code, field, message, remediation) => findings.push({
    severity: "blocker",
    code,
    path: field,
    message,
    remediation
  });
  if (findings.length > 0 || !isObject(value)) return findings;

  if (FORBIDDEN_PROFILE_IDS.has(value.capability.profile.profileId)) {
    add(
      "HOOKEMON_PROFILE_SUBSTITUTION_FORBIDDEN",
      "$.capability.profile.profileId",
      "Hookemon cannot be represented by the direct-graph or exact Shards profile.",
      "Bind the frozen Hookemon-specific completed-graph adoption profile."
    );
  }
  if (
    value.capability.acceptedRoute.routeId !== "completed-graph-adoption"
    || value.capability.acceptedRoute.chainId !== "1"
  ) {
    add(
      "HOOKEMON_ROUTE_SUBSTITUTION_FORBIDDEN",
      "$.capability.acceptedRoute",
      "Hookemon acceptance requires the typed Mainnet completed-graph adoption route.",
      "Do not substitute custom-graph, nested-factory, Classic, or arbitrary-call execution."
    );
  }
  if (
    value.source.commit === STALE_HOOKEMON_SOURCE_COMMIT
    || value.source.tree === STALE_HOOKEMON_SOURCE_TREE
    || value.reviewedRequest.applicationManifestSha256
      === STALE_HOOKEMON_APPLICATION_MANIFEST_SHA256
  ) {
    add(
      "HOOKEMON_STALE_SOURCE_BINDING",
      "$.source",
      "The pre-rebind Hookemon source/evidence identity cannot satisfy this capability.",
      "Use the final exact S2/P source commit, tree, and recomputed applicationManifest SHA-256."
    );
  }
  if (value.reviewedRequest.finalHeadCommit === STALE_HOOKEMON_PR_HEAD) {
    add(
      "HOOKEMON_STALE_PR_HEAD_BINDING",
      "$.reviewedRequest.finalHeadCommit",
      "The original Draft PR head has no exact-head admission CI and cannot be frozen.",
      "Bind the final rebased Hookemon applicant head after the platform overlay and exact source revision are public."
    );
  }

  const [approval, create, adoption] = value.applicantActions;
  if (approval.kind !== "ERC20_APPROVAL" || approval.ordinal !== 1) {
    add(
      "HOOKEMON_ACTION_ORDER_INVALID",
      "$.applicantActions[0]",
      "The first applicant transaction must be the exact USDC approval.",
      "Keep the fixed approval, normal CREATE, adoption order."
    );
  }
  if (
    create.kind !== "EOA_CREATE"
    || create.ordinal !== 2
    || create.to !== null
    || create.selector !== null
  ) {
    add(
      "HOOKEMON_CREATE_ACTION_INVALID",
      "$.applicantActions[1]",
      "The second applicant transaction must be a normal EOA CREATE with to=null and no selector.",
      "Do not wrap the applicant CREATE in a factory or opaque arbitrary call."
    );
  }
  if (adoption.kind !== "COMPLETED_GRAPH_ADOPTION" || adoption.ordinal !== 3) {
    add(
      "HOOKEMON_ACTION_ORDER_INVALID",
      "$.applicantActions[2]",
      "The third applicant transaction must be the typed completed-graph adoption call.",
      "Keep the fixed approval, normal CREATE, adoption order."
    );
  }
  if (adoption.selector !== null && !/^0x[0-9a-f]{8}$/u.test(adoption.selector)) {
    add(
      "HOOKEMON_ADOPTION_SELECTOR_INVALID",
      "$.applicantActions[2].selector",
      "The adoption selector must be exactly four bytes.",
      "Bind the selector exported by the frozen completed-graph adoption ABI."
    );
  }
  if (
    approval.nonce !== null
    && create.nonce !== null
    && adoption.nonce !== null
    && (create.nonce !== approval.nonce + 1 || adoption.nonce !== create.nonce + 1)
  ) {
    add(
      "HOOKEMON_ACTION_NONCES_NOT_CONTIGUOUS",
      "$.applicantActions",
      "Applicant action nonces must be exact and contiguous in the reviewed three-transaction plan.",
      "Refresh currentness and bind N, N+1, and N+2 immediately before wallet confirmation."
    );
  }
  if (
    approval.spender !== null
    && create.expectedContractAddress !== null
    && approval.spender !== create.expectedContractAddress
  ) {
    add(
      "HOOKEMON_APPROVAL_SPENDER_MISMATCH",
      "$.applicantActions[0].spender",
      "The exact USDC approval spender must be the normal-CREATE AtomicLauncher address.",
      "Bind approval.spender to the address derived from applicant wallet and CREATE nonce."
    );
  }
  if (create.nonce !== null && create.expectedContractAddress !== null) {
    const derivedCreateAddress = deriveCreateAddress(value.applicant.launchWallet, create.nonce);
    if (create.expectedContractAddress !== derivedCreateAddress) {
      add(
        "HOOKEMON_CREATE_ADDRESS_MISMATCH",
        "$.applicantActions[1].expectedContractAddress",
        "AtomicLauncher address does not equal CREATE(applicant wallet, transaction nonce).",
        `Use the independently derived normal-CREATE address ${derivedCreateAddress}.`
      );
    }
  }

  const authorityFacade = value.immutableBindings.authorityFacade;
  if (
    adoption.to !== null
    && authorityFacade.facadeAddress !== null
    && adoption.to !== authorityFacade.facadeAddress
  ) {
    add(
      "HOOKEMON_ADOPTION_TARGET_MISMATCH",
      "$.applicantActions[2].to",
      "The typed adoption transaction target must be the frozen Hookemon Facade.",
      "Bind the action target to authorityFacade.facadeAddress."
    );
  }
  if (
    adoption.selector !== null
    && authorityFacade.adoptionSelector !== null
    && adoption.selector !== authorityFacade.adoptionSelector
  ) {
    add(
      "HOOKEMON_ADOPTION_SELECTOR_MISMATCH",
      "$.applicantActions[2].selector",
      "The adoption action selector differs from the frozen Facade ABI selector.",
      "Bind both fields to the selector derived from the frozen Facade ABI."
    );
  }
  if (
    adoption.selector === "0x00000000"
    || authorityFacade.adoptionSelector === "0x00000000"
  ) {
    add(
      "HOOKEMON_ADOPTION_SELECTOR_ZERO",
      "$.applicantActions[2].selector",
      "The zero selector cannot identify the typed Hookemon adoption entrypoint.",
      "Use the nonzero selector derived from the frozen Facade ABI."
    );
  }

  const position = value.immutableBindings.architecture.position;
  if (value.immutableBindings.architecture.exclusiveNftAddress !== null) {
    add(
      "HOOKEMON_EXCLUSIVE_NFT_FORBIDDEN",
      "$.immutableBindings.architecture.exclusiveNftAddress",
      "Hookemon has no exclusive NFT contract; PositionManager cannot be stamped as one.",
      "Keep nft=null and bind the shared PositionManager token through the typed custody vector."
    );
  }
  if (
    position.owner !== null
    && position.positionTimelock !== null
    && position.owner !== position.positionTimelock
  ) {
    add(
      "HOOKEMON_POSITION_CUSTODY_MISMATCH",
      "$.immutableBindings.architecture.position",
      "The reviewed position owner must be the exact PositionTimelock.",
      "Recompute ownerOf(tokenId) and bind the matching timelock address."
    );
  }
  if (
    position.tickLower !== null
    && position.tickUpper !== null
    && position.tickLower >= position.tickUpper
  ) {
    add(
      "HOOKEMON_POSITION_TICKS_INVALID",
      "$.immutableBindings.architecture.position",
      "The reviewed position tick range must be strictly increasing.",
      "Bind the exact live tickLower and tickUpper values from PositionManager state."
    );
  }

  const graph = value.immutableBindings.architecture.supportGraph;
  if (
    graph.nodeCount !== null
    && graph.exclusiveComponentCount !== null
    && graph.sharedSupportNodeCount !== null
    && graph.codeChunkCount !== null
    && graph.nodeCount
      !== graph.exclusiveComponentCount + graph.sharedSupportNodeCount + graph.codeChunkCount
  ) {
    add(
      "HOOKEMON_SUPPORT_GRAPH_COUNT_MISMATCH",
      "$.immutableBindings.architecture.supportGraph",
      "Support-graph nodeCount does not equal exclusive, shared-support, and ordered CodeChunk nodes.",
      "Rebuild the final topology ledger and bind its exact independently recomputable counts."
    );
  }
  if (
    graph.factoryCount !== null
    && graph.codeChunkCount !== null
    && graph.codeChunkCount < graph.factoryCount
  ) {
    add(
      "HOOKEMON_CODE_CHUNK_VECTOR_INCOMPLETE",
      "$.immutableBindings.architecture.supportGraph",
      "Every fixed factory requires a non-empty ordered CodeChunk vector.",
      "Bind the variable per-factory chunk vectors instead of assuming exactly one global fixed count."
    );
  }

  if (!sameJson(
    value.immutableBindings.platformAttestation.requiredGates,
    EXPECTED_REQUIRED_PLATFORM_GATES
  )) {
    add(
      "HOOKEMON_PLATFORM_GATES_MISMATCH",
      "$.immutableBindings.platformAttestation.requiredGates",
      "Platform attestation must bind the six protected applicant-gate receipts in sorted order.",
      `Use ${EXPECTED_REQUIRED_PLATFORM_GATES.join(", ")}.`
    );
  }
  const { issuedAt, expiresAt } = value.immutableBindings.platformAttestation;
  if (issuedAt !== null && expiresAt !== null) {
    if (!isCanonicalMillisecondTimestamp(issuedAt) || !isCanonicalMillisecondTimestamp(expiresAt)) {
      add(
        "HOOKEMON_PLATFORM_ATTESTATION_TIMESTAMP_INVALID",
        "$.immutableBindings.platformAttestation",
        "Platform attestation timestamps must be exact canonical UTC timestamps with milliseconds.",
        "Use YYYY-MM-DDTHH:mm:ss.sssZ values from the signed Ed25519 payload."
      );
    }
    const lifetimeMilliseconds = Date.parse(expiresAt) - Date.parse(issuedAt);
    if (lifetimeMilliseconds <= 0 || lifetimeMilliseconds > 31 * 24 * 60 * 60 * 1000) {
      add(
        "HOOKEMON_PLATFORM_ATTESTATION_LIFETIME_INVALID",
        "$.immutableBindings.platformAttestation",
        "Platform attestation expiry must follow issuance and be no more than 31 days later.",
        "Use the exact canonical issuance and expiry timestamps from the frozen Ed25519 payload."
      );
    }
    if (now !== null) {
      const nowMilliseconds = assessmentTimeMilliseconds(now);
      if (Date.parse(issuedAt) > nowMilliseconds + 5 * 60 * 1000) {
        add(
          "HOOKEMON_PLATFORM_ATTESTATION_NOT_YET_VALID",
          "$.immutableBindings.platformAttestation.issuedAt",
          "Platform attestation issuance is more than five minutes in the future.",
          "Refresh the signed attestation against the current production clock."
        );
      }
      if (Date.parse(expiresAt) <= nowMilliseconds) {
        add(
          "HOOKEMON_PLATFORM_ATTESTATION_EXPIRED",
          "$.immutableBindings.platformAttestation.expiresAt",
          "Platform attestation has expired at assessment time.",
          "Publish and bind a fresh exact-release Ed25519 attestation before acceptance."
        );
      }
    }
  }
  if (
    authorityFacade.sourceRepository !== null
    && !authorityFacade.sourceRepository.startsWith("https://github.com/0xprogrammable/")
  ) {
    add(
      "HOOKEMON_AUTHORITY_SOURCE_OWNER_INVALID",
      "$.immutableBindings.authorityFacade.sourceRepository",
      "Authority and Facade source must be pinned in an 0xprogrammable GitHub repository.",
      "Bind the exact public canonical source repository and numeric repository ID."
    );
  }
  for (const field of [
    "$.immutableBindings.publicAcceptance.claimUrl",
    "$.immutableBindings.publicAcceptance.recordUrl",
    "$.immutableBindings.platformAttestation.url"
  ]) {
    const candidate = getPath(value, field);
    if (candidate !== null && !candidate.startsWith("https://")) {
      add(
        "HOOKEMON_PUBLIC_ARTIFACT_URL_INVALID",
        field,
        "Public acceptance and attestation artifacts require HTTPS URLs.",
        "Publish the immutable artifact over HTTPS and bind its exact SHA-256 digest."
      );
    }
  }

  for (const field of addressPaths(value)) {
    const address = getPath(value, field);
    if (address === null) continue;
    try {
      if (checksumAddress(address, { label: field }) !== address) {
        add(
          "HOOKEMON_ADDRESS_NOT_CANONICAL",
          field,
          "Address is not in its exact EIP-55 form.",
          "Use the checksummed address from the frozen binding."
        );
      }
    } catch {
      add(
        "HOOKEMON_ADDRESS_INVALID",
        field,
        "Address is not a valid Ethereum address.",
        "Use the exact checksummed address from the frozen binding."
      );
    }
  }

  for (const field of HOOKEMON_FINAL_BINDING_PATHS) {
    const candidate = getPath(value, field);
    if (
      candidate === `sha256:${"0".repeat(64)}`
      || candidate === `0x${"0".repeat(64)}`
      || candidate === `0x${"0".repeat(40)}`
      || candidate === "0".repeat(40)
    ) {
      add(
        "HOOKEMON_ZERO_FINAL_BINDING",
        field,
        "A zero placeholder cannot satisfy an immutable Hookemon binding.",
        "Bind the exact nonzero source, artifact, deployment, action, or attestation value."
      );
    }
  }

  const publicAcceptance = value.immutableBindings.publicAcceptance;
  if (publicAcceptance.claimSha256 !== null) {
    const projectedClaimSha256 = hookemonPublicRouteAcceptanceClaimHash(value);
    if (publicAcceptance.claimSha256 !== projectedClaimSha256) {
      add(
        "HOOKEMON_PUBLIC_ACCEPTANCE_CLAIM_MISMATCH",
        "$.immutableBindings.publicAcceptance.claimSha256",
        "Public Website acceptance digest does not match the deterministic Hookemon claim projection.",
        "Publish the canonical claim projection and bind its exact SHA-256 digest."
      );
    }
  }
  if (publicAcceptance.transitionHash !== null) {
    const projectedTransitionHash = hookemonPublicRouteAcceptanceTransitionHash(value);
    if (publicAcceptance.transitionHash !== projectedTransitionHash) {
      add(
        "HOOKEMON_PUBLIC_ACCEPTANCE_TRANSITION_MISMATCH",
        "$.immutableBindings.publicAcceptance.transitionHash",
        "Public Website acceptance transition hash does not match the deterministic Hookemon projection.",
        "Recompute the Canonical JSON V2 transition keccak256 from the frozen overlay."
      );
    }
  }

  return findings;
}

export function pendingHookemonFinalBindingPaths(value) {
  return HOOKEMON_FINAL_BINDING_PATHS.filter((field) => getPath(value, field) === null);
}

export function assessHookemonRouteAcceptance(value, schema, { now = new Date() } = {}) {
  const findings = validateHookemonRouteAcceptance(value, schema, { now });
  if (findings.length > 0) {
    return deepFreeze({
      status: "HOOKEMON_CAPABILITY_INVALID",
      activationAllowed: false,
      claimSha256: null,
      pendingFinalBindingPaths: [],
      findings
    });
  }

  const claimSha256 = hookemonRouteAcceptanceClaimHash(value);
  const pendingFinalBindingPaths = pendingHookemonFinalBindingPaths(value);
  if (pendingFinalBindingPaths.length > 0) {
    return deepFreeze({
      status: "HOOKEMON_CAPABILITY_PENDING_FINAL_HASHES",
      activationAllowed: false,
      claimSha256,
      pendingFinalBindingPaths,
      findings: []
    });
  }
  if (
    HOOKEMON_FROZEN_ACCEPTANCE_CLAIM_SHA256 === null
    || HOOKEMON_ACTIVE_CAPABILITY_STATE === null
    || value.capability.activationState !== HOOKEMON_ACTIVE_CAPABILITY_STATE
    || value.capability.catalogIntegrated !== true
  ) {
    return deepFreeze({
      status: "HOOKEMON_CAPABILITY_PENDING_FROZEN_CLAIM",
      activationAllowed: false,
      claimSha256,
      pendingFinalBindingPaths: [],
      findings: []
    });
  }
  if (claimSha256 !== HOOKEMON_FROZEN_ACCEPTANCE_CLAIM_SHA256) {
    return deepFreeze({
      status: "HOOKEMON_CAPABILITY_FROZEN_CLAIM_MISMATCH",
      activationAllowed: false,
      claimSha256,
      pendingFinalBindingPaths: [],
      findings: []
    });
  }
  return deepFreeze({
    status: "HOOKEMON_CAPABILITY_ACTIVE",
    activationAllowed: true,
    claimSha256,
    pendingFinalBindingPaths: [],
    findings: []
  });
}

export function assertHookemonRouteAcceptanceActive(value, schema, options = {}) {
  const assessment = assessHookemonRouteAcceptance(value, schema, options);
  if (!assessment.activationAllowed) {
    throw new TypeError(`Hookemon route acceptance is not active: ${assessment.status}`);
  }
  return assessment;
}

export function canonicalHookemonRouteAcceptanceBytes(value) {
  return canonicalJsonBytesV2(value, { trailingNewline: false });
}

export function hookemonRouteAcceptanceClaimHash(value) {
  return `sha256:${crypto.createHash("sha256")
    .update(canonicalHookemonRouteAcceptanceBytes(value))
    .digest("hex")}`;
}

export function hookemonPublicRouteAcceptanceClaimV1(value) {
  const immutableBindings = structuredClone(value.immutableBindings);
  delete immutableBindings.publicAcceptance;
  return deepFreeze({
    $schema: HOOKEMON_ROUTE_ACCEPTANCE_CLAIM_TYPE,
    schemaVersion: HOOKEMON_ROUTE_ACCEPTANCE_SCHEMA_VERSION,
    subject: {
      schemaVersion: HOOKEMON_APPLICATION_ACCEPTANCE_SUBJECT_TYPE,
      applicant: structuredClone(value.applicant),
      reviewedRequest: structuredClone(value.reviewedRequest),
      source: structuredClone(value.source)
    },
    transition: {
      schemaVersion: HOOKEMON_ROUTE_ACCEPTANCE_TRANSITION_TYPE,
      fromRoute: structuredClone(value.originalRoute),
      toCapability: structuredClone(value.capability),
      hook: structuredClone(value.hook),
      economics: structuredClone(value.economics),
      applicantActions: structuredClone(value.applicantActions),
      immutableBindings,
      authorizationGranted: false
    },
    acceptanceScope: "route-binding-review-only",
    reviewedRequestedActions: ["review"],
    authorizationGranted: false,
    privateKeyRequested: false,
    broadcastAuthorized: false
  });
}

export function hookemonPublicRouteAcceptanceClaimHash(value) {
  return `sha256:${crypto.createHash("sha256")
    .update(canonicalJsonBytesV2(hookemonPublicRouteAcceptanceClaimV1(value), {
      trailingNewline: false
    }))
    .digest("hex")}`;
}

export function hookemonPublicRouteAcceptanceTransitionHash(value) {
  return keccak256Hex(canonicalJsonBytesV2(
    hookemonPublicRouteAcceptanceClaimV1(value).transition,
    { trailingNewline: false }
  ));
}

export function deriveCreateAddress(sender, nonce) {
  const canonicalSender = checksumAddress(sender, { label: "CREATE sender" });
  if (!Number.isSafeInteger(nonce) || nonce < 0) {
    throw new TypeError("CREATE nonce must be a non-negative safe integer");
  }
  const encodedAddress = Buffer.concat([
    Buffer.from([0x94]),
    Buffer.from(canonicalSender.slice(2), "hex")
  ]);
  const encodedNonce = rlpEncodeUint(BigInt(nonce));
  const payload = Buffer.concat([encodedAddress, encodedNonce]);
  if (payload.length > 55) throw new TypeError("CREATE address RLP payload is unexpectedly long");
  const encodedList = Buffer.concat([Buffer.from([0xc0 + payload.length]), payload]);
  const digest = keccak256Bytes(encodedList);
  return checksumAddress(`0x${digest.subarray(12).toString("hex")}`, {
    label: "derived CREATE address"
  });
}

function addressPaths(value) {
  return [
    "$.applicant.launchWallet",
    "$.applicantActions[0].to",
    "$.applicantActions[0].spender",
    "$.applicantActions[1].expectedContractAddress",
    "$.applicantActions[2].to",
    "$.immutableBindings.platformContracts.kernelAddress",
    "$.immutableBindings.platformContracts.routerAddress",
    "$.immutableBindings.platformContracts.profileAddress",
    "$.immutableBindings.platformContracts.registryAddress",
    "$.immutableBindings.architecture.position.manager",
    "$.immutableBindings.architecture.position.owner",
    "$.immutableBindings.architecture.position.positionTimelock",
    "$.immutableBindings.authorityFacade.authorityAddress",
    "$.immutableBindings.authorityFacade.facadeAddress"
  ].filter((field) => getPath(value, field) !== undefined);
}

function getPath(value, jsonPath) {
  const tokens = jsonPath
    .replace(/^\$\.?/u, "")
    .replace(/\[(\d+)\]/gu, ".$1")
    .split(".")
    .filter(Boolean);
  return tokens.reduce((node, token) => node?.[token], value);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function rlpEncodeUint(value) {
  if (value === 0n) return Buffer.from([0x80]);
  let hexadecimal = value.toString(16);
  if (hexadecimal.length % 2 !== 0) hexadecimal = `0${hexadecimal}`;
  const bytes = Buffer.from(hexadecimal, "hex");
  if (bytes.length === 1 && bytes[0] < 0x80) return bytes;
  return Buffer.concat([Buffer.from([0x80 + bytes.length]), bytes]);
}

function assessmentTimeMilliseconds(value) {
  const milliseconds = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    throw new TypeError("assessment time must be a valid Date or RFC 3339 string");
  }
  return milliseconds;
}

function isCanonicalMillisecondTimestamp(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
    && !Number.isNaN(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function sameJson(left, right) {
  try {
    return canonicalJsonBytesV2(left, { trailingNewline: false })
      .equals(canonicalJsonBytesV2(right, { trailingNewline: false }));
  } catch {
    return false;
  }
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}
