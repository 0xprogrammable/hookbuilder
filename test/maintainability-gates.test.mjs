import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createRepositoryCheckPlan } from "../scripts/repository-check-core.mjs";
import {
  dependencyAdvisoryMarkdown,
  normalizeNpmAuditReport
} from "../scripts/quality/dependency-advisory-core.mjs";
import {
  loadCoverageBaseline,
  validateCoverageBaseline
} from "../scripts/quality/coverage-baseline.mjs";
import { evaluateSizeBudget, loadSizeBudget } from "../scripts/quality/size-budget.mjs";
import {
  buildStaticModuleGraph,
  lexicalComplexity,
  staticModuleSpecifiers
} from "../scripts/quality/module-maintainability-core.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("critical coverage baseline stays source-bound to its declared narrow scope", () => {
  const baseline = loadCoverageBaseline(repositoryRoot);
  assert.equal(baseline.observation.scope, "exact-working-tree-source-bytes");
  assert.equal(baseline.observation.repositoryWideCoverageClaimed, false);
  assert.equal(baseline.groups.flatMap(({ modules }) => modules).length, 23);
  assert.deepEqual(baseline.groups.map(({ id }) => id), [
    "canonical-json-core",
    "github-application-responsibility",
    "public-claims-responsibility",
    "strict-json-core",
    "trade-routing-responsibility"
  ]);
  assert.deepEqual(baseline.groups.map(({ modules }) => modules.map(({ path: modulePath }) => modulePath)), [
    ["skills/programmable-v4-hook-builder/scripts/canonical-json-core.mjs"],
    [
      "skills/programmable-v4-hook-builder/scripts/github-application-constants.mjs",
      "skills/programmable-v4-hook-builder/scripts/github-application-core.mjs",
      "skills/programmable-v4-hook-builder/scripts/github-application-flow-core.mjs",
      "skills/programmable-v4-hook-builder/scripts/github-application-normalizers.mjs",
      "skills/programmable-v4-hook-builder/scripts/github-application-prepared-core.mjs",
      "skills/programmable-v4-hook-builder/scripts/github-application-primitives.mjs",
      "skills/programmable-v4-hook-builder/scripts/github-application-remote-core.mjs",
      "skills/programmable-v4-hook-builder/scripts/github-application-status-core.mjs",
      "skills/programmable-v4-hook-builder/scripts/github-application-transport-core.mjs"
    ],
    [
      "skills/programmable-v4-hook-builder/scripts/public-claims-analysis-primitives.mjs",
      "skills/programmable-v4-hook-builder/scripts/public-claims-core.mjs",
      "skills/programmable-v4-hook-builder/scripts/public-claims-format-extractors.mjs",
      "skills/programmable-v4-hook-builder/scripts/public-claims-javascript-core.mjs",
      "skills/programmable-v4-hook-builder/scripts/public-claims-javascript-evaluator.mjs",
      "skills/programmable-v4-hook-builder/scripts/public-claims-javascript-primitives.mjs",
      "skills/programmable-v4-hook-builder/scripts/public-claims-javascript-tokenizer.mjs",
      "skills/programmable-v4-hook-builder/scripts/public-claims-rules.mjs",
      "skills/programmable-v4-hook-builder/scripts/public-claims-source-analysis.mjs"
    ],
    ["skills/programmable-v4-hook-builder/scripts/strict-json-core.mjs"],
    [
      "skills/programmable-v4-hook-builder/scripts/trade-capability-manifest-core.mjs",
      "skills/programmable-v4-hook-builder/scripts/v4-deployment-evidence-core.mjs",
      "skills/programmable-v4-hook-builder/scripts/v4-hook-semantic-contract-core.mjs"
    ]
  ]);
});

test("critical coverage groups reject omissions facade-only rebases and weaker historical floors", () => {
  const rawBaseline = JSON.parse(fs.readFileSync(
    path.join(repositoryRoot, "config/maintainability-coverage-baseline.json"),
    "utf8"
  ));

  const omittedSupport = structuredClone(rawBaseline);
  omittedSupport.groups[1].modules.splice(2, 1);
  assert.throws(
    () => validateCoverageBaseline(omittedSupport, { repositoryRoot }),
    /github-application-responsibility coverage group module inventory must exactly match/u
  );

  const facadeOnly = structuredClone(rawBaseline);
  facadeOnly.groups[2].modules = facadeOnly.groups[2].modules.filter(({ path: modulePath }) => (
    modulePath.endsWith("/public-claims-core.mjs")
  ));
  assert.throws(
    () => validateCoverageBaseline(facadeOnly, { repositoryRoot }),
    /public-claims-responsibility coverage group module inventory must exactly match/u
  );

  const facadeCounters = structuredClone(rawBaseline);
  facadeCounters.groups[1].observed.lines = { covered: 29, found: 29 };
  assert.throws(
    () => validateCoverageBaseline(facadeCounters, { repositoryRoot }),
    /github-application-responsibility observed surface cannot be smaller/u
  );

  const weakerThreshold = structuredClone(rawBaseline);
  weakerThreshold.groups[2].minimumBasisPoints.branches = 7199;
  assert.throws(
    () => validateCoverageBaseline(weakerThreshold, { repositoryRoot }),
    /public-claims-responsibility coverage threshold cannot be lower/u
  );

  const routingFacadeOnly = structuredClone(rawBaseline);
  routingFacadeOnly.groups[4].modules = routingFacadeOnly.groups[4].modules.filter(({ path: modulePath }) => (
    modulePath.endsWith("/trade-capability-manifest-core.mjs")
  ));
  assert.throws(
    () => validateCoverageBaseline(routingFacadeOnly, { repositoryRoot }),
    /trade-routing-responsibility coverage group module inventory must exactly match/u
  );

  const routingSurfaceCounters = structuredClone(rawBaseline);
  routingSurfaceCounters.groups[4].observed.branches = { covered: 8, found: 8 };
  assert.throws(
    () => validateCoverageBaseline(routingSurfaceCounters, { repositoryRoot }),
    /trade-routing-responsibility observed surface cannot be smaller/u
  );

  const weakerRoutingThreshold = structuredClone(rawBaseline);
  weakerRoutingThreshold.groups[4].minimumBasisPoints.functions = 7799;
  assert.throws(
    () => validateCoverageBaseline(weakerRoutingThreshold, { repositoryRoot }),
    /trade-routing-responsibility coverage threshold cannot be lower/u
  );
});

test("npm audit v2 reports are normalized without inventing remediation availability", () => {
  const normalized = normalizeNpmAuditReport({
    auditReportVersion: 2,
    vulnerabilities: {
      alpha: {
        name: "alpha",
        severity: "high",
        isDirect: true,
        range: "<2.0.0",
        via: [{ source: 1234 }, "transitive"],
        fixAvailable: { name: "alpha", version: "2.0.0", isSemVerMajor: true }
      },
      beta: {
        name: "beta",
        severity: "low",
        isDirect: false,
        range: "*",
        via: [{ source: "GHSA-example" }]
      }
    },
    metadata: {
      vulnerabilities: {
        info: 0,
        low: 1,
        moderate: 0,
        high: 1,
        critical: 0,
        total: 2
      }
    }
  }, "repository");

  assert.equal(normalized.status, "ADVISORIES_REPORTED");
  assert.deepEqual(normalized.counts, {
    info: 0,
    low: 1,
    moderate: 0,
    high: 1,
    critical: 0,
    total: 2
  });
  assert.deepEqual(normalized.vulnerablePackages.map(({ name }) => name), ["alpha", "beta"]);
  assert.equal(normalized.vulnerablePackages[0].fixAvailable, true);
  assert.equal(normalized.vulnerablePackages[1].fixAvailable, false);
  assert.deepEqual(normalized.vulnerablePackages[0].advisoryIds, ["1234"]);
  assert.deepEqual(normalized.vulnerablePackages[1].advisoryIds, ["GHSA-example"]);

  const markdown = dependencyAdvisoryMarkdown({
    status: "ADVISORIES_REPORTED",
    packages: [normalized]
  });
  assert.match(markdown, /Read-only report/u);
  assert.match(markdown, /\| repository \| 2 \| 0 \| 1 \| 0 \| 1 \| 0 \|/u);
  assert.match(markdown, /no dependency files, commits, branches, pull requests, issues, or releases were created/u);
});

test("npm audit normalization rejects unsupported and internally inconsistent reports", () => {
  assert.throws(() => normalizeNpmAuditReport({ auditReportVersion: 1 }, "repository"), /version 2 is required/u);
  assert.throws(() => normalizeNpmAuditReport({
    auditReportVersion: 2,
    vulnerabilities: {},
    metadata: {
      vulnerabilities: {
        info: 0,
        low: 0,
        moderate: 0,
        high: 0,
        critical: 0,
        total: 1
      }
    }
  }, "repository"), /total is inconsistent/u);
});

test("scheduled supply-chain workflow exposes advisories exact deprecations and upstream drift without write authority", () => {
  const workflow = fs.readFileSync(path.join(repositoryRoot, ".github/workflows/dependency-advisory.yml"), "utf8");
  assert.match(workflow, /\n  schedule:\n/u);
  assert.match(workflow, /\n  workflow_dispatch:\n/u);
  assert.match(workflow, /permissions:\n  contents: read\n/u);
  assert.equal((workflow.match(/persist-credentials: false/gu) ?? []).length, 1);
  assert.equal((workflow.match(/uses: actions\/checkout@[0-9a-f]{40}/gu) ?? []).length, 1);
  assert.equal((workflow.match(/uses: actions\/setup-node@[0-9a-f]{40}/gu) ?? []).length, 1);
  const actionReferences = [...workflow.matchAll(/^\s*uses:\s*(\S+)/gmu)].map((match) => match[1]);
  assert.ok(actionReferences.length > 0);
  assert.ok(actionReferences.every((reference) => /@[0-9a-f]{40}$/u.test(reference)));
  assert.equal((workflow.match(/node scripts\/quality\/dependency-advisory\.mjs/gu) ?? []).length, 1);
  assert.equal((workflow.match(/node scripts\/quality\/package-deprecation\.mjs/gu) ?? []).length, 1);
  assert.equal((workflow.match(/node skills\/programmable-v4-hook-builder\/scripts\/check-upstream-drift\.mjs/gu) ?? []).length, 1);
  assert.equal((workflow.match(/if: \$\{\{ always\(\) \}\}/gu) ?? []).length, 2);
  assert.equal((workflow.match(/GITHUB_TOKEN: \$\{\{ github\.token \}\}/gu) ?? []).length, 1);
  assert.match(workflow, /- name: Fail on unreviewed upstream source drift[\s\S]*?env:\n\s+GITHUB_TOKEN: \$\{\{ github\.token \}\}[\s\S]*?check-upstream-drift\.mjs/u);
  assert.doesNotMatch(workflow, /\$\{\{ secrets\./u);
  assert.match(workflow, /check-upstream-drift\.mjs\n\s+--json/u);
  assert.doesNotMatch(workflow, /uses:\s+[^\s]+@(?:main|master|v[0-9])/u);
  for (const forbidden of [
    /dependabot/iu,
    /\bpull_request\b/u,
    /\bpush\s*:/u,
    /^\s+[a-z-]+:\s*write\s*$/imu,
    /\bissues\s*:\s*write\b/u,
    /\bcontents\s*:\s*write\b/u,
    /create-pull-request/iu,
    /actions\/upload-artifact/iu,
    /\bgh\s+(?:pr|issue|release)\b/u,
    /\bgit\s+(?:add|commit|push|tag)\b/u,
    /\bnpm\s+publish\b/u,
    /\bnpm\s+(?:install|update|uninstall)\b/u
  ]) {
    assert.doesNotMatch(workflow, forbidden);
  }
});

test("package scripts keep deterministic maintainability checks separate from the network advisory query", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8"));
  assert.equal(packageJson.scripts["quality:coverage"], "node scripts/quality/coverage-baseline.mjs");
  assert.equal(packageJson.scripts["quality:mutations"], "node scripts/quality/mutation-gate.mjs");
  assert.equal(packageJson.scripts["quality:advisories"], "node scripts/quality/dependency-advisory.mjs");
  assert.equal(packageJson.scripts["quality:size"], "node scripts/quality/size-budget.mjs");
  assert.equal(packageJson.scripts["quality:maintainability"], "npm run quality:coverage && npm run quality:mutations && npm run quality:size");
  assert.doesNotMatch(packageJson.scripts["quality:maintainability"], /advis/u);
  assert.doesNotMatch(packageJson.scripts["quality:maintainability"], /npm test/u);

  const plan = createRepositoryCheckPlan({
    nodeExecutable: process.execPath,
    npmExecutable: "npm",
    e2eTests: [
      "evals/tests/e2e-corpus.test.mjs",
      "evals/tests/e2e-run.test.mjs",
      "evals/tests/run-e2e-evals.test.mjs"
    ],
    mcpTests: ["mcp/test/server.test.mjs"],
    repositoryTests: ["test/repository-contract.test.mjs"]
  });
  const maintainabilityChecks = plan.filter(({ id }) => id === "maintainability");
  assert.equal(maintainabilityChecks.length, 1);
  assert.equal(maintainabilityChecks[0].command, "npm");
  assert.deepEqual(maintainabilityChecks[0].args, ["run", "quality:maintainability"]);

  const workflow = fs.readFileSync(path.join(repositoryRoot, ".github/workflows/ci.yml"), "utf8");
  assert.equal((workflow.match(/^\s*run:\s+npm test\s*$/gmu) ?? []).length, 1);
  assert.doesNotMatch(workflow, /quality:maintainability/u);
});

test("all canonical production modules and the portable package stay inside reviewed non-regression budgets", () => {
  const budget = loadSizeBudget(repositoryRoot);
  const report = evaluateSizeBudget({ repositoryRoot, budget });
  const independentlyDiscovered = discoverCanonicalProductionModules(budget.productionModules.roots);
  assert.equal(report.status, "SIZE_BUDGET_PASSED");
  assert.equal(report.broadQualityClaimed, false);
  assert.deepEqual(report.discovery.roots, [
    { path: "scripts/quality", extension: ".mjs", excludedDirectoryNames: [] },
    { path: "skills/programmable-v4-hook-builder/scripts", extension: ".mjs", excludedDirectoryNames: ["test"] }
  ]);
  assert.equal(report.discovery.allDiscoveredFilesEvaluated, true);
  assert.equal(report.modules.length, report.discovery.discoveredFiles);
  assert.deepEqual(report.modules.map(({ path: modulePath }) => modulePath), independentlyDiscovered);
  assert.ok(report.discovery.discoveredFiles > report.discovery.baselineFiles);
  assert.ok(report.modules.every(({ classification }) => [
    "manifest-baseline-no-growth",
    "reviewed-baseline-no-growth",
    "new-file-hard-cap"
  ].includes(classification)));
  for (const requiredModule of [
    "scripts/quality/module-maintainability-core.mjs",
    "scripts/quality/package-deprecation-core.mjs",
    "scripts/quality/package-deprecation.mjs",
    "skills/programmable-v4-hook-builder/scripts/semantic-rule-registry-core.mjs",
    "skills/programmable-v4-hook-builder/scripts/semantic-rule-registry-evidence-core.mjs",
    "skills/programmable-v4-hook-builder/scripts/v4-hook-semantic-contract-core.mjs",
    "skills/programmable-v4-hook-builder/scripts/validate-semantic-rule-registry.mjs"
  ]) assert.ok(report.modules.some(({ path: modulePath }) => modulePath === requiredModule));
  assert.equal(report.machineDebt.staticComplexity.measured, true);
  assert.equal(report.machineDebt.staticComplexity.broadCyclomaticComplexityClaimed, false);
  assert.equal(report.machineDebt.legacyDebtThresholdLines, 750);
  assert.equal(budget.productionModules.newFileHardCaps.maxLines, 750);
  assert.ok(report.machineDebt.modules.every(({ lines }) => lines > 750));
  assert.equal(report.machineDebt.importCycles.measured, true);
  assert.equal(report.machineDebt.importCycles.cycleCount, 0);
  assert.equal(report.machineDebt.importCycles.unresolvedRelativeImportCount, 0);
  assert.equal(report.portablePackage.inventoryProfile, "canonical-portable-package-inclusion-manifest-v1");
  assert.equal(report.portablePackage.maxFiles, 600);
  assert.equal(report.portablePackage.maxBytes, 8_000_000);
  assert.ok(report.portablePackage.files <= report.portablePackage.maxFiles);
  assert.ok(report.portablePackage.bytes <= report.portablePackage.maxBytes);

  const reduced = structuredClone(budget);
  reduced.productionModules.newFileHardCaps.maxLines = 1;
  assert.equal(evaluateSizeBudget({ repositoryRoot, budget: reduced }).status, "SIZE_BUDGET_EXCEEDED");

  const unboundBaseline = structuredClone(budget);
  unboundBaseline.productionModules.legacyBaseline.manifestSha256 = `sha256:${"0".repeat(64)}`;
  assert.throws(
    () => evaluateSizeBudget({ repositoryRoot, budget: unboundBaseline }),
    /baseline manifest sha256 mismatch/u
  );
});

function discoverCanonicalProductionModules(rootSpecifications) {
  const discovered = [];
  const visit = (relativeDirectory, specification) => {
    const absoluteDirectory = path.join(repositoryRoot, relativeDirectory);
    for (const entry of fs.readdirSync(absoluteDirectory, { withFileTypes: true })) {
      const relativePath = path.posix.join(relativeDirectory, entry.name);
      if (entry.isDirectory()) {
        if (!specification.excludedDirectoryNames.includes(entry.name)) visit(relativePath, specification);
      } else if (entry.isFile() && entry.name.endsWith(specification.extension)) {
        discovered.push(relativePath);
      }
    }
  };
  for (const specification of rootSpecifications) visit(specification.path, specification);
  return discovered.sort((left, right) => left.localeCompare(right));
}

test("lexical complexity excludes comments and strings while counting reviewed branch tokens", () => {
  const source = `
    // if (ignored && ignored) {}
    const text = "while (ignored || ignored)";
    if (enabled && ready) {
      for (const item of items) use(item ?? fallback);
    }
  `;
  const report = lexicalComplexity(source);
  assert.equal(report.profile, "dependency-free-lexical-branch-proxy-v1");
  assert.deepEqual(report.breakdown, {
    branchKeywords: 2,
    switchCases: 0,
    logicalBranches: 1,
    nullishBranches: 1,
    conditionalBranches: 0
  });
  assert.equal(report.score, 5);
  assert.equal(report.maxBlockDepth, 1);
});

test("static ESM graph resolves multiline imports and reports cycles and unresolved edges", () => {
  const root = "skills/programmable-v4-hook-builder/scripts";
  const a = `${root}/a.mjs`;
  const b = `${root}/b.mjs`;
  const c = `${root}/c.mjs`;
  const sourceByPath = new Map([
    [a, `import {\n  b\n} from "./b.mjs";\nexport const a = b;\n`],
    [b, `export * as cycle from "./a.mjs";\n`],
    [c, `import "./missing.mjs";\n`]
  ]);
  assert.deepEqual(staticModuleSpecifiers(sourceByPath.get(a)), ["./b.mjs"]);
  const graph = buildStaticModuleGraph({ modulePaths: [a, b, c], sourceByPath });
  assert.deepEqual(graph.cycles, [[a, b]]);
  assert.deepEqual(graph.unresolvedRelativeImports, [{
    importer: c,
    specifier: "./missing.mjs",
    resolvedPath: `${root}/missing.mjs`
  }]);
});
