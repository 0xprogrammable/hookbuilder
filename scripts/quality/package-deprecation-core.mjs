const packageNamePattern = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/iu;

export function inventoryLockedPackages(packageId, lockfile) {
  if (!plainObject(lockfile) || !plainObject(lockfile.packages) || !plainObject(lockfile.packages[""])) {
    throw new TypeError(`${packageId}: package-lock packages map is required`);
  }
  const root = lockfile.packages[""];
  const directNames = new Set([
    ...Object.keys(plainObject(root.dependencies) ? root.dependencies : {}),
    ...Object.keys(plainObject(root.devDependencies) ? root.devDependencies : {}),
    ...Object.keys(plainObject(root.optionalDependencies) ? root.optionalDependencies : {})
  ]);
  const packages = [];
  for (const [lockPath, record] of Object.entries(lockfile.packages)) {
    if (lockPath === "") continue;
    if (!plainObject(record)) throw new TypeError(`${packageId}: ${lockPath} must be an object`);
    const name = packageNameFromLockPath(lockPath);
    if (!packageNamePattern.test(name)) throw new TypeError(`${packageId}: invalid locked package name ${name}`);
    if (typeof record.version !== "string" || record.version.length === 0 || record.version.length > 200) {
      throw new TypeError(`${packageId}: ${name} has no bounded exact version`);
    }
    const registryBacked = typeof record.resolved === "string"
      && record.resolved.startsWith("https://registry.npmjs.org/")
      && typeof record.integrity === "string"
      && record.integrity.length > 0;
    const deprecated = record.deprecated === undefined
      ? null
      : boundedDeprecation(record.deprecated, `${packageId}: ${name} lockfile deprecation`);
    packages.push(Object.freeze({
      name,
      version: record.version,
      lockPath,
      direct: directNames.has(name) && lockPath === `node_modules/${name}`,
      registryBacked,
      deprecated
    }));
  }
  packages.sort(comparePackageRecords);
  return Object.freeze({
    packageId,
    lockfileVersion: lockfile.lockfileVersion,
    packages: Object.freeze(packages)
  });
}

export function normalizeRegistryVersionMetadata(expected, value) {
  if (!plainObject(expected) || !packageNamePattern.test(expected.name ?? "") || typeof expected.version !== "string") {
    throw new TypeError("expected package identity is invalid");
  }
  if (!plainObject(value) || value.name !== expected.name || value.version !== expected.version) {
    throw new TypeError(`${expected.name}@${expected.version}: registry identity mismatch`);
  }
  const deprecated = value.deprecated === undefined
    ? null
    : boundedDeprecation(value.deprecated, `${expected.name}@${expected.version}: registry deprecation`);
  return Object.freeze({
    name: expected.name,
    version: expected.version,
    deprecated,
    license: normalizeLicense(value.license)
  });
}

export function buildPackageDeprecationReport({ inventories, registryRecords, observedAt }) {
  if (!Array.isArray(inventories) || !Array.isArray(registryRecords)) {
    throw new TypeError("inventories and registryRecords must be arrays");
  }
  if (typeof observedAt !== "string" || Number.isNaN(Date.parse(observedAt))) {
    throw new TypeError("observedAt must be an ISO timestamp");
  }
  const registryByIdentity = new Map();
  for (const record of registryRecords) {
    const key = identityKey(record?.name, record?.version);
    if (registryByIdentity.has(key)) throw new TypeError(`duplicate registry record ${key}`);
    registryByIdentity.set(key, record);
  }
  const packages = [];
  for (const inventory of inventories) {
    for (const record of inventory.packages) {
      const live = record.direct && record.registryBacked
        ? registryByIdentity.get(identityKey(record.name, record.version))
        : null;
      if (record.direct && record.registryBacked && live === undefined) {
        throw new TypeError(`missing exact registry record ${record.name}@${record.version}`);
      }
      packages.push({
        packageId: inventory.packageId,
        name: record.name,
        version: record.version,
        direct: record.direct,
        registryBacked: record.registryBacked,
        lockfileDeprecation: record.deprecated,
        registryDeprecation: live?.deprecated ?? null,
        registryLicense: live?.license ?? null
      });
    }
  }
  packages.sort((left, right) => (
    compareUtf8(left.packageId, right.packageId)
    || compareUtf8(left.name, right.name)
    || compareUtf8(left.version, right.version)
  ));
  const directDeprecated = packages.filter(({ direct, registryDeprecation }) => direct && registryDeprecation !== null);
  const transitiveDeprecated = packages.filter(({ direct, lockfileDeprecation }) => !direct && lockfileDeprecation !== null);
  return Object.freeze({
    schemaVersion: "1.0.0",
    kind: "programmable-exact-package-deprecation-report",
    status: directDeprecated.length > 0
      ? "DIRECT_DEPRECATIONS_REPORTED"
      : transitiveDeprecated.length > 0
        ? "TRANSITIVE_DEPRECATIONS_REPORTED"
        : "NO_DEPRECATIONS_REPORTED",
    observedAt,
    reportOnly: true,
    automaticRemediation: false,
    directRegistryMetadataQueried: true,
    counts: {
      locked: packages.length,
      directDeprecated: directDeprecated.length,
      transitiveDeprecated: transitiveDeprecated.length
    },
    packages: Object.freeze(packages),
    repositoryMutations: Object.freeze([]),
    externalReadsPerformed: Object.freeze(["npm-registry-exact-version-metadata"])
  });
}

export function packageDeprecationMarkdown(report) {
  if (!plainObject(report) || !Array.isArray(report.packages)) throw new TypeError("deprecation report is invalid");
  const findings = report.packages.filter((entry) => (
    entry.lockfileDeprecation !== null || entry.registryDeprecation !== null
  ));
  const lines = [
    "## Exact package deprecation report",
    "",
    "Read-only report: direct packages use live metadata for the exact locked version; transitive findings preserve lockfile metadata.",
    "",
    `Status: **${report.status}**. Locked: ${report.counts.locked}; direct deprecated: ${report.counts.directDeprecated}; transitive deprecated: ${report.counts.transitiveDeprecated}.`,
    ""
  ];
  if (findings.length === 0) return `${lines.join("\n")}No deprecations were reported.\n`;
  lines.push("| Package set | Exact package | Direct | Source | Notice |", "| --- | --- | --- | --- | --- |");
  for (const entry of findings) {
    const notice = entry.registryDeprecation ?? entry.lockfileDeprecation;
    lines.push(`| ${escapeCell(entry.packageId)} | ${escapeCell(`${entry.name}@${entry.version}`)} | ${entry.direct ? "yes" : "no"} | ${entry.registryDeprecation ? "registry" : "lockfile"} | ${escapeCell(notice)} |`);
  }
  return `${lines.join("\n")}\n`;
}

function packageNameFromLockPath(lockPath) {
  if (typeof lockPath !== "string" || !lockPath.includes("node_modules/")) {
    throw new TypeError(`invalid package-lock path ${String(lockPath)}`);
  }
  return lockPath.slice(lockPath.lastIndexOf("node_modules/") + "node_modules/".length);
}

function boundedDeprecation(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.length > 4_096) {
    throw new TypeError(`${label} must be a bounded non-empty string`);
  }
  return value;
}

function normalizeLicense(value) {
  if (typeof value === "string" && value.length > 0 && value.length <= 512) return value;
  if (plainObject(value) && typeof value.type === "string" && value.type.length > 0 && value.type.length <= 512) return value.type;
  return null;
}

function identityKey(name, version) {
  return `${String(name)}@${String(version)}`;
}

function comparePackageRecords(left, right) {
  return compareUtf8(left.name, right.name)
    || compareUtf8(left.version, right.version)
    || compareUtf8(left.lockPath, right.lockPath);
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function escapeCell(value) {
  return String(value).replaceAll("|", "\\|").replace(/[\r\n]+/gu, " ");
}

function plainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
