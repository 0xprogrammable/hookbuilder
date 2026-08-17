import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  DEFAULT_PUBLIC_APPLICANT_VALIDATOR_PROFILE,
  PUBLIC_APPLICANT_VALIDATOR_PACKAGE_LIMITS,
  ValidatorPackageError,
  generateApplicantValidatorPackageClosure,
  materializeApplicantValidatorPackage,
  verifyApplicantValidatorPackage
} from "../../skills/programmable-v4-hook-builder/scripts/applicant-validator-package-core.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const skillRoot = path.join(repositoryRoot, "skills/programmable-v4-hook-builder");

test("the public Applicant facade is one stable import surface", async () => {
  const validator = await import("../../skills/programmable-v4-hook-builder/scripts/public-applicant-validator.mjs");
  for (const name of [
    "canonicalJson",
    "validateAgainstSchema",
    "parseBoundedStrictJsonBytes",
    "createOpenWorldV2ValidationRuntime",
    "validateOpenWorldV2Graph",
    "finalizeOpenWorldV2Validation",
    "validateSourceClosure",
    "createAnonymousGitHubExactObjectResolverV1"
  ]) assert.equal(typeof validator[name], "function", name);
  assert.equal(typeof validator.PROGRAMMABLE_FEE_V2, "object");
});

test("the default package is a deterministic minimal closed dependency set", () => {
  const first = generateApplicantValidatorPackageClosure({ skillRoot });
  const second = generateApplicantValidatorPackageClosure({ skillRoot });
  assert.deepEqual(first.receipt, second.receipt);
  assert.deepEqual(first.receiptBytes, second.receiptBytes);
  assert.equal(first.receipt.entrypoint, "scripts/public-applicant-validator.mjs");
  assert.equal(first.receipt.fileCount, first.receipt.files.length);
  assert.equal(first.receipt.fileCount, 128);
  assert.equal(PUBLIC_APPLICANT_VALIDATOR_PACKAGE_LIMITS.aggregateBytes, 16 * 1024 * 1024);
  assert.equal(first.receipt.files.some(({ path: filePath }) => filePath === "SKILL.md"), false);
  assert.equal(first.receipt.files.some(({ path: filePath }) => filePath.startsWith("assets/templates/")), false);
  assert.equal(first.receipt.files.some(({ path: filePath }) => filePath === "references/open-world-security-v1.schema.json"), true);
  assert.equal(first.receipt.files.some(({ path: filePath }) => filePath === "references/submission-schema-catalog.json"), true);
  assert.match(first.receipt.closureSha256, /^sha256:[0-9a-f]{64}$/u);
  assert.deepEqual(first.receipt.authority, {
    candidateCodeExecuted: false,
    credentialsUsed: false,
    externalWritesPerformed: false,
    networkAccessed: false
  });
  assert.deepEqual(DEFAULT_PUBLIC_APPLICANT_VALIDATOR_PROFILE.entrypoints, ["scripts/public-applicant-validator.mjs"]);
});

test("a synthetic package follows relative imports, static assets and excludes unused files", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-validator-package-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(root, "references"), { recursive: true });
  fs.writeFileSync(path.join(root, "scripts/main.mjs"), [
    'import crypto from "node:crypto";',
    'import { value } from "./value.mjs";',
    'export { other } from "./other.mjs";',
    'export const schemaUrl = new URL("../references/schema.json", import.meta.url);',
    'export const digest = crypto.createHash("sha256").update(value).digest("hex");',
    ""
  ].join("\n"));
  fs.writeFileSync(path.join(root, "scripts/value.mjs"), 'export const value = "value";\n');
  fs.writeFileSync(path.join(root, "scripts/other.mjs"), "export const other = 1;\n");
  fs.writeFileSync(path.join(root, "scripts/unused.mjs"), "throw new Error('unused');\n");
  fs.writeFileSync(path.join(root, "references/schema.json"), "{}\n");

  const result = generateApplicantValidatorPackageClosure({
    skillRoot: root,
    profile: { entrypoints: ["scripts/main.mjs"], assets: [] }
  });
  assert.deepEqual(result.receipt.files.map(({ path: filePath }) => filePath), [
    "references/schema.json",
    "scripts/main.mjs",
    "scripts/other.mjs",
    "scripts/value.mjs"
  ]);
});

test("materialization and verification preserve the exact receipt and reject drift", async (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-validator-output-"));
  const outputRoot = path.join(parent, "package");
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const closure = generateApplicantValidatorPackageClosure({ skillRoot });
  const written = materializeApplicantValidatorPackage({ closure, outputRoot });
  assert.equal(written.receiptPath, path.join(fs.realpathSync.native(outputRoot), "validator-package-receipt.v1.json"));
  assert.equal(verifyApplicantValidatorPackage({ skillRoot, packageRoot: outputRoot }).closureSha256, closure.receipt.closureSha256);
  const isolated = await import(pathToFileURL(path.join(outputRoot, closure.receipt.entrypoint)));
  assert.equal(typeof isolated.validateSourceClosure, "function");
  fs.appendFileSync(path.join(outputRoot, closure.receipt.entrypoint), "\n");
  assert.throws(
    () => verifyApplicantValidatorPackage({ skillRoot, packageRoot: outputRoot }),
    (error) => error.code === "VALIDATOR_PACKAGE_CONTENT_MISMATCH"
  );
});

test("materialization recomputes receipt totals, file digests and closure digest", (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-validator-tamper-"));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const closure = generateApplicantValidatorPackageClosure({ skillRoot });
  closure.files[0].bytes[0] ^= 1;
  assert.throws(
    () => materializeApplicantValidatorPackage({ closure, outputRoot: path.join(parent, "package") }),
    (error) => error.code === "VALIDATOR_PACKAGE_CLOSURE_INVALID"
  );
  assert.equal(fs.existsSync(path.join(parent, "package")), false);
});

test("verification never follows a packaged symlink", (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-validator-symlink-"));
  const outputRoot = path.join(parent, "package");
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const closure = generateApplicantValidatorPackageClosure({ skillRoot });
  materializeApplicantValidatorPackage({ closure, outputRoot });
  const target = path.join(outputRoot, closure.receipt.entrypoint);
  const outside = path.join(parent, "outside.mjs");
  fs.writeFileSync(outside, "export {};\n");
  fs.unlinkSync(target);
  fs.symlinkSync(outside, target);
  assert.throws(
    () => verifyApplicantValidatorPackage({ skillRoot, packageRoot: outputRoot }),
    (error) => error.code === "VALIDATOR_PACKAGE_FILE_INVALID"
  );
});

test("missing, escaping, bare and dynamic dependencies fail closed", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-validator-invalid-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });

  const expectCode = (source, code) => {
    fs.writeFileSync(path.join(root, "scripts/main.mjs"), source);
    assert.throws(
      () => generateApplicantValidatorPackageClosure({
        skillRoot: root,
        profile: { entrypoints: ["scripts/main.mjs"], assets: [] }
      }),
      (error) => error instanceof ValidatorPackageError && error.code === code
    );
  };
  expectCode('import "./missing.mjs";\n', "VALIDATOR_PACKAGE_FILE_MISSING");
  expectCode('import "left-pad";\n', "VALIDATOR_PACKAGE_BARE_IMPORT_FORBIDDEN");
  expectCode('export const load = () => import("./later.mjs");\n', "VALIDATOR_PACKAGE_DYNAMIC_IMPORT_FORBIDDEN");
  expectCode('import "../../outside.mjs";\n', "VALIDATOR_PACKAGE_PATH_ESCAPE");
});
