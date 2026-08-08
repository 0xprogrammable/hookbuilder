#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  buildPackageDeprecationReport,
  inventoryLockedPackages,
  normalizeRegistryVersionMetadata,
  packageDeprecationMarkdown
} from "./package-deprecation-core.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../..");
const maximumLockfileBytes = 16 * 1024 * 1024;
const maximumRegistryBytes = 2 * 1024 * 1024;
const registryTimeoutMs = 15_000;
const packages = Object.freeze([
  Object.freeze({ id: "repository", directory: "." }),
  Object.freeze({ id: "reference-kernel-v1", directory: "skills/programmable-v4-hook-builder/assets/reference-kernels/programmable-volume-fee-v1" }),
  Object.freeze({ id: "reference-kernel-v2", directory: "skills/programmable-v4-hook-builder/assets/reference-kernels/programmable-volume-fee-v2" })
]);

try {
  const options = parseArguments(process.argv.slice(2));
  const inventories = packages.map(({ id, directory }) => inventoryLockedPackages(
    id,
    readJson(path.join(repositoryRoot, directory, "package-lock.json"), maximumLockfileBytes, `${id} lockfile`)
  ));
  const directRegistryPackages = new Map();
  for (const inventory of inventories) {
    for (const record of inventory.packages) {
      if (record.direct && record.registryBacked) directRegistryPackages.set(`${record.name}@${record.version}`, record);
    }
  }
  const registryRecords = [];
  for (const record of [...directRegistryPackages.values()].sort((left, right) => left.name.localeCompare(right.name))) {
    registryRecords.push(normalizeRegistryVersionMetadata(record, await readRegistryVersion(record)));
  }
  const report = buildPackageDeprecationReport({
    inventories,
    registryRecords,
    observedAt: new Date().toISOString()
  });
  if (options.githubSummary !== null) appendOutsideRepository(options.githubSummary, packageDeprecationMarkdown(report));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.status === "DIRECT_DEPRECATIONS_REPORTED") process.exitCode = 1;
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
}

async function readRegistryVersion({ name, version }) {
  const url = `https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(version)}`;
  const response = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "programmable-v4-builder-deprecation-report/1" },
    redirect: "error",
    signal: AbortSignal.timeout(registryTimeoutMs)
  });
  if (!response.ok) throw new Error(`${name}@${version}: npm registry returned HTTP ${response.status}`);
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maximumRegistryBytes) {
    throw new Error(`${name}@${version}: npm registry response exceeds ${maximumRegistryBytes} bytes`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maximumRegistryBytes) throw new Error(`${name}@${version}: npm registry response exceeds ${maximumRegistryBytes} bytes`);
  return JSON.parse(bytes.toString("utf8"));
}

function readJson(filePath, maximumBytes, label) {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > maximumBytes) {
    throw new Error(`${label} must be one bounded regular JSON file`);
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function parseArguments(args) {
  let githubSummary = null;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== "--github-summary" || githubSummary !== null) {
      throw new Error("usage: package-deprecation.mjs [--github-summary <absolute-file>]");
    }
    githubSummary = args[++index];
    if (typeof githubSummary !== "string" || !path.isAbsolute(githubSummary)) {
      throw new Error("--github-summary requires an absolute path outside the repository");
    }
  }
  return Object.freeze({ githubSummary });
}

function appendOutsideRepository(filePath, content) {
  const parent = path.dirname(filePath);
  const stat = fs.lstatSync(parent);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("GitHub summary parent must be a real directory");
  const resolved = path.join(fs.realpathSync(parent), path.basename(filePath));
  const relative = path.relative(fs.realpathSync(repositoryRoot), resolved);
  if (!(relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))) {
    throw new Error("GitHub summary must resolve outside the repository");
  }
  if (fs.existsSync(resolved)) {
    const target = fs.lstatSync(resolved);
    if (!target.isFile() || target.isSymbolicLink()) throw new Error("GitHub summary must be a regular file");
  }
  fs.appendFileSync(resolved, content, { encoding: "utf8", mode: 0o600 });
}
