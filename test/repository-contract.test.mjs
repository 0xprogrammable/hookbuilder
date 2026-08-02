import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, "..");
const expectedTopLevel = [
  ".claude-plugin", ".codex-plugin", ".editorconfig", ".gitattributes", ".github", ".gitignore",
  "AGENTS.md", "CHANGELOG.md", "CODE_OF_CONDUCT.md", "CONTRIBUTING.md", "GOVERNANCE.md", "LICENSE",
  "NOTICE.md", "README.md", "SECURITY.md", "SUPPORT.md", "assets", "config", "docs", "evals",
  "package-lock.json", "package.json", "scripts", "skills", "test"
];

function walk(directory) {
  const rows = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    if (directory === repositoryRoot && entry.name === ".git") continue;
    const absolutePath = path.join(directory, entry.name);
    const relativePath = path.relative(repositoryRoot, absolutePath).split(path.sep).join("/");
    const stat = fs.lstatSync(absolutePath);
    rows.push({ absolutePath, relativePath, stat });
    if (stat.isDirectory() && !stat.isSymbolicLink()) rows.push(...walk(absolutePath));
  }
  return rows;
}

test("repository has one closed top-level product structure", () => {
  const actual = fs.readdirSync(repositoryRoot).filter((name) => name !== ".git").sort();
  assert.deepEqual(actual, [...expectedTopLevel].sort());
  const skillFiles = walk(repositoryRoot).filter(({ relativePath }) => relativePath.endsWith("/SKILL.md"));
  assert.deepEqual(skillFiles.map(({ relativePath }) => relativePath), ["skills/programmable-v4-hook-builder/SKILL.md"]);
});

test("repository contains no symlink, transient directory, oversized file, secret, or bot configuration", () => {
  const rows = walk(repositoryRoot);
  const forbiddenDirectories = new Set(["node_modules", "coverage", "broadcast", "cache", "out"]);
  const secretPatterns = [
    /-----BEGIN (?:EC |RSA |OPENSSH )?PRIVATE KEY-----/u,
    /\bgh[opusr]_[A-Za-z0-9]{24,}\b/u,
    /\bsk-(?:ant|proj)-[A-Za-z0-9_-]{16,}\b/u
  ];
  for (const row of rows) {
    assert.equal(row.stat.isSymbolicLink(), false, row.relativePath);
    if (row.stat.isDirectory()) assert.equal(forbiddenDirectories.has(path.basename(row.relativePath)), false, row.relativePath);
    if (!row.stat.isFile()) continue;
    assert.ok(row.stat.size <= 1_000_000, `oversized file ${row.relativePath}`);
    const contents = fs.readFileSync(row.absolutePath);
    if (contents.includes(0)) continue;
    const text = contents.toString("utf8");
    for (const pattern of secretPatterns) assert.equal(pattern.test(text), false, `credential-like value in ${row.relativePath}`);
  }
  assert.equal(fs.existsSync(path.join(repositoryRoot, ".github", "dependabot.yml")), false);
});

test("version and plugin identities agree without duplicating the portable skill", () => {
  const packageDocument = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8"));
  const metadata = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "config", "plugin.json"), "utf8"));
  const codex = JSON.parse(fs.readFileSync(path.join(repositoryRoot, ".codex-plugin", "plugin.json"), "utf8"));
  const claude = JSON.parse(fs.readFileSync(path.join(repositoryRoot, ".claude-plugin", "plugin.json"), "utf8"));
  const candidate = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "skills", "programmable-v4-hook-builder", "assets", "templates", "release-candidate.example.json"), "utf8"));
  assert.equal(packageDocument.private, true);
  assert.equal(Object.hasOwn(packageDocument, "dependencies"), false);
  assert.equal(Object.hasOwn(packageDocument, "devDependencies"), false);
  assert.equal(packageDocument.version, "0.4.0");
  assert.equal(metadata.version, packageDocument.version);
  assert.equal(codex.version, packageDocument.version);
  assert.equal(claude.version, packageDocument.version);
  assert.equal(candidate.releaseVersion, packageDocument.version);
  assert.equal(codex.skills, "./skills/");
  assert.equal(claude.skills, "./skills/");
});

test("every GitHub Action is pinned to an immutable commit", () => {
  const workflows = walk(path.join(repositoryRoot, ".github", "workflows")).filter(({ stat }) => stat.isFile());
  assert.ok(workflows.length >= 1);
  for (const workflow of workflows) {
    const contents = fs.readFileSync(workflow.absolutePath, "utf8");
    for (const match of contents.matchAll(/^\s*uses:\s*([^\s#]+).*$/gmu)) {
      if (match[1].startsWith("./")) continue;
      assert.match(match[1], /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)?@[0-9a-f]{40}$/u, `${workflow.relativePath}: ${match[1]}`);
    }
  }
});

test("relative Markdown links resolve inside the repository", () => {
  const markdownFiles = walk(repositoryRoot).filter(({ stat, relativePath }) => stat.isFile() && relativePath.endsWith(".md"));
  for (const file of markdownFiles) {
    const source = fs.readFileSync(file.absolutePath, "utf8");
    for (const match of source.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/gu)) {
      let target = match[1].trim();
      if (target.startsWith("<") && target.endsWith(">")) target = target.slice(1, -1);
      if (/^(?:https?:|mailto:|#)/u.test(target)) continue;
      target = target.split("#", 1)[0].split("?", 1)[0];
      if (target.length === 0) continue;
      const resolved = path.resolve(path.dirname(file.absolutePath), decodeURIComponent(target));
      const relative = path.relative(repositoryRoot, resolved);
      assert.equal(relative.startsWith("..") || path.isAbsolute(relative), false, `${file.relativePath}: ${target}`);
      assert.equal(fs.existsSync(resolved), true, `${file.relativePath}: ${target}`);
    }
  }
});

test("official adoption record binds the reviewed source heads", () => {
  const record = fs.readFileSync(path.join(repositoryRoot, "docs", "UNISWAP_MASTER_SKILL_ADOPTION.md"), "utf8");
  for (const commit of [
    "a0da460b1becfe920330adfab5d11f2f3f63863a",
    "46c6834698c48bc4a463a86d8420f4eb1d7f3b75",
    "3245c3cb99c48fa1dc2459c3b60abc37d4294aba",
    "7da5210f2c81a700820a6b4f585264233d91f349",
    "1e30c3265f3cfb818ed912833f3e65630c8b3490",
    "9660491dc662fea76c2f8565c2f7ba2abf6e8840"
  ]) assert.ok(record.includes(commit), commit);
});
