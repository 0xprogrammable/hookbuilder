#!/usr/bin/env node

import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const packageDocument = readJson(path.join(repositoryRoot, "package.json"));
const expectedTag = `v${packageDocument.version}`;
const options = parseArgs(process.argv.slice(2));

if (options.tag !== expectedTag) fail(`expected --tag ${expectedTag}`);
if (!path.isAbsolute(options.outputDirectory)) fail("--output-dir must be an absolute path outside the repository");
const relativeOutput = path.relative(repositoryRoot, options.outputDirectory);
if (!relativeOutput.startsWith("..") && !path.isAbsolute(relativeOutput)) {
  fail("--output-dir must be outside the repository");
}
if (git(["status", "--porcelain=v1", "--untracked-files=all"]).trim() !== "") {
  fail("release artifacts require a clean Git worktree");
}

const commit = git(["rev-parse", "HEAD"]).trim();
const tree = git(["rev-parse", "HEAD^{tree}"]).trim();
const created = new Date(git(["show", "-s", "--format=%cI", "HEAD"]).trim()).toISOString();
const skillRoot = "skills/programmable-v4-hook-builder";
const trackedFiles = git(["ls-files", "-s", "-z", `${skillRoot}/`], { encoding: "buffer" })
  .toString("utf8")
  .split("\0")
  .filter(Boolean)
  .map((entry) => {
    const match = entry.match(/^(\d+) [0-9a-f]{40} \d+\t(.+)$/u);
    if (!match) fail(`cannot parse tracked file record: ${entry}`);
    const repositoryPath = match[2];
    const contents = fs.readFileSync(path.join(repositoryRoot, repositoryPath));
    return {
      path: repositoryPath.slice(`${skillRoot}/`.length),
      mode: match[1],
      bytes: contents.length,
      sha256: sha256(contents)
    };
  })
  .sort((left, right) => left.path.localeCompare(right.path));

if (trackedFiles.length === 0) fail("portable skill contains no tracked files");

fs.mkdirSync(options.outputDirectory, { recursive: true });
if (fs.readdirSync(options.outputDirectory).length !== 0) fail("--output-dir must be empty");

const baseName = `programmable-v4-hook-builder-${expectedTag}`;
const archiveName = `${baseName}.tar.gz`;
const manifestName = `${baseName}.manifest.json`;
const sbomName = `${baseName}.spdx.json`;
const receiptName = `${baseName}.release.json`;

const tar = git([
  "archive",
  "--format=tar",
  `--prefix=${baseName}/`,
  `HEAD:${skillRoot}`
], { encoding: "buffer" });
const archive = zlib.gzipSync(tar, { level: 9, mtime: 0 });
writeBinary(archiveName, archive);

const manifest = {
  schemaVersion: "1.0.0",
  product: "Programmable v4 Builder",
  skill: "programmable-v4-hook-builder",
  version: packageDocument.version,
  tag: expectedTag,
  commit,
  tree,
  createdFromCommitTime: created,
  fileCount: trackedFiles.length,
  files: trackedFiles
};
writeJson(manifestName, manifest);

const kernelLockPath = path.join(
  repositoryRoot,
  skillRoot,
  "assets/reference-kernels/programmable-volume-fee-v1/package-lock.json"
);
const sbom = buildSpdx(readJson(kernelLockPath), { commit, created, version: packageDocument.version });
writeJson(sbomName, sbom);

const receipt = {
  schemaVersion: "1.0.0",
  product: "Programmable v4 Builder",
  version: packageDocument.version,
  tag: expectedTag,
  commit,
  tree,
  createdFromCommitTime: created,
  sourcePath: skillRoot,
  archive: archiveName,
  manifest: manifestName,
  sbom: sbomName,
  modelEvalState: "not-run-provider-credential-and-cost-required",
  securityState: "reference-kernel-locally-tested-and-static-analyzed-not-independently-audited-or-deployed"
};
writeJson(receiptName, receipt);

const checksummedNames = [archiveName, manifestName, sbomName, receiptName];
const checksumLines = checksummedNames
  .map((name) => `${sha256(fs.readFileSync(path.join(options.outputDirectory, name)))}  ${name}`)
  .join("\n");
fs.writeFileSync(path.join(options.outputDirectory, "SHA256SUMS"), `${checksumLines}\n`, { mode: 0o644 });

process.stdout.write(`${JSON.stringify({
  status: "RELEASE_ARTIFACTS_GENERATED",
  version: packageDocument.version,
  tag: expectedTag,
  commit,
  tree,
  outputDirectory: options.outputDirectory,
  artifacts: [...checksummedNames, "SHA256SUMS"]
}, null, 2)}\n`);

function buildSpdx(lock, release) {
  const dependencyPackages = Object.entries(lock.packages)
    .filter(([packagePath]) => packagePath.startsWith("node_modules/"))
    .map(([packagePath, metadata], index) => {
      const name = packagePath.slice("node_modules/".length);
      const checksum = integrityChecksum(metadata.integrity);
      return {
        SPDXID: `SPDXRef-Dependency-${index + 1}`,
        name,
        versionInfo: metadata.version,
        downloadLocation: metadata.resolved ?? "NOASSERTION",
        filesAnalyzed: false,
        licenseConcluded: "NOASSERTION",
        licenseDeclared: metadata.license ?? "NOASSERTION",
        copyrightText: "NOASSERTION",
        checksums: checksum ? [checksum] : [],
        externalRefs: [{
          referenceCategory: "PACKAGE-MANAGER",
          referenceType: "purl",
          referenceLocator: `pkg:npm/${encodePurlName(name)}@${metadata.version}`
        }]
      };
    });
  const skillPackage = {
    SPDXID: "SPDXRef-Package-Builder",
    name: "programmable-v4-hook-builder",
    versionInfo: release.version,
    downloadLocation: `https://github.com/0xprogrammable/programmable-v4-builder/tree/${release.commit}/skills/programmable-v4-hook-builder`,
    filesAnalyzed: false,
    licenseConcluded: "MIT",
    licenseDeclared: "MIT",
    copyrightText: "Copyright (c) 2026 Programmable",
    externalRefs: [{
      referenceCategory: "PACKAGE-MANAGER",
      referenceType: "purl",
      referenceLocator: `pkg:github/0xprogrammable/programmable-v4-builder@${release.commit}`
    }]
  };
  return {
    spdxVersion: "SPDX-2.3",
    dataLicense: "CC0-1.0",
    SPDXID: "SPDXRef-DOCUMENT",
    name: `programmable-v4-hook-builder-${release.version}`,
    documentNamespace: `https://github.com/0xprogrammable/programmable-v4-builder/releases/download/v${release.version}/spdx-${release.commit}`,
    creationInfo: {
      created: release.created,
      creators: ["Organization: Programmable", "Tool: programmable-v4-builder-release-artifacts-1.0.0"]
    },
    packages: [skillPackage, ...dependencyPackages],
    relationships: [
      { spdxElementId: "SPDXRef-DOCUMENT", relationshipType: "DESCRIBES", relatedSpdxElement: skillPackage.SPDXID },
      ...dependencyPackages.map((dependency) => ({
        spdxElementId: skillPackage.SPDXID,
        relationshipType: "DEPENDS_ON",
        relatedSpdxElement: dependency.SPDXID
      }))
    ]
  };
}

function integrityChecksum(integrity) {
  if (typeof integrity !== "string") return null;
  const match = integrity.match(/^sha512-(.+)$/u);
  if (!match) return null;
  return { algorithm: "SHA512", checksumValue: Buffer.from(match[1], "base64").toString("hex").toUpperCase() };
}

function encodePurlName(name) {
  return name.startsWith("@") ? name.replace("/", "%2F") : name;
}

function parseArgs(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--tag") values.tag = args[++index];
    else if (argument === "--output-dir") values.outputDirectory = path.resolve(args[++index] ?? "");
    else fail(`unknown argument: ${argument}`);
  }
  if (!values.tag || !values.outputDirectory) fail("usage: generate-release-artifacts.mjs --tag <tag> --output-dir <absolute-empty-directory>");
  return values;
}

function git(args, options = {}) {
  const result = childProcess.spawnSync("git", args, {
    cwd: repositoryRoot,
    encoding: options.encoding ?? "utf8",
    shell: false,
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.status !== 0) fail(Buffer.isBuffer(result.stderr) ? result.stderr.toString("utf8") : result.stderr);
  return result.stdout;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(name, value) {
  fs.writeFileSync(path.join(options.outputDirectory, name), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o644 });
}

function writeBinary(name, value) {
  fs.writeFileSync(path.join(options.outputDirectory, name), value, { mode: 0o644 });
}

function sha256(contents) {
  return crypto.createHash("sha256").update(contents).digest("hex");
}

function fail(message) {
  process.stderr.write(`${String(message).trim()}\n`);
  process.exit(1);
}
