export function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])]));
}

export function canonicalJson(value) {
  return JSON.stringify(sortValue(value));
}

export function sameValue(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

const severityOrder = Object.freeze({ blocker: 0, review: 1, advisory: 2 });

export function bindFinding(observed, expected, findingPath, code, add, details = {}) {
  if (any(expected === undefined, expected === null, observed === expected)) return;
  add("blocker", code, findingPath, "Bound value does not match its authoritative source.", { ...details, expected, observed: coalesce(observed, null) });
}

export function findingAdder(findings) {
  const seen = new Set();
  return (severity, code, findingPath, message, details = {}) => {
    const key = `${severity}:${code}:${findingPath}:${JSON.stringify(details)}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({ severity, code, path: findingPath, message, details });
  };
}

export function sortedFindings(findings) {
  return findings.sort((left, right) => severityOrder[left.severity] - severityOrder[right.severity]
    || left.code.localeCompare(right.code) || left.path.localeCompare(right.path));
}

export function gitEvidenceError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

export function coalesce(value, fallback) {
  return value == null ? fallback : value;
}

export function any(...conditions) {
  return conditions.some(Boolean);
}

export function all(...conditions) {
  return conditions.every(Boolean);
}
