import {
  CENTRAL_GITHUB_BASE_BRANCH,
  CENTRAL_GITHUB_NUMERIC_REPOSITORY_ID,
  CENTRAL_GITHUB_REPOSITORY,
  CliFailure
} from "./open-world-shared.mjs";

export function installOpenWorldGitHubDraftAdoption(runtime) {
  async function discoverApplicationV3OpenDraft({ applicationPackage, transport, localSourceReplay = null }) {
    const viewer = runtime.normalizeGitHubViewer(await transport.getViewer());
    if (viewer.id !== String(applicationPackage.application.builder.githubUserId)) {
      fail("WRONG_GITHUB_ACCOUNT", "the active GitHub account differs from the immutable Application V3 builder identity");
    }
    const central = runtime.normalizeGitHubRepository(
      await transport.getRepository(CENTRAL_GITHUB_REPOSITORY),
      "central repository"
    );
    if (
      central.fullName.toLowerCase() !== CENTRAL_GITHUB_REPOSITORY
      || central.id !== CENTRAL_GITHUB_NUMERIC_REPOSITORY_ID
      || central.private
      || central.fork
    ) {
      fail("CENTRAL_REPOSITORY_CHANGED", "the fixed public Submit a Launch identity is unavailable");
    }

    const branch = runtime.deriveApplicationV3ReviewBranch(applicationPackage);
    const expectedTitle = runtime.applicationV3PullRequestTitle(applicationPackage);
    const pullRequestNumber = selectExactApplicationV3DraftCandidate({
      byHead: await transport.listPullsByHead({
        centralRepository: CENTRAL_GITHUB_REPOSITORY,
        baseBranch: CENTRAL_GITHUB_BASE_BRANCH,
        head: `${viewer.login}:${branch}`
      }),
      search: await transport.searchOpenPulls({
        centralRepository: CENTRAL_GITHUB_REPOSITORY,
        login: viewer.login,
        title: `[Application V3] ${applicationPackage.applicationId}`
      }),
      expectedTitle,
      expectedAuthorId: viewer.id
    });
    if (pullRequestNumber === null) return noCandidate(applicationPackage.applicationId);

    const pull = runtime.normalizeApplicationV3Pull(
      await transport.getPull(CENTRAL_GITHUB_REPOSITORY, pullRequestNumber)
    );
    if (pull.title !== expectedTitle || pull.head.repositorySlug === null) {
      fail("APPLICATION_DRAFT_ADOPTION_MISMATCH", "the unique matching pull request does not preserve the exact Application V3 title and fork identity");
    }
    const fork = runtime.normalizeGitHubRepository(
      await transport.getRepository(pull.head.repositorySlug),
      "Applicant Draft fork"
    );
    if (
      fork.id !== pull.head.repositoryId
      || fork.private
      || !fork.fork
      || fork.owner.id !== viewer.id
      || fork.parentId !== central.id
      || fork.permissions.push !== true
    ) {
      fail("APPLICATION_DRAFT_ADOPTION_MISMATCH", "the unique matching pull request does not use the Applicant's exact public writable target fork");
    }
    const baseRef = runtime.normalizeGitHubRef(
      await transport.getRef(CENTRAL_GITHUB_REPOSITORY, CENTRAL_GITHUB_BASE_BRANCH),
      CENTRAL_GITHUB_BASE_BRANCH
    );
    const headRef = runtime.normalizeGitHubRef(await transport.getRef(fork.fullName, branch), branch);
    if (headRef.commit !== pull.head.sha) {
      fail("APPLICATION_DRAFT_ADOPTION_MISMATCH", "the unique matching Draft head ref differs from its pull-request head");
    }
    runtime.assertApplicationV3PullIdentity({
      pull,
      applicationPackage,
      viewer,
      central,
      fork,
      branch,
      branchCommit: headRef.commit,
      requireDraft: true,
      expectedBaseCommit: baseRef.commit
    });

    const status = await runtime.readApplicationV3GitHubStatus({
      applicationPackage,
      transport,
      pullRequestNumber,
      localSourceReplay
    });
    if (
      status.applicationId !== applicationPackage.applicationId
      || status.target?.pullRequestNumber !== pullRequestNumber
      || status.package?.packageSha256 !== applicationPackage.packageSha256
      || status.package?.matchesRemote !== true
      || status.writePerformed !== false
    ) {
      fail("APPLICATION_DRAFT_ADOPTION_PACKAGE_MISMATCH", "the existing Draft does not contain the exact local Application V3 package");
    }
    return Object.freeze({ ...status, action: "adopt-draft", adopted: true });
  }

  Object.assign(runtime, { discoverApplicationV3OpenDraft });
}

export function selectExactApplicationV3DraftCandidate({ byHead, search, expectedTitle, expectedAuthorId }) {
  if (
    !Array.isArray(byHead)
    || byHead.length > 100
    || search === null
    || typeof search !== "object"
    || Array.isArray(search)
    || !Number.isSafeInteger(search.total_count)
    || search.total_count < 0
    || !Array.isArray(search.items)
    || search.items.length > 100
    || search.total_count !== search.items.length
  ) {
    fail("APPLICATION_DRAFT_ADOPTION_AMBIGUOUS", "GitHub returned an unbounded or inconsistent Applicant Draft discovery set");
  }
  if (byHead.length === 0 && search.items.length === 0) return null;
  if (byHead.length !== 1 || search.items.length !== 1) {
    fail("APPLICATION_DRAFT_ADOPTION_AMBIGUOUS", "more than one exact open Applicant Draft may match this Application");
  }
  const headNumber = positivePullNumber(byHead[0]?.number);
  const item = search.items[0];
  const searchNumber = positivePullNumber(item?.number);
  if (
    headNumber === null
    || searchNumber === null
    || headNumber !== searchNumber
    || item?.title !== expectedTitle
    || String(item?.user?.id ?? "") !== String(expectedAuthorId)
  ) {
    fail("APPLICATION_DRAFT_ADOPTION_MISMATCH", "the unique open Draft discovery results do not agree on exact branch, title, author, and pull-request identity");
  }
  return headNumber;
}

function noCandidate(applicationId) {
  return Object.freeze({
    action: "adopt-draft",
    adopted: false,
    applicationId,
    readOnly: true,
    writePerformed: false,
    candidateCodeExecuted: false,
    externalActionsPerformed: [],
    approvalGranted: false,
    launchAuthorizationGranted: false
  });
}

function positivePullNumber(value) {
  const normalized = typeof value === "string" && /^[1-9][0-9]*$/u.test(value) ? Number(value) : value;
  return Number.isSafeInteger(normalized) && normalized > 0 ? normalized : null;
}

function fail(code, message) {
  throw new CliFailure(code, message, { exitCode: 1 });
}
