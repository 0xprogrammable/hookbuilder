import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { TextDecoder } from "node:util";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultCatalogPath = path.resolve(scriptDirectory, "..", "assets", "build-profiles", "catalog.json");
const ignoredDirectories = Object.freeze([".git", ".hg", ".svn", "Library", "Temp", "build", "dist", "node_modules", "target", "vendor"]);
const ignoredDirectorySet = new Set(ignoredDirectories);
const expectedProfileIds = Object.freeze([
  "bun",
  "dotnet",
  "foundry",
  "go",
  "hardhat",
  "javascript-monorepo",
  "npm",
  "pnpm",
  "python",
  "rust",
  "unity",
  "yarn"
]);
const exactJavaScriptManagers = Object.freeze(["bun", "npm", "pnpm", "yarn"]);
const exactJavaScriptManagerSet = new Set(exactJavaScriptManagers);
const allowedManagerDeclarations = new Set([...exactJavaScriptManagers, "any-js"]);
const allowedCheckConditions = new Set(["always", "manager-resolved", "yarn-classic", "yarn-modern"]);
const allowedPlaceholders = new Set(["<package-manager>", "<pinned-unity-editor>", "<python-environment>"]);
const maximumEntries = 4096;
const maximumDepth = 4;
const maximumCatalogBytes = 1_000_000;
const maximumPackageJsonBytes = 1_000_000;
const maximumUnityVersionBytes = 4096;
const maximumJsonDepth = 64;
const maximumJsonNodes = 131072;
const utf8Decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

export const BUILD_PROFILE_LIMITS = Object.freeze({
  maximumCatalogBytes,
  maximumDepth,
  maximumEntries,
  maximumPackageJsonBytes,
  maximumUnityVersionBytes
});

export function loadBuildProfileCatalog(catalogPath = defaultCatalogPath) {
  const resolved = path.resolve(catalogPath);
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("build profile catalog must be a regular non-symlink file");
  if (stat.size === 0 || stat.size > maximumCatalogBytes) throw new Error("build profile catalog exceeds its byte bounds");
  const raw = fs.readFileSync(resolved);
  let text;
  try {
    text = utf8Decoder.decode(raw);
  } catch {
    throw new Error("build profile catalog must be valid UTF-8");
  }
  if (raw.length === 0 || raw.length > maximumCatalogBytes) throw new Error("build profile catalog exceeds its byte bounds");
  if (text.charCodeAt(0) === 0xfeff) throw new Error("build profile catalog must not contain a byte-order mark");
  const parsed = parseStrictJson(text, "build profile catalog");
  validateCatalog(parsed);

  const catalogSha256 = sha256Hex(raw);
  const catalogDigest = semanticDigest("programmable.build-profile.catalog.v1", parsed);
  const profiles = parsed.profiles.map((profile) => ({
    ...profile,
    profileDigest: semanticDigest("programmable.build-profile.profile.v1", profile)
  }));
  return deepFreeze({ ...parsed, catalogDigest, catalogSha256, profiles });
}

export function listBuildProfiles({ catalog = loadBuildProfileCatalog() } = {}) {
  return {
    schemaVersion: "1.0.0",
    catalogDigest: catalog.catalogDigest,
    catalogSha256: catalog.catalogSha256,
    profiles: catalog.profiles.map(({ id, label, profileDigest }) => ({ id, label, profileDigest })),
    unknownPolicy: "needs-review"
  };
}

export function showBuildProfile(profileId, { catalog = loadBuildProfileCatalog() } = {}) {
  const profile = catalog.profiles.find((candidate) => candidate.id === profileId);
  if (!profile) throw new Error(`unknown build profile ${profileId}`);
  return {
    schemaVersion: "1.0.0",
    catalogDigest: catalog.catalogDigest,
    catalogSha256: catalog.catalogSha256,
    profile,
    commandsExecuted: false,
    networkAccessed: false
  };
}

export function inspectBuildProfiles(repositoryRoot, { catalog = loadBuildProfileCatalog() } = {}) {
  const root = resolveRepositoryRoot(repositoryRoot);
  const scan = scanRepository(root);
  const context = createDetectionContext(root, scan.files);
  const profileById = new Map(catalog.profiles.map((profile) => [profile.id, profile]));
  const matches = [];
  const findings = [];
  const findingKeys = new Set();
  const recordedPackageRoots = new Set();

  const addFinding = (finding) => {
    const key = canonicalJson(finding);
    if (!findingKeys.has(key)) {
      findingKeys.add(key);
      findings.push(finding);
    }
  };

  const recordPackageIssues = (projectRoot, info) => {
    if (recordedPackageRoots.has(projectRoot)) return;
    recordedPackageRoots.add(projectRoot);
    if (info.exists && !info.valid) {
      addFinding({
        code: "PACKAGE_JSON_INVALID",
        severity: "needs-review",
        projectRoot,
        message: "package.json could not be read as a bounded, duplicate-free JSON object."
      });
    }
    if (info.packageManagerInvalid) {
      addFinding({
        code: "PACKAGE_MANAGER_DECLARATION_INVALID",
        severity: "needs-review",
        projectRoot,
        message: "packageManager must pin npm, pnpm, Yarn, or Bun to an exact numeric version."
      });
    }
    if (info.workspacesInvalid) {
      addFinding({
        code: "WORKSPACE_DECLARATION_INVALID",
        severity: "needs-review",
        projectRoot,
        message: "The workspaces declaration is present but is not a non-empty, safe workspace list."
      });
    }
  };

  const workspaceRoots = collectWorkspaceRoots(context);

  for (const profile of catalog.profiles) {
    if (exactJavaScriptManagerSet.has(profile.id) || profile.detection.packageManager === "any-js") continue;
    const candidates = candidateRootsForProfile(profile, context);
    for (const [projectRoot, markers] of candidates) {
      const required = requiredState(profile, projectRoot, context.files);
      const locks = pathsAtRoot(profile.detection.lockFilesAny, projectRoot, context.files);
      const lockComplete = profile.detection.lockFilesAny.length === 0 || locks.length > 0;
      let pinComplete = true;
      const pins = [];
      if (profile.detection.unityEditorVersionRequired) {
        const unityVersion = readUnityEditorVersion(root, projectRoot, context.files);
        pinComplete = unityVersion.valid;
        if (unityVersion.version) pins.push({ id: "unity-editor-version", value: unityVersion.version });
        if (!unityVersion.valid && unityVersion.fileExists) {
          addFinding({
            code: "UNITY_EDITOR_VERSION_INVALID",
            severity: "needs-review",
            profileId: profile.id,
            projectRoot,
            message: "ProjectVersion.txt does not contain a recognized pinned Unity editor version."
          });
        }
      }
      const status = required.complete && lockComplete && pinComplete ? "recognized" : "needs-review";
      matches.push(buildMatch({ profile, projectRoot, markers, required, locks, pins, status }));
      addCompletenessFindings({ addFinding, lockComplete, profile, projectRoot, required });
    }
  }

  const packageRoots = context.packageRoots;
  for (const projectRoot of packageRoots) {
    const info = context.packageInfo(projectRoot);
    const managerState = javaScriptManagerState(projectRoot, info, context.files);
    const nestedWorkspace = isNestedWorkspacePackage(projectRoot, workspaceRoots);
    const hasIndependentManagerSignal = managerState.lockManagers.length > 0 || info.packageManagerPresent;
    if (nestedWorkspace && !hasIndependentManagerSignal && info.valid && !info.workspacesInvalid) continue;

    recordPackageIssues(projectRoot, info);
    recordManagerFindings(projectRoot, managerState, addFinding);
    const targetManagers = new Set(managerState.lockManagers);
    if (info.packageManager) targetManagers.add(info.packageManager.name);
    if (targetManagers.size === 0) targetManagers.add("npm");

    for (const manager of [...targetManagers].sort(compareUtf8)) {
      const profile = profileById.get(manager);
      const locks = managerState.locksByManager[manager];
      const lockComplete = locks.length > 0;
      let yarnGeneration = null;
      let generationComplete = true;
      if (manager === "yarn") {
        yarnGeneration = resolveYarnGeneration(projectRoot, info, context.files);
        generationComplete = yarnGeneration === "classic" || yarnGeneration === "modern";
        if (!generationComplete) {
          addFinding({
            code: "YARN_GENERATION_UNRESOLVED",
            severity: "needs-review",
            profileId: "yarn",
            projectRoot,
            message: "Yarn Classic versus modern Yarn could not be resolved without ambiguity."
          });
        }
      }
      const packageHealthy = info.valid && !info.packageManagerInvalid && !info.workspacesInvalid;
      const managerHealthy = !managerState.conflict && !managerState.mismatch;
      const required = requiredState(profile, projectRoot, context.files);
      const status = required.complete && lockComplete && packageHealthy && managerHealthy && generationComplete
        ? "recognized"
        : "needs-review";
      const pins = info.packageManager?.name === manager
        ? [{ id: "package-manager", value: `${manager}@${info.packageManager.version}` }]
        : [];
      matches.push(buildMatch({
        profile,
        projectRoot,
        markers: [joinRoot(projectRoot, "package.json")],
        required,
        locks,
        pins,
        status,
        packageManager: manager,
        yarnGeneration
      }));
      addCompletenessFindings({ addFinding, lockComplete, profile, projectRoot, required });
    }
  }

  for (const profile of catalog.profiles.filter((candidate) => candidate.detection.packageManager === "any-js")) {
    const candidates = candidateRootsForProfile(profile, context);
    for (const [projectRoot, markers] of candidates) {
      const required = requiredState(profile, projectRoot, context.files);
      const info = context.packageInfo(projectRoot);
      const managerState = javaScriptManagerState(projectRoot, info, context.files);
      recordPackageIssues(projectRoot, info);
      recordManagerFindings(projectRoot, managerState, addFinding);
      const manager = managerState.lockManagers.length === 1 && !managerState.mismatch
        ? managerState.lockManagers[0]
        : null;
      const lockComplete = managerState.lockManagers.length === 1;
      const locks = managerState.allLocks;
      const status = required.complete
        && lockComplete
        && info.valid
        && !info.packageManagerInvalid
        && !info.workspacesInvalid
        && !managerState.conflict
        && !managerState.mismatch
        ? "recognized"
        : "needs-review";
      matches.push(buildMatch({
        profile,
        projectRoot,
        markers,
        required,
        locks,
        pins: [],
        status,
        packageManager: manager
      }));
      addCompletenessFindings({ addFinding, lockComplete, profile, projectRoot, required });
    }
  }

  if (matches.length === 0) {
    addFinding({
      code: "UNKNOWN_BUILD_SYSTEM",
      severity: "needs-review",
      message: "No bundled profile matched. Define a custom reproducible build profile; the project remains eligible."
    });
  }
  if (scan.symlinksSkipped > 0) {
    addFinding({
      code: "SYMLINKS_SKIPPED",
      severity: "needs-review",
      count: scan.symlinksSkipped,
      message: "Symlinks were not followed during build-profile detection."
    });
  }
  if (scan.unsafeNamesSkipped > 0) {
    addFinding({
      code: "UNSAFE_PATH_SKIPPED",
      severity: "needs-review",
      count: scan.unsafeNamesSkipped,
      message: "Path entries with non-canonical or invisible Unicode were skipped."
    });
  }
  if (scan.nonRegularEntriesSkipped > 0) {
    addFinding({
      code: "NON_REGULAR_ENTRIES_SKIPPED",
      severity: "needs-review",
      count: scan.nonRegularEntriesSkipped,
      message: "Non-regular filesystem entries were skipped."
    });
  }
  if (scan.unreadableDirectories.length > 0) {
    addFinding({
      code: "DIRECTORY_UNREADABLE",
      severity: "needs-review",
      count: scan.unreadableDirectories.length,
      message: "One or more directories could not be inspected."
    });
  }
  if (scan.limitReached) {
    addFinding({
      code: "SCAN_BOUND_REACHED",
      severity: "needs-review",
      depthCutoffs: scan.depthCutoffs,
      entryLimitReached: scan.entryLimitReached,
      message: "The bounded profile scan stopped before inspecting every non-ignored entry."
    });
  }

  matches.sort((left, right) => compareUtf8(left.id, right.id) || compareUtf8(left.projectRoot, right.projectRoot));
  findings.sort(compareFindings);
  return {
    schemaVersion: "1.0.0",
    catalogDigest: catalog.catalogDigest,
    catalogSha256: catalog.catalogSha256,
    repositoryRoot: root,
    overallStatus: matches.length > 0
      && matches.every((match) => match.status === "recognized")
      && findings.length === 0
      && !scan.limitReached
      ? "recognized"
      : "needs-review",
    profiles: matches,
    findings,
    scan: {
      filesInspected: scan.files.length,
      entriesInspected: scan.entriesInspected,
      maximumEntries,
      maximumDepth,
      symlinksSkipped: scan.symlinksSkipped,
      nonRegularEntriesSkipped: scan.nonRegularEntriesSkipped,
      unsafeNamesSkipped: scan.unsafeNamesSkipped,
      unreadableDirectories: scan.unreadableDirectories,
      depthCutoffs: scan.depthCutoffs,
      entryLimitReached: scan.entryLimitReached,
      limitReached: scan.limitReached,
      ignoredDirectoryNames: ignoredDirectories
    },
    commandsExecuted: false,
    networkAccessed: false,
    eligibility: "unchanged"
  };
}

function validateCatalog(catalog) {
  assertPlainObject(catalog, "catalog");
  assertExactKeys(catalog, ["kind", "policy", "profiles", "schemaVersion"], "catalog");
  if (catalog.schemaVersion !== "1.0.0") throw new Error("build profile catalog schemaVersion must be 1.0.0");
  if (catalog.kind !== "programmable-build-profile-catalog") throw new Error("build profile catalog kind is invalid");
  assertPlainObject(catalog.policy, "catalog policy");
  assertExactKeys(catalog.policy, ["automaticAdverseDecision", "commands", "unknownOutcome"], "catalog policy");
  if (catalog.policy.automaticAdverseDecision !== false
    || catalog.policy.commands !== "inert-only"
    || catalog.policy.unknownOutcome !== "needs-review") {
    throw new Error("build profile catalog policy is invalid");
  }
  if (!Array.isArray(catalog.profiles)) throw new Error("build profile catalog profiles must be an array");
  const ids = catalog.profiles.map((profile) => profile?.id);
  if (!sameStringArray(ids, expectedProfileIds)) throw new Error("build profile catalog must contain the closed, UTF-8 ordered profile set");

  for (const profile of catalog.profiles) {
    assertPlainObject(profile, `profile ${String(profile?.id)}`);
    assertExactKeys(profile, ["detection", "id", "label", "suggestedChecks"], `profile ${profile.id}`);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(profile.id)) throw new Error(`profile ${profile.id} has an invalid id`);
    assertSafeVisibleText(profile.label, `profile ${profile.id} label`, 128);
    assertPlainObject(profile.detection, `profile ${profile.id} detection`);
    assertExactKeys(profile.detection, [
      "lockFilesAny",
      "packageManager",
      "requiredFilesAll",
      "rootMarkersAny",
      "unityEditorVersionRequired"
    ], `profile ${profile.id} detection`);
    if (profile.detection.packageManager !== null && !allowedManagerDeclarations.has(profile.detection.packageManager)) {
      throw new Error(`profile ${profile.id} has an invalid packageManager semantic`);
    }
    if (profile.detection.unityEditorVersionRequired !== (profile.id === "unity")) {
      throw new Error(`profile ${profile.id} has an invalid Unity pin semantic`);
    }
    validatePatternArray(profile.detection.lockFilesAny, `profile ${profile.id} lockFilesAny`, true);
    validatePatternArray(profile.detection.requiredFilesAll, `profile ${profile.id} requiredFilesAll`, true);
    validatePatternArray(profile.detection.rootMarkersAny, `profile ${profile.id} rootMarkersAny`, false);
    if (exactJavaScriptManagerSet.has(profile.id) && profile.detection.packageManager !== profile.id) {
      throw new Error(`profile ${profile.id} must bind its exact package manager`);
    }
    if (["hardhat", "javascript-monorepo"].includes(profile.id) && profile.detection.packageManager !== "any-js") {
      throw new Error(`profile ${profile.id} must use the any-js package manager semantic`);
    }
    if (profile.id === "unity") {
      if (!sameStringArray(profile.detection.requiredFilesAll, ["Packages/manifest.json", "ProjectSettings/ProjectVersion.txt"])
        || !sameStringArray(profile.detection.lockFilesAny, ["Packages/packages-lock.json"])) {
        throw new Error("Unity profile must require its manifest, dependency lock, and editor version file");
      }
    }
    validateChecks(profile);
  }
}

function validateChecks(profile) {
  if (!Array.isArray(profile.suggestedChecks) || profile.suggestedChecks.length === 0 || profile.suggestedChecks.length > 16) {
    throw new Error(`profile ${profile.id} must declare between one and sixteen checks`);
  }
  const checkIds = [];
  for (const check of profile.suggestedChecks) {
    assertPlainObject(check, `profile ${profile.id} check`);
    assertExactKeys(check, ["argv", "id", "when"], `profile ${profile.id} check`);
    if (!/^[0-9]{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(check.id)) throw new Error(`profile ${profile.id} has an invalid check id`);
    checkIds.push(check.id);
    if (!allowedCheckConditions.has(check.when)) throw new Error(`profile ${profile.id} has an invalid check condition`);
    if (!Array.isArray(check.argv) || check.argv.length === 0 || check.argv.length > 32) {
      throw new Error(`profile ${profile.id} has an invalid inert argv array`);
    }
    for (const argument of check.argv) {
      assertSafeVisibleText(argument, `profile ${profile.id} command argument`, 256);
      for (const placeholder of argument.match(/<[^>]+>/gu) ?? []) {
        if (!allowedPlaceholders.has(placeholder) || argument !== placeholder) {
          throw new Error(`profile ${profile.id} uses an unsupported command placeholder`);
        }
      }
    }
  }
  assertSortedUnique(checkIds, `profile ${profile.id} checks`);
  const conditions = new Set(profile.suggestedChecks.map((check) => check.when));
  if (profile.id === "yarn" && (!conditions.has("yarn-classic") || !conditions.has("yarn-modern"))) {
    throw new Error("Yarn profile must keep generation-specific install checks separate");
  }
  if (profile.id !== "yarn" && [...conditions].some((condition) => condition.startsWith("yarn-"))) {
    throw new Error(`profile ${profile.id} cannot use Yarn generation semantics`);
  }
  if (profile.detection.packageManager === "any-js" && [...conditions].some((condition) => condition !== "manager-resolved")) {
    throw new Error(`profile ${profile.id} checks must require a resolved package manager`);
  }
}

function validatePatternArray(value, label, mayBeEmpty) {
  if (!Array.isArray(value) || (!mayBeEmpty && value.length === 0)) throw new Error(`${label} is invalid`);
  for (const pattern of value) validatePattern(pattern, label);
  assertSortedUnique(value, label);
}

function validatePattern(pattern, label) {
  assertSafeVisibleText(pattern, label, 160);
  if (pattern === "package.json#workspaces") return;
  if (pattern.includes("\\") || path.posix.isAbsolute(pattern) || pattern.includes("//")) throw new Error(`${label} contains an unsafe path`);
  const segments = pattern.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) throw new Error(`${label} contains an unsafe path segment`);
  const wildcardSegments = segments.filter((segment) => segment.includes("*"));
  if (wildcardSegments.length > 0 && (segments.length !== 1 || wildcardSegments.length !== 1 || !/^\*\.[A-Za-z0-9]+$/u.test(pattern))) {
    throw new Error(`${label} contains an unsupported wildcard`);
  }
  if (pattern.includes("?") || pattern.includes("[") || pattern.includes("]")) throw new Error(`${label} contains an unsupported wildcard`);
}

function assertPlainObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error(`${label} must be a plain object`);
  }
}

function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort(compareUtf8);
  const sortedExpected = [...expected].sort(compareUtf8);
  if (!sameStringArray(actual, sortedExpected)) throw new Error(`${label} contains unknown or missing fields`);
}

function assertSortedUnique(values, label) {
  if (!values.every((value) => typeof value === "string")) throw new Error(`${label} must contain strings`);
  for (let index = 1; index < values.length; index += 1) {
    if (compareUtf8(values[index - 1], values[index]) >= 0) throw new Error(`${label} must be unique and UTF-8 byte ordered`);
  }
}

function assertSafeVisibleText(value, label, maximumLength) {
  if (typeof value !== "string" || value.length === 0 || value.length > maximumLength || value !== value.normalize("NFC")) {
    throw new Error(`${label} must be non-empty, bounded NFC text`);
  }
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint <= 0x1f
      || (codePoint >= 0x7f && codePoint <= 0x9f)
      || (codePoint >= 0xd800 && codePoint <= 0xdfff)
      || codePoint === 0x061c
      || (codePoint >= 0x200b && codePoint <= 0x200f)
      || (codePoint >= 0x202a && codePoint <= 0x202e)
      || codePoint === 0x2060
      || (codePoint >= 0x2066 && codePoint <= 0x2069)
      || codePoint === 0xfeff
      || (codePoint >= 0xe000 && codePoint <= 0xf8ff)
      || (codePoint >= 0xf0000 && codePoint <= 0xffffd)
      || (codePoint >= 0x100000 && codePoint <= 0x10fffd)
      || (codePoint >= 0xfdd0 && codePoint <= 0xfdef)
      || (codePoint & 0xffff) === 0xfffe
      || (codePoint & 0xffff) === 0xffff) {
      throw new Error(`${label} contains invisible, control, private-use, or non-canonical Unicode`);
    }
  }
}

function resolveRepositoryRoot(input) {
  if (typeof input !== "string" || input.length === 0) throw new Error("repository root is required");
  const resolved = fs.realpathSync(path.resolve(input));
  if (!fs.statSync(resolved).isDirectory()) throw new Error("repository root must be a directory");
  return resolved;
}

function scanRepository(root) {
  const files = [];
  const unreadableDirectories = [];
  let entriesInspected = 0;
  let symlinksSkipped = 0;
  let unsafeNamesSkipped = 0;
  let nonRegularEntriesSkipped = 0;
  let depthCutoffs = 0;
  let entryLimitReached = false;
  const pending = [{ absolute: root, relative: "", depth: 0 }];

  while (pending.length > 0 && !entryLimitReached) {
    const current = pending.shift();
    let entries;
    try {
      entries = fs.readdirSync(current.absolute, { withFileTypes: true });
    } catch {
      unreadableDirectories.push(current.relative || ".");
      continue;
    }
    entries.sort((left, right) => compareUtf8(left.name, right.name));
    for (const entry of entries) {
      if (entriesInspected >= maximumEntries) {
        entryLimitReached = true;
        break;
      }
      entriesInspected += 1;
      try {
        assertSafeVisibleText(entry.name, "repository path entry", 255);
      } catch {
        unsafeNamesSkipped += 1;
        continue;
      }
      const relative = current.relative ? `${current.relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) {
        symlinksSkipped += 1;
        continue;
      }
      if (entry.isDirectory()) {
        if (ignoredDirectorySet.has(entry.name)) continue;
        if (current.depth >= maximumDepth) {
          depthCutoffs += 1;
          continue;
        }
        pending.push({ absolute: path.join(current.absolute, entry.name), relative, depth: current.depth + 1 });
        continue;
      }
      if (entry.isFile()) files.push(relative);
      else nonRegularEntriesSkipped += 1;
    }
  }
  files.sort(compareUtf8);
  unreadableDirectories.sort(compareUtf8);
  return {
    files,
    entriesInspected,
    symlinksSkipped,
    unsafeNamesSkipped,
    nonRegularEntriesSkipped,
    unreadableDirectories,
    depthCutoffs,
    entryLimitReached,
    limitReached: entryLimitReached || depthCutoffs > 0 || unreadableDirectories.length > 0
  };
}

function createDetectionContext(root, files) {
  const fileSet = new Set(files);
  const byBasename = new Map();
  for (const relativePath of files) {
    const basename = path.posix.basename(relativePath);
    if (!byBasename.has(basename)) byBasename.set(basename, []);
    byBasename.get(basename).push(relativePath);
  }
  const packageRoots = (byBasename.get("package.json") ?? []).map((file) => rootOfFile(file)).sort(compareUtf8);
  const packageCache = new Map();
  return {
    root,
    files: fileSet,
    orderedFiles: files,
    byBasename,
    packageRoots,
    packageInfo(projectRoot) {
      if (!packageCache.has(projectRoot)) packageCache.set(projectRoot, readPackageInfo(root, projectRoot, fileSet));
      return packageCache.get(projectRoot);
    }
  };
}

function candidateRootsForProfile(profile, context) {
  const candidates = new Map();
  const add = (projectRoot, marker) => {
    if (!candidates.has(projectRoot)) candidates.set(projectRoot, new Set());
    candidates.get(projectRoot).add(marker);
  };
  for (const marker of profile.detection.rootMarkersAny) {
    if (marker === "package.json#workspaces") {
      for (const projectRoot of context.packageRoots) {
        if (context.packageInfo(projectRoot).workspacesValid) add(projectRoot, joinRoot(projectRoot, marker));
      }
      continue;
    }
    if (marker.startsWith("*.")) {
      const suffix = marker.slice(1);
      for (const [basename, paths] of context.byBasename) {
        if (!basename.endsWith(suffix)) continue;
        for (const relativePath of paths) add(rootOfFile(relativePath), relativePath);
      }
      continue;
    }
    if (marker.includes("/")) {
      for (const relativePath of context.orderedFiles) {
        if (relativePath === marker) add(".", relativePath);
        else if (relativePath.endsWith(`/${marker}`)) add(relativePath.slice(0, -(marker.length + 1)), relativePath);
      }
      continue;
    }
    for (const relativePath of context.byBasename.get(marker) ?? []) add(rootOfFile(relativePath), relativePath);
  }
  return [...candidates.entries()]
    .map(([projectRoot, markers]) => [projectRoot, [...markers].sort(compareUtf8)])
    .sort(([left], [right]) => compareUtf8(left, right));
}

function collectWorkspaceRoots(context) {
  const roots = new Set();
  for (const projectRoot of context.packageRoots) {
    if (context.packageInfo(projectRoot).workspacesValid) roots.add(projectRoot);
  }
  const monorepoProfile = {
    detection: {
      rootMarkersAny: ["lerna.json", "nx.json", "pnpm-workspace.yaml", "turbo.json"]
    }
  };
  for (const [projectRoot] of candidateRootsForProfile(monorepoProfile, context)) {
    if (context.files.has(joinRoot(projectRoot, "package.json"))) roots.add(projectRoot);
  }
  return [...roots].sort(compareUtf8);
}

function isNestedWorkspacePackage(projectRoot, workspaceRoots) {
  return workspaceRoots.some((workspaceRoot) => projectRoot !== workspaceRoot
    && (workspaceRoot === "." || projectRoot.startsWith(`${workspaceRoot}/`)));
}

function requiredState(profile, projectRoot, files) {
  const present = [];
  const missing = [];
  for (const required of profile.detection.requiredFilesAll) {
    const relativePath = joinRoot(projectRoot, required);
    (files.has(relativePath) ? present : missing).push(relativePath);
  }
  return { complete: missing.length === 0, present, missing };
}

function pathsAtRoot(patterns, projectRoot, files) {
  const matches = [];
  for (const pattern of patterns) {
    if (pattern.startsWith("*.")) {
      const prefix = projectRoot === "." ? "" : `${projectRoot}/`;
      for (const relativePath of files) {
        if (rootOfFile(relativePath) === projectRoot && path.posix.basename(relativePath).endsWith(pattern.slice(1))) {
          matches.push(relativePath);
        }
      }
      continue;
    }
    const relativePath = joinRoot(projectRoot, pattern);
    if (files.has(relativePath)) matches.push(relativePath);
  }
  return [...new Set(matches)].sort(compareUtf8);
}

function javaScriptManagerState(projectRoot, info, files) {
  const locksByManager = {
    bun: pathsAtRoot(["bun.lock", "bun.lockb"], projectRoot, files),
    npm: pathsAtRoot(["npm-shrinkwrap.json", "package-lock.json"], projectRoot, files),
    pnpm: pathsAtRoot(["pnpm-lock.yaml"], projectRoot, files),
    yarn: pathsAtRoot(["yarn.lock"], projectRoot, files)
  };
  const lockManagers = exactJavaScriptManagers.filter((manager) => locksByManager[manager].length > 0);
  const mismatch = Boolean(info.packageManager && lockManagers.length > 0 && !lockManagers.includes(info.packageManager.name));
  return {
    locksByManager,
    lockManagers,
    allLocks: Object.values(locksByManager).flat().sort(compareUtf8),
    conflict: lockManagers.length > 1,
    mismatch
  };
}

function recordManagerFindings(projectRoot, state, addFinding) {
  if (state.conflict) {
    addFinding({
      code: "PACKAGE_MANAGER_CONFLICT",
      severity: "needs-review",
      projectRoot,
      packageManagers: state.lockManagers,
      message: "Multiple JavaScript package-manager locks exist at the same project root."
    });
  }
  if (state.mismatch) {
    addFinding({
      code: "PACKAGE_MANAGER_DECLARATION_MISMATCH",
      severity: "needs-review",
      projectRoot,
      message: "packageManager disagrees with the lock-file manager at this project root."
    });
  }
}

function readPackageInfo(repositoryRoot, projectRoot, files) {
  const relativePath = joinRoot(projectRoot, "package.json");
  if (!files.has(relativePath)) {
    return {
      exists: false,
      valid: false,
      packageManager: null,
      packageManagerPresent: false,
      packageManagerInvalid: false,
      workspacesValid: false,
      workspacesInvalid: false
    };
  }
  let parsed;
  try {
    parsed = readBoundedRepositoryJson(repositoryRoot, relativePath, maximumPackageJsonBytes, "package.json");
    assertPlainObject(parsed, "package.json");
  } catch {
    return {
      exists: true,
      valid: false,
      packageManager: null,
      packageManagerPresent: false,
      packageManagerInvalid: false,
      workspacesValid: false,
      workspacesInvalid: false
    };
  }

  const packageManagerPresent = Object.hasOwn(parsed, "packageManager");
  let packageManager = null;
  let packageManagerInvalid = false;
  if (packageManagerPresent) {
    const declaration = parsed.packageManager;
    const match = typeof declaration === "string"
      ? /^(bun|npm|pnpm|yarn)@([0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?)$/u.exec(declaration)
      : null;
    if (!match) packageManagerInvalid = true;
    else packageManager = { name: match[1], version: match[2], major: Number.parseInt(match[2], 10) };
  }

  const workspacesPresent = Object.hasOwn(parsed, "workspaces");
  const workspacesValid = workspacesPresent && validWorkspaceDeclaration(parsed.workspaces);
  return {
    exists: true,
    valid: true,
    packageManager,
    packageManagerPresent,
    packageManagerInvalid,
    workspacesValid,
    workspacesInvalid: workspacesPresent && !workspacesValid
  };
}

function validWorkspaceDeclaration(value) {
  const packages = Array.isArray(value)
    ? value
    : value !== null && typeof value === "object" && !Array.isArray(value)
      ? value.packages
      : null;
  return Array.isArray(packages) && packages.length > 0 && packages.every(validWorkspacePattern);
}

function validWorkspacePattern(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 256 || value !== value.normalize("NFC")) return false;
  try {
    assertSafeVisibleText(value, "workspace pattern", 256);
  } catch {
    return false;
  }
  if (value.startsWith("/") || value.includes("\\") || value.includes("//")) return false;
  return value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function resolveYarnGeneration(projectRoot, info, files) {
  const signals = new Set();
  if (info.packageManager?.name === "yarn") signals.add(info.packageManager.major === 1 ? "classic" : "modern");
  if (files.has(joinRoot(projectRoot, ".yarnrc"))) signals.add("classic");
  if (files.has(joinRoot(projectRoot, ".yarnrc.yml"))) signals.add("modern");
  const releasePrefix = joinRoot(projectRoot, ".yarn/releases/");
  for (const relativePath of files) {
    if (relativePath.startsWith(releasePrefix) && relativePath.endsWith(".cjs")) signals.add("modern");
  }
  return signals.size === 1 ? [...signals][0] : null;
}

function readUnityEditorVersion(repositoryRoot, projectRoot, files) {
  const relativePath = joinRoot(projectRoot, "ProjectSettings/ProjectVersion.txt");
  if (!files.has(relativePath)) return { fileExists: false, valid: false, version: null };
  try {
    const text = readBoundedRepositoryText(repositoryRoot, relativePath, maximumUnityVersionBytes, "Unity editor version");
    const match = /^m_EditorVersion:\s*([0-9]+\.[0-9]+\.[0-9]+[abfp][0-9]+(?:[-.A-Za-z0-9]*)?)\s*$/mu.exec(text);
    return match ? { fileExists: true, valid: true, version: match[1] } : { fileExists: true, valid: false, version: null };
  } catch {
    return { fileExists: true, valid: false, version: null };
  }
}

function readBoundedRepositoryJson(repositoryRoot, relativePath, maximumBytes, label) {
  return parseStrictJson(readBoundedRepositoryText(repositoryRoot, relativePath, maximumBytes, label), label);
}

function readBoundedRepositoryText(repositoryRoot, relativePath, maximumBytes, label) {
  const absolute = path.join(repositoryRoot, ...relativePath.split("/"));
  const stat = fs.lstatSync(absolute);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size > maximumBytes) throw new Error(`${label} is not a bounded regular file`);
  try {
    const raw = fs.readFileSync(absolute);
    if (raw.length > maximumBytes) throw new Error(`${label} exceeds its byte bound`);
    const text = utf8Decoder.decode(raw);
    if (text.charCodeAt(0) === 0xfeff) throw new Error(`${label} contains a byte-order mark`);
    return text;
  } catch {
    throw new Error(`${label} is not valid UTF-8`);
  }
}

function buildMatch({ profile, projectRoot, markers, required, locks, pins, status, packageManager = null, yarnGeneration = null }) {
  const manifests = [...new Set([...markers, ...required.present])].sort(compareUtf8);
  const match = {
    id: profile.id,
    label: profile.label,
    profileDigest: profile.profileDigest,
    projectRoot,
    status,
    manifests,
    missingRequiredFiles: required.missing,
    locks: [...locks].sort(compareUtf8),
    pins,
    suggestedChecks: selectSuggestedChecks(profile, { packageManager, yarnGeneration }),
    commandsExecuted: false
  };
  if (packageManager) match.packageManager = packageManager;
  if (profile.id === "yarn") match.yarnGeneration = yarnGeneration;
  return match;
}

function selectSuggestedChecks(profile, { packageManager, yarnGeneration }) {
  return profile.suggestedChecks
    .filter((check) => check.when === "always"
      || (check.when === "manager-resolved" && packageManager !== null)
      || (check.when === "yarn-classic" && yarnGeneration === "classic")
      || (check.when === "yarn-modern" && yarnGeneration === "modern"))
    .map((check) => ({
      id: check.id,
      when: check.when,
      argv: check.argv.map((argument) => argument === "<package-manager>" ? packageManager : argument)
    }));
}

function addCompletenessFindings({ addFinding, lockComplete, profile, projectRoot, required }) {
  if (!required.complete) {
    addFinding({
      code: "REQUIRED_BUILD_FILE_NOT_FOUND",
      severity: "needs-review",
      profileId: profile.id,
      projectRoot,
      missingFiles: required.missing,
      message: `The ${profile.label} root marker was detected without every required build file.`
    });
  }
  if (!lockComplete) {
    addFinding({
      code: "BUILD_LOCK_NOT_FOUND",
      severity: "needs-review",
      profileId: profile.id,
      projectRoot,
      message: `The ${profile.label} manifest was detected without a root-bound deterministic lock signal.`
    });
  }
}

function rootOfFile(relativePath) {
  const directory = path.posix.dirname(relativePath);
  return directory === "." ? "." : directory;
}

function joinRoot(projectRoot, relativePath) {
  return projectRoot === "." ? relativePath : `${projectRoot}/${relativePath}`;
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function compareFindings(left, right) {
  return compareUtf8(
    `${left.code}\0${left.profileId ?? ""}\0${left.projectRoot ?? ""}\0${left.message}`,
    `${right.code}\0${right.profileId ?? ""}\0${right.projectRoot ?? ""}\0${right.message}`
  );
}

function sameStringArray(left, right) {
  return Array.isArray(left) && left.length === right.length && left.every((value, index) => value === right[index]);
}

function semanticDigest(domain, value) {
  return sha256Hex(Buffer.concat([Buffer.from(domain, "utf8"), Buffer.from([0]), Buffer.from(canonicalJson(value), "utf8")]));
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value) {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("canonical JSON only supports safe integers");
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  assertPlainObject(value, "canonical JSON value");
  return `{${Object.keys(value).sort(compareUtf8).map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function parseStrictJson(text, label) {
  let index = 0;
  let nodes = 0;

  const fail = (message) => {
    throw new Error(`${label} is invalid JSON: ${message}`);
  };
  const whitespace = () => {
    while (index < text.length && /[\u0009\u000a\u000d\u0020]/u.test(text[index])) index += 1;
  };
  const string = () => {
    if (text[index] !== "\"") fail("expected string");
    const start = index;
    index += 1;
    let escaped = false;
    while (index < text.length) {
      const character = text[index];
      if (!escaped && character === "\"") {
        index += 1;
        try {
          const parsed = JSON.parse(text.slice(start, index));
          if (hasLoneSurrogate(parsed)) fail("lone surrogate in string");
          return parsed;
        } catch (error) {
          if (error instanceof Error && error.message.startsWith(`${label} is invalid JSON:`)) throw error;
          fail("malformed string");
        }
      }
      if (!escaped && character === "\\") escaped = true;
      else escaped = false;
      index += 1;
    }
    fail("unterminated string");
  };
  const value = (depth) => {
    nodes += 1;
    if (nodes > maximumJsonNodes || depth > maximumJsonDepth) fail("structure exceeds bounds");
    whitespace();
    const character = text[index];
    if (character === "{") {
      index += 1;
      whitespace();
      const object = {};
      const keys = new Set();
      if (text[index] === "}") {
        index += 1;
        return object;
      }
      while (index < text.length) {
        whitespace();
        const key = string();
        if (keys.has(key)) fail(`duplicate object key ${JSON.stringify(key)}`);
        keys.add(key);
        whitespace();
        if (text[index] !== ":") fail("expected colon");
        index += 1;
        object[key] = value(depth + 1);
        whitespace();
        if (text[index] === "}") {
          index += 1;
          return object;
        }
        if (text[index] !== ",") fail("expected comma");
        index += 1;
      }
      fail("unterminated object");
    }
    if (character === "[") {
      index += 1;
      whitespace();
      const array = [];
      if (text[index] === "]") {
        index += 1;
        return array;
      }
      while (index < text.length) {
        array.push(value(depth + 1));
        whitespace();
        if (text[index] === "]") {
          index += 1;
          return array;
        }
        if (text[index] !== ",") fail("expected comma");
        index += 1;
      }
      fail("unterminated array");
    }
    if (character === "\"") return string();
    for (const [token, parsed] of [["true", true], ["false", false], ["null", null]]) {
      if (text.startsWith(token, index)) {
        index += token.length;
        return parsed;
      }
    }
    const number = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/u.exec(text.slice(index));
    if (number) {
      index += number[0].length;
      const parsed = Number(number[0]);
      if (!Number.isFinite(parsed)) fail("number is not finite");
      return parsed;
    }
    fail("unexpected token");
  };

  const parsed = value(0);
  whitespace();
  if (index !== text.length) fail("trailing data");
  return parsed;
}

function hasLoneSurrogate(value) {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return true;
  }
  return false;
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
