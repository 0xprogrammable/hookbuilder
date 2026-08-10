#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { canonicalJsonBytesV2 } from "../skills/programmable-v4-hook-builder/scripts/canonical-json-core.mjs";
import {
  applicantSubmissionEvidence,
  loadApplicantSubmissionSchema,
  parseApplicantSubmission,
  validateApplicantSubmission
} from "./applicant-submission-core.mjs";
import {
  EXACT_SHARDS_PROFILE_ID_HASH,
  EXACT_SHARDS_PROFILE_KEY,
  EXACT_SHARDS_PROFILE_VERSION_HASH,
  EXACT_SHARDS_REVENUE_POLICY_HASH,
  EXACT_SHARDS_REVENUE_POLICY_V1,
  EXACT_SHARDS_REVIEWED_PLAN_SUPERSESSION_SHA256,
  EXACT_SHARDS_REVIEWED_PLAN_SUPERSESSION_V1,
  EXACT_SHARDS_REVIEWED_PLAN_SHA256,
  EXACT_SHARDS_ROUTER_ARTIFACT_BINDING_V1,
  SUPPORTED_ROUTE_BINDINGS,
  assessRouteCompatibility,
  deriveNestedFactoryProfileKeyV1,
  deriveRevenuePolicyV1,
  loadReviewedRoutePlanSchema,
  parseReviewedRoutePlan,
  validateExactShardsApplicantRequest,
  validateReviewedRoutePlanRequestBinding,
  validateReviewedRoutePlan
} from "./route-compatibility-core.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const requestPath = "submissions/requests/1329073878-shards-v1.json";
const planPath = "submissions/examples/shards-reviewed-route-plan-v1.example.json";
const expectedRawRequestSha256 = "5df0061500df503d3f23115ef9099fd4a9ebe7900eec3f3360ec9ab811f28246";

try {
  const requestBytes = fs.readFileSync(path.join(repositoryRoot, requestPath));
  requireEqual(
    crypto.createHash("sha256").update(requestBytes).digest("hex"),
    expectedRawRequestSha256,
    "merged Shards request raw bytes changed"
  );
  const request = parseApplicantSubmission(requestBytes);
  const requestEvidence = applicantSubmissionEvidence(request, requestBytes, requestPath);
  const requestFindings = [
    ...validateApplicantSubmission(
      request,
      loadApplicantSubmissionSchema(repositoryRoot),
      { relativePath: requestPath }
    ),
    ...validateExactShardsApplicantRequest(request, requestEvidence)
  ];
  requireEqual(requestFindings.length, 0, "merged Shards request no longer validates exactly");

  const reviewedPlan = parseReviewedRoutePlan(fs.readFileSync(path.join(repositoryRoot, planPath)));
  const planFindings = validateReviewedRoutePlan(
    reviewedPlan,
    loadReviewedRoutePlanSchema(repositoryRoot)
  );
  planFindings.push(...validateReviewedRoutePlanRequestBinding(request, requestEvidence, reviewedPlan));
  requireEqual(planFindings.length, 0, "exact Shards reviewed route plan no longer validates");
  const { $schema: _schema, ...profile } = reviewedPlan;
  const profileSha256 = `sha256:${crypto.createHash("sha256")
    .update(canonicalJsonBytesV2(profile, { trailingNewline: false }))
    .digest("hex")}`;
  requireEqual(profileSha256, EXACT_SHARDS_REVIEWED_PLAN_SHA256, "exact Shards profile digest drifted");
  requireEqual(
    JSON.stringify(reviewedPlan.routerArtifactBinding),
    JSON.stringify(EXACT_SHARDS_ROUTER_ARTIFACT_BINDING_V1),
    "exact Shards Router artifact binding drifted"
  );
  requireEqual(
    EXACT_SHARDS_ROUTER_ARTIFACT_BINDING_V1.artifact.sha256,
    "sha256:7385a806d831e7b89e598dca16de1c6107590659375d43d97d4d6ab30292f6d0",
    "canonical Router artifact digest drifted"
  );
  requireEqual(
    EXACT_SHARDS_ROUTER_ARTIFACT_BINDING_V1.integrity.sha256,
    "sha256:de0d683e7eaeae6a1bb0e08a6c0a02318a7e22fb534f1f2d7df60284b6694e91",
    "canonical Router artifact integrity digest drifted"
  );
  requireEqual(
    EXACT_SHARDS_ROUTER_ARTIFACT_BINDING_V1.routerSource.commit,
    "3d71e9243dd1b604099c79038c4c52a36062b0e4",
    "frozen Router source commit drifted"
  );
  requireEqual(
    EXACT_SHARDS_ROUTER_ARTIFACT_BINDING_V1.routerSource.tree,
    "d38e368c591c6e4a511915a7397f887beb082db7",
    "frozen Router source tree drifted"
  );
  requireEqual(
    EXACT_SHARDS_ROUTER_ARTIFACT_BINDING_V1.routeBinding.routePayloadHash,
    "0x75403c2f52dbdf623cfcd077fab52308b3e1e0623016ec73539fac5234f21356",
    "Shards route payload hash drifted"
  );
  requireEqual(
    EXACT_SHARDS_ROUTER_ARTIFACT_BINDING_V1.routeBinding.expectedResultHash,
    "0x29de1a5462fe7b07a0d58894f7ec5e2eb4e870c83153e2109647c7f4094c828b",
    "Shards expected result hash drifted"
  );
  requireEqual(
    EXACT_SHARDS_ROUTER_ARTIFACT_BINDING_V1.routeBinding.launchId,
    "0xd225b22ea82ef2425660da409849a55c1c44751eedd9cd1b581a48358a0905eb",
    "Shards launch ID drifted"
  );
  requireEqual(
    EXACT_SHARDS_ROUTER_ARTIFACT_BINDING_V1.routeBinding.stampRequestHash,
    "0x276a295580bcb65ed286a2a02efba575eaee87c090f54c94e5ad8a2b78552bce",
    "Shards stamp request hash drifted"
  );

  requireEqual(SUPPORTED_ROUTE_BINDINGS.length, 2, "capability catalog must publish exactly two profiles");
  requireEqual(
    JSON.stringify(SUPPORTED_ROUTE_BINDINGS.map(({ supported }) => supported)),
    JSON.stringify(["direct-graph", "exact-shards-nested-factory"]),
    "capability catalog support set drifted"
  );
  const derivedProfileKey = deriveNestedFactoryProfileKeyV1(
    "exact-shards-nested-factory",
    "1.0.0"
  );
  requireEqual(derivedProfileKey.profileIdHash, EXACT_SHARDS_PROFILE_ID_HASH, "profile ID hash drifted");
  requireEqual(
    derivedProfileKey.profileVersionHash,
    EXACT_SHARDS_PROFILE_VERSION_HASH,
    "profile version hash drifted"
  );
  requireEqual(derivedProfileKey.profileKey, EXACT_SHARDS_PROFILE_KEY, "profile key drifted");
  const revenuePolicy = deriveRevenuePolicyV1(EXACT_SHARDS_REVENUE_POLICY_V1);
  requireEqual(
    revenuePolicy.revenuePolicyHash,
    EXACT_SHARDS_REVENUE_POLICY_HASH,
    "exact Shards revenue policy hash drifted"
  );
  requireEqual(
    reviewedPlan.revenuePolicy.revenuePolicyHash,
    EXACT_SHARDS_REVENUE_POLICY_HASH,
    "reviewed plan revenue policy hash drifted"
  );
  requireEqual(
    SUPPORTED_ROUTE_BINDINGS[0].revenuePolicyHash,
    null,
    "direct graph must not publish a universal revenue policy"
  );
  requireEqual(
    SUPPORTED_ROUTE_BINDINGS[0].revenuePolicySemantics,
    "artifact-required/profile-specific",
    "direct graph revenue policy semantics drifted"
  );
  const supersessionSha256 = `sha256:${crypto.createHash("sha256")
    .update(canonicalJsonBytesV2(EXACT_SHARDS_REVIEWED_PLAN_SUPERSESSION_V1, { trailingNewline: false }))
    .digest("hex")}`;
  requireEqual(
    supersessionSha256,
    EXACT_SHARDS_REVIEWED_PLAN_SUPERSESSION_SHA256,
    "Shards reviewed-plan supersession digest drifted"
  );
  requireEqual(
    reviewedPlan.reviewedPlanSupersessionSha256,
    EXACT_SHARDS_REVIEWED_PLAN_SUPERSESSION_SHA256,
    "Shards reviewed plan no longer commits its exact supersession"
  );
  requireEqual(
    JSON.stringify(EXACT_SHARDS_REVIEWED_PLAN_SUPERSESSION_V1.allowedExecutionModes.map(
      ({ executionMode }) => executionMode
    )),
    JSON.stringify(["EXACT_FACTORY_LAUNCH_EXECUTED", "EXACT_EXISTING_LAUNCH_ADOPTED"]),
    "Shards allowed Router execution-mode policy drifted"
  );
  requireEqual(
    JSON.stringify(EXACT_SHARDS_REVIEWED_PLAN_SUPERSESSION_V1.allowedExecutionModes.map(
      ({ abiOrdinal }) => abiOrdinal
    )),
    JSON.stringify([1, 2]),
    "Shards Router execution-mode ABI ordinals drifted"
  );
  requireEqual(
    EXACT_SHARDS_REVIEWED_PLAN_SUPERSESSION_V1.expectedResultHashPolicy,
    "same-configured-identity-hash-for-both-modes",
    "Shards expected-result cross-mode binding drifted"
  );
  requireEqual(
    EXACT_SHARDS_REVIEWED_PLAN_SUPERSESSION_V1.otherwise,
    "reject",
    "Shards supersession no longer rejects every unlisted pre-state"
  );
  requireEqual(
    EXACT_SHARDS_REVIEWED_PLAN_SUPERSESSION_V1.factoryPredeploymentPrerequisite
      .plannedDeploymentSender,
    "0x2Bb333d48DFAF1596D9036671d2E43168994249E",
    "planned platform factory sender drifted"
  );
  requireEqual(
    EXACT_SHARDS_REVIEWED_PLAN_SUPERSESSION_V1.factoryPredeploymentPrerequisite
      .acceptedObservedDeploymentSender,
    "any-eoa",
    "anti-grief observed factory sender policy drifted"
  );
  requireEqual(
    EXACT_SHARDS_REVIEWED_PLAN_SUPERSESSION_V1.factoryPredeploymentPrerequisite
      .acceptedObservedDeploymentSenderCondition,
    "exact-canonical-create2-proxy-salt-initcode-calldata-factory-renderer-only",
    "anti-grief factory identity condition drifted"
  );
  requireEqual(
    reviewedPlan.launchPlan.priorReleaseFactoryPredeployment.applicantAction,
    false,
    "factory predeployment became an applicant action"
  );
  requireEqual(
    EXACT_SHARDS_REVIEWED_PLAN_SUPERSESSION_V1.factoryPredeploymentPrerequisite
      .vacantAtomicRoute.status,
    "unsupported",
    "vacant atomic Shards route became admissible"
  );
  if (
    EXACT_SHARDS_REVIEWED_PLAN_SUPERSESSION_V1.factoryPredeploymentPrerequisite
      .vacantAtomicRoute.candidateGas
    <= EXACT_SHARDS_REVIEWED_PLAN_SUPERSESSION_V1.factoryPredeploymentPrerequisite
      .vacantAtomicRoute.mainnetTransactionGasCap
  ) throw new Error("vacant atomic Shards gas proof no longer exceeds the Mainnet transaction cap");

  const originalAssessment = assessRouteCompatibility(request.requestedRoute, reviewedPlan);
  requireEqual(
    originalAssessment.status,
    "ROUTE_CAPABILITY_DISABLED",
    "exact Shards capability must remain disabled before its production release attestation"
  );
  requireEqual(
    originalAssessment.capabilityClassification,
    "exact-shards-nested-factory",
    "Shards compatibility classification drifted"
  );
  requireEqual(
    originalAssessment.capability.routeTargetAddress,
    null,
    "disabled nested capability cannot claim an undeployed Router target"
  );
  requireEqual(
    originalAssessment.capability.routeTargetRuntimeCodeHash,
    null,
    "disabled nested capability cannot claim an undeployed Router runtime"
  );
  requireEqual(
    originalAssessment.capability.factoryRuntimeCodeHash,
    "0x134a9e5674f22e62e939c2238693077b8027c553bb26d6a4e9e3d8554e5f85b5",
    "exact Shards factory runtime drifted"
  );
  requireEqual(
    originalAssessment.capability.factoryInitialStateRequirement,
    "exact-predeployed-pair",
    "exact Shards factory initial-state capability drifted"
  );
  requireEqual(
    originalAssessment.capability.predeploymentEvidenceSha256,
    null,
    "disabled Shards capability cannot claim missing predeployment evidence"
  );
  requireEqual(
    originalAssessment.capability.gasCapReceiptSha256,
    null,
    "disabled Shards capability cannot claim missing gas-cap evidence"
  );
  requireEqual(originalAssessment.acceptanceRequired, true, "Shards route change must require acceptance after activation");
  requireEqual(
    JSON.stringify(originalAssessment.requiredRoute),
    JSON.stringify({ routeId: "nested-factory", routeVersion: "1.0.0", chainId: "1" }),
    "Shards required route drifted"
  );
  const acceptedAssessment = assessRouteCompatibility(originalAssessment.requiredRoute, reviewedPlan);
  requireEqual(
    acceptedAssessment.status,
    "ROUTE_CAPABILITY_DISABLED",
    "Shards route became enabled without a production release attestation"
  );
  requireEqual(acceptedAssessment.acceptanceRequired, false, "accepted Shards route should not require another route change");
  requireEqual(
    JSON.stringify(acceptedAssessment.capability),
    JSON.stringify(originalAssessment.capability),
    "accepted Shards route capability differs from the preapproval report"
  );

  process.stdout.write(`${JSON.stringify({
    status: "ROUTE_CAPABILITY_CATALOG_VALID",
    networkAccessed: false,
    externalActionsPerformed: [],
    catalogVersion: "1.0.0",
    supported: ["direct-graph", "exact-shards-nested-factory"],
    shardsRegression: {
      reviewedRequestPath: requestPath,
      rawSha256: expectedRawRequestSha256,
      applicationManifestSha256: requestEvidence.applicationManifest.sha256,
      reviewedPlanPath: planPath,
      profileSha256,
      originalRouteStatus: originalAssessment.status,
      requiredRoute: originalAssessment.requiredRoute,
      capability: originalAssessment.capability
    }
  }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`validate-route-capability-catalog: ${error.message}\n`);
  process.exitCode = 1;
}

function requireEqual(actual, expected, message) {
  if (actual !== expected) throw new Error(`${message}: expected ${expected}; received ${actual}`);
}
