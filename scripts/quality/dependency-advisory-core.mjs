const severityOrder = Object.freeze(["info", "low", "moderate", "high", "critical"]);
const severitySet = new Set(severityOrder);

export function normalizeNpmAuditReport(value, packageId) {
  if (!isPlainObject(value) || value.auditReportVersion !== 2) {
    throw new Error(`${packageId}: npm audit report version 2 is required`);
  }
  if (!isPlainObject(value.metadata) || !isPlainObject(value.metadata.vulnerabilities)) {
    throw new Error(`${packageId}: npm audit vulnerability metadata is missing`);
  }
  const counts = {};
  let computedTotal = 0;
  for (const severity of severityOrder) {
    const count = value.metadata.vulnerabilities[severity];
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error(`${packageId}: npm audit ${severity} count is invalid`);
    }
    counts[severity] = count;
    computedTotal += count;
  }
  const reportedTotal = value.metadata.vulnerabilities.total;
  if (!Number.isSafeInteger(reportedTotal) || reportedTotal !== computedTotal) {
    throw new Error(`${packageId}: npm audit vulnerability total is inconsistent`);
  }
  counts.total = reportedTotal;

  if (!isPlainObject(value.vulnerabilities)) throw new Error(`${packageId}: npm audit vulnerabilities map is missing`);
  const vulnerablePackages = Object.entries(value.vulnerabilities).map(([key, record]) => (
    normalizeVulnerability(key, record, packageId)
  )).sort((left, right) => compareUtf8(left.name, right.name));
  if (vulnerablePackages.length > 2_000) throw new Error(`${packageId}: npm audit report exceeds the package limit`);

  return Object.freeze({
    packageId,
    status: counts.total === 0 ? "NO_ADVISORIES_REPORTED" : "ADVISORIES_REPORTED",
    counts: Object.freeze(counts),
    vulnerablePackages: Object.freeze(vulnerablePackages)
  });
}

export function dependencyAdvisoryMarkdown(report) {
  if (!isPlainObject(report) || !Array.isArray(report.packages)) throw new TypeError("advisory report is invalid");
  const lines = [
    "## Dependency advisory report",
    "",
    "Read-only report: no dependency files, commits, branches, pull requests, issues, or releases were created.",
    "",
    "| Package | Total | Critical | High | Moderate | Low | Info |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |"
  ];
  for (const entry of report.packages) {
    lines.push(`| ${entry.packageId} | ${entry.counts.total} | ${entry.counts.critical} | ${entry.counts.high} | ${entry.counts.moderate} | ${entry.counts.low} | ${entry.counts.info} |`);
  }
  lines.push("", `Overall status: **${report.status}**.`, "");
  return `${lines.join("\n")}\n`;
}

function normalizeVulnerability(key, record, packageId) {
  if (!isPlainObject(record)) throw new Error(`${packageId}: npm audit vulnerability ${key} is invalid`);
  const name = typeof record.name === "string" && record.name.length > 0 ? record.name : key;
  if (name !== key || name.length > 214 || !/^@?[A-Za-z0-9._/-]+$/u.test(name)) {
    throw new Error(`${packageId}: npm audit vulnerability package name is invalid`);
  }
  if (!severitySet.has(record.severity)) throw new Error(`${packageId}: npm audit severity for ${name} is invalid`);
  if (typeof record.isDirect !== "boolean") throw new Error(`${packageId}: npm audit direct-dependency flag for ${name} is invalid`);
  if (typeof record.range !== "string" || record.range.length > 2_048) {
    throw new Error(`${packageId}: npm audit affected range for ${name} is invalid`);
  }
  const advisoryIds = Array.isArray(record.via)
    ? record.via.flatMap((entry) => {
      if (!isPlainObject(entry)) return [];
      const source = entry.source;
      return (typeof source === "number" && Number.isSafeInteger(source)) || typeof source === "string"
        ? [String(source)]
        : [];
    }).filter((entry) => entry.length > 0 && entry.length <= 128).sort(compareUtf8)
    : [];
  return Object.freeze({
    name,
    severity: record.severity,
    direct: record.isDirect,
    affectedRange: record.range,
    fixAvailable: record.fixAvailable === true || isPlainObject(record.fixAvailable),
    advisoryIds: Object.freeze([...new Set(advisoryIds)])
  });
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
