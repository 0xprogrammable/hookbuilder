import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPackageDeprecationReport,
  inventoryLockedPackages,
  normalizeRegistryVersionMetadata,
  packageDeprecationMarkdown
} from "../scripts/quality/package-deprecation-core.mjs";

test("exact lock inventory distinguishes direct and nested transitive deprecations", () => {
  const inventory = inventoryLockedPackages("fixture", {
    lockfileVersion: 3,
    packages: {
      "": { dependencies: { "@scope/direct": "1.2.3" } },
      "node_modules/@scope/direct": {
        version: "1.2.3",
        resolved: "https://registry.npmjs.org/@scope/direct/-/direct-1.2.3.tgz",
        integrity: "sha512-exact"
      },
      "node_modules/@scope/direct/node_modules/transitive": {
        version: "2.0.0",
        resolved: "https://registry.npmjs.org/transitive/-/transitive-2.0.0.tgz",
        integrity: "sha512-exact",
        deprecated: "Use transitive 3.0.0."
      }
    }
  });
  assert.deepEqual(inventory.packages.map(({ name, version, direct, deprecated }) => ({ name, version, direct, deprecated })), [
    { name: "@scope/direct", version: "1.2.3", direct: true, deprecated: null },
    { name: "transitive", version: "2.0.0", direct: false, deprecated: "Use transitive 3.0.0." }
  ]);
});

test("registry metadata is bound to the exact requested package version", () => {
  assert.deepEqual(normalizeRegistryVersionMetadata(
    { name: "@scope/direct", version: "1.2.3" },
    { name: "@scope/direct", version: "1.2.3", license: "MIT", deprecated: "Retired." }
  ), {
    name: "@scope/direct",
    version: "1.2.3",
    deprecated: "Retired.",
    license: "MIT"
  });
  assert.throws(
    () => normalizeRegistryVersionMetadata(
      { name: "@scope/direct", version: "1.2.3" },
      { name: "@scope/direct", version: "9.9.9" }
    ),
    /identity mismatch/u
  );
});

test("report gates direct live deprecation and preserves transitive lockfile warnings", () => {
  const inventory = inventoryLockedPackages("fixture", {
    lockfileVersion: 3,
    packages: {
      "": { dependencies: { direct: "1.0.0" } },
      "node_modules/direct": {
        version: "1.0.0",
        resolved: "https://registry.npmjs.org/direct/-/direct-1.0.0.tgz",
        integrity: "sha512-exact"
      },
      "node_modules/legacy": {
        version: "2.0.0",
        resolved: "https://registry.npmjs.org/legacy/-/legacy-2.0.0.tgz",
        integrity: "sha512-exact",
        deprecated: "Legacy package."
      }
    }
  });
  const direct = normalizeRegistryVersionMetadata(
    { name: "direct", version: "1.0.0" },
    { name: "direct", version: "1.0.0", deprecated: "Direct package retired." }
  );
  const report = buildPackageDeprecationReport({
    inventories: [inventory],
    registryRecords: [direct],
    observedAt: "2026-08-07T00:00:00.000Z"
  });
  assert.equal(report.status, "DIRECT_DEPRECATIONS_REPORTED");
  assert.deepEqual(report.counts, { locked: 2, directDeprecated: 1, transitiveDeprecated: 1 });
  assert.match(packageDeprecationMarkdown(report), /direct@1\.0\.0/u);
  assert.match(packageDeprecationMarkdown(report), /legacy@2\.0\.0/u);
});
