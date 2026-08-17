import { createGhTransport } from "./github-application-core.mjs";
import { createOpenWorldRuntime } from "./open-world-runtime.mjs";
import { applicantSourceRootArgs } from "./submit-project-core.mjs";

const CENTRAL_REPOSITORY = "0xprogrammable/submit-launch";
const EXISTING_DRAFT_CONFLICTS = new Set([
  "APPLICATION_ALREADY_OPEN_USE_UPDATE",
  "APPLICATION_BRANCH_EXISTS_USE_UPDATE"
]);

export async function planSubmitOrAdoptExistingDraft({
  applicationPackage,
  applicationPackagePath,
  repositoryRoot,
  sourceRoots,
  runTransport,
  adoptExistingDraft
}) {
  const sourceRootArgs = applicantSourceRootArgs(sourceRoots);
  const status = runPlan({ operation: "submit", applicationPackagePath, repositoryRoot, sourceRootArgs, pullRequest: null, runTransport });
  if (status.ok || !EXISTING_DRAFT_CONFLICTS.has(status.code)) {
    return { adopted: false, pullRequest: null, status };
  }

  const adoption = await adoptExistingDraft({
    applicationPackagePath,
    sourceRoots
  });
  const adoptedPullRequest = validateAdoption(adoption, applicationPackage);
  if (adoptedPullRequest === null) return { adopted: false, pullRequest: null, status: adoptionFailure(adoption) };
  return { adopted: true, pullRequest: adoptedPullRequest, status: null };
}

export async function discoverExistingDraft({ applicationPackagePath, sourceRoots }) {
  const runtime = createOpenWorldRuntime();
  try {
    const applicationPackage = runtime.loadApplicationV3TransportPackage(applicationPackagePath);
    const sourceRootValues = sourceRoots.map(({ repositoryRef, root }) => `${repositoryRef}=${root}`);
    const localSourceReplay = sourceRootValues.length === 0
      ? null
      : await runtime.verifyApplicationV3LocalTransportSources({ applicationPackage, sourceRootValues });
    return {
      ok: true,
      result: await runtime.discoverApplicationV3OpenDraft({
        applicationPackage,
        transport: createGhTransport(),
        localSourceReplay
      })
    };
  } catch (error) {
    return {
      ok: false,
      code: error?.code ?? "APPLICATION_DRAFT_ADOPTION_FAILED",
      details: error?.details ?? { writePerformed: false }
    };
  }
}

function runPlan({ operation, applicationPackagePath, repositoryRoot, sourceRootArgs, pullRequest, runTransport }) {
  const args = [operation, applicationPackagePath];
  if (pullRequest !== null) args.push("--pull-request", String(pullRequest));
  args.push(...sourceRootArgs, "--dry-run");
  return runTransport(args, repositoryRoot);
}

function validateAdoption(adoption, applicationPackage) {
  const result = adoption?.result;
  const pullRequest = result?.target?.pullRequestNumber;
  return adoption?.ok === true
    && result?.action === "adopt-draft"
    && result.adopted === true
    && result.applicationId === applicationPackage.applicationId
    && result.package?.packageSha256 === applicationPackage.packageSha256
    && result.package?.matchesRemote === true
    && result.target?.repository === CENTRAL_REPOSITORY
    && Number.isSafeInteger(pullRequest)
    && pullRequest > 0
    && result.readOnly === true
    && result.writePerformed === false
    && result.approvalGranted === false
    && result.launchAuthorizationGranted === false
    ? pullRequest
    : null;
}

function adoptionFailure(adoption) {
  if (adoption?.ok === false) return adoption;
  return {
    ok: false,
    code: "APPLICATION_DRAFT_ADOPTION_PACKAGE_MISMATCH",
    details: { writePerformed: false }
  };
}
