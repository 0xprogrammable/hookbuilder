import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildPortablePackageInventory,
  loadPortablePackageManifest,
  PortablePackageManifestError
} from "../skills/programmable-v4-hook-builder/scripts/portable-package-manifest-core.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillRoot = path.join(repositoryRoot, "skills", "programmable-v4-hook-builder");

test("canonical inclusion manifest owns the lean installed package boundary", () => {
  const manifest = loadPortablePackageManifest({ repositoryRoot, skillRoot });
  const inventory = buildPortablePackageInventory({ manifest, repositoryRoot, skillRoot });

  assert.equal(manifest.sourceRoot, "skills/programmable-v4-hook-builder");
  assert.equal(manifest.exclusions.length, 1);
  const [repositoryTests] = manifest.exclusions;
  assert.deepEqual({
    classification: repositoryTests.classification,
    path: repositoryTests.path,
    recursive: repositoryTests.recursive,
    repositoryPath: repositoryTests.repositoryPath,
    repositoryDigestAlgorithm: repositoryTests.repositoryDigestAlgorithm
  }, {
    classification: "test-only",
    path: "scripts/test",
    recursive: true,
    repositoryPath: "test/portable-skill",
    repositoryDigestAlgorithm: "sha256-path-nul-size-nul-content-nul-v1"
  });
  assert.equal(repositoryTests.repositoryFiles, 95);
  assert.ok(repositoryTests.repositoryBytes > 2_500_000);
  assert.match(repositoryTests.repositorySha256, /^[0-9a-f]{64}$/u);
  assert.equal(inventory.packageFiles.some(({ path: relativePath }) => relativePath.startsWith("scripts/test/")), false);
  assert.equal(inventory.packageFiles.some(({ path: relativePath }) => relativePath.endsWith(".test.mjs")), true,
    "frozen reference-kernel replay tests remain portable");
  assert.equal(inventory.repositoryOnly.files, 95);
  assert.equal(inventory.repositoryOnly.bytes, repositoryTests.repositoryBytes);
  assert.equal(inventory.repositoryOnly.sourcesVerified, true);
  assert.equal(inventory.repositoryOnly.sources[0].sha256, repositoryTests.repositorySha256);
  assert.ok(inventory.packageFiles.length < 600);
  assert.ok(inventory.packageBytes < 8_000_000);
});

test("manifest rejects a test-only file leaking back into the published skill", (t) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-portable-package-leak-"));
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  const fixtureSkill = path.join(fixtureRoot, "skills", "programmable-v4-hook-builder");
  const fixtureTests = path.join(fixtureRoot, "test", "portable-skill");
  fs.cpSync(skillRoot, fixtureSkill, { recursive: true });
  fs.cpSync(path.join(repositoryRoot, "test", "portable-skill"), fixtureTests, { recursive: true });
  fs.mkdirSync(path.join(fixtureSkill, "scripts", "test"), { recursive: true });
  fs.writeFileSync(path.join(fixtureSkill, "scripts", "test", "leak.test.mjs"), "// test-only leak\n");

  const manifest = loadPortablePackageManifest({ repositoryRoot: fixtureRoot, skillRoot: fixtureSkill });
  assert.throws(
    () => buildPortablePackageInventory({ manifest, repositoryRoot: fixtureRoot, skillRoot: fixtureSkill }),
    (error) => error instanceof PortablePackageManifestError
      && error.code === "PORTABLE_PACKAGE_EXCLUSION_LEAK"
      && /scripts\/test\/leak\.test\.mjs/u.test(error.message)
  );
});

test("manifest requires the repository-only test source without publishing it", (t) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-portable-package-source-"));
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  const fixtureSkill = path.join(fixtureRoot, "skills", "programmable-v4-hook-builder");
  fs.cpSync(skillRoot, fixtureSkill, { recursive: true });

  const manifest = loadPortablePackageManifest({ repositoryRoot: fixtureRoot, skillRoot: fixtureSkill });
  assert.throws(
    () => buildPortablePackageInventory({ manifest, repositoryRoot: fixtureRoot, skillRoot: fixtureSkill }),
    (error) => error instanceof PortablePackageManifestError
      && error.code === "PORTABLE_PACKAGE_REPOSITORY_SOURCE_MISSING"
      && /test\/portable-skill/u.test(error.message)
  );
});

test("manifest detects any repository-only test source drift", (t) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-portable-package-drift-"));
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  const fixtureSkill = path.join(fixtureRoot, "skills", "programmable-v4-hook-builder");
  const fixtureTests = path.join(fixtureRoot, "test", "portable-skill");
  fs.cpSync(skillRoot, fixtureSkill, { recursive: true });
  fs.cpSync(path.join(repositoryRoot, "test", "portable-skill"), fixtureTests, { recursive: true });
  fs.appendFileSync(path.join(fixtureTests, "cli.test.mjs"), "\n// drift\n");

  const manifest = loadPortablePackageManifest({ repositoryRoot: fixtureRoot, skillRoot: fixtureSkill });
  assert.throws(
    () => buildPortablePackageInventory({ manifest, repositoryRoot: fixtureRoot, skillRoot: fixtureSkill }),
    (error) => error instanceof PortablePackageManifestError
      && error.code === "PORTABLE_PACKAGE_REPOSITORY_SOURCE_DRIFT"
      && /test\/portable-skill/u.test(error.message)
  );
});
