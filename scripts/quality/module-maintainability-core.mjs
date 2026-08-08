import path from "node:path";

const BRANCH_KEYWORDS = new Set(["catch", "for", "if", "while"]);

export function lexicalComplexity(source) {
  if (typeof source !== "string") throw new Error("JavaScript source must be a string");
  const tokens = codeTokens(source);
  const breakdown = {
    branchKeywords: 0,
    switchCases: 0,
    logicalBranches: 0,
    nullishBranches: 0,
    conditionalBranches: 0
  };
  let blockDepth = 0;
  let maxBlockDepth = 0;
  for (const token of tokens) {
    if (token.type === "identifier" && BRANCH_KEYWORDS.has(token.value)) breakdown.branchKeywords += 1;
    if (token.type === "identifier" && token.value === "case") breakdown.switchCases += 1;
    if (token.value === "&&" || token.value === "||") breakdown.logicalBranches += 1;
    if (token.value === "??") breakdown.nullishBranches += 1;
    if (token.value === "?") breakdown.conditionalBranches += 1;
    if (token.value === "{") {
      blockDepth += 1;
      maxBlockDepth = Math.max(maxBlockDepth, blockDepth);
    } else if (token.value === "}") {
      blockDepth = Math.max(0, blockDepth - 1);
    }
  }
  const branchPoints = Object.values(breakdown).reduce((total, value) => total + value, 0);
  return {
    profile: "dependency-free-lexical-branch-proxy-v1",
    score: branchPoints + 1,
    branchPoints,
    maxBlockDepth,
    breakdown
  };
}

export function buildStaticModuleGraph({ modulePaths, sourceByPath }) {
  const modules = [...modulePaths].sort((left, right) => left.localeCompare(right));
  const known = new Set(modules);
  const edges = new Map();
  const unresolvedRelativeImports = [];
  for (const modulePath of modules) {
    const source = sourceByPath.get(modulePath);
    if (typeof source !== "string") throw new Error(`missing source for ${modulePath}`);
    const targets = new Set();
    for (const specifier of staticModuleSpecifiers(source)) {
      if (!specifier.startsWith(".")) continue;
      const target = resolveRelativeModule(modulePath, specifier);
      if (known.has(target)) targets.add(target);
      else unresolvedRelativeImports.push({ importer: modulePath, specifier, resolvedPath: target });
    }
    edges.set(modulePath, [...targets].sort((left, right) => left.localeCompare(right)));
  }
  return {
    profile: "static-relative-esm-graph-v1",
    modules,
    edges,
    unresolvedRelativeImports: unresolvedRelativeImports.sort((left, right) => (
      left.importer.localeCompare(right.importer)
      || left.specifier.localeCompare(right.specifier)
      || left.resolvedPath.localeCompare(right.resolvedPath)
    )),
    cycles: findImportCycles(modules, edges)
  };
}

export function staticModuleSpecifiers(source) {
  if (typeof source !== "string") throw new Error("JavaScript source must be a string");
  const withoutComments = stripComments(source);
  const specifiers = [];
  const declaration = /^\s*(?:import\s+(?:(?:[\s\S]*?)\s+from\s+)?|export\s+(?:(?:\*(?:\s+as\s+[A-Za-z_$][A-Za-z0-9_$]*)?|\{[\s\S]*?\})\s+from\s+))(["'])([^"'\r\n]+)\1/gmu;
  for (const match of withoutComments.matchAll(declaration)) specifiers.push(match[2]);
  return [...new Set(specifiers)].sort((left, right) => left.localeCompare(right));
}

function resolveRelativeModule(importer, specifier) {
  let target = path.posix.normalize(path.posix.join(path.posix.dirname(importer), specifier));
  if (path.posix.extname(target) === "") target = `${target}.mjs`;
  return target;
}

function findImportCycles(modules, edges) {
  let nextIndex = 0;
  const stack = [];
  const onStack = new Set();
  const indexByModule = new Map();
  const lowLink = new Map();
  const components = [];
  const visit = (modulePath) => {
    indexByModule.set(modulePath, nextIndex);
    lowLink.set(modulePath, nextIndex);
    nextIndex += 1;
    stack.push(modulePath);
    onStack.add(modulePath);
    for (const target of edges.get(modulePath) ?? []) {
      if (!indexByModule.has(target)) {
        visit(target);
        lowLink.set(modulePath, Math.min(lowLink.get(modulePath), lowLink.get(target)));
      } else if (onStack.has(target)) {
        lowLink.set(modulePath, Math.min(lowLink.get(modulePath), indexByModule.get(target)));
      }
    }
    if (lowLink.get(modulePath) !== indexByModule.get(modulePath)) return;
    const component = [];
    let target;
    do {
      target = stack.pop();
      onStack.delete(target);
      component.push(target);
    } while (target !== modulePath);
    const selfCycle = component.length === 1 && (edges.get(component[0]) ?? []).includes(component[0]);
    if (component.length > 1 || selfCycle) components.push(component.sort((left, right) => left.localeCompare(right)));
  };
  for (const modulePath of modules) if (!indexByModule.has(modulePath)) visit(modulePath);
  return components.sort((left, right) => left[0].localeCompare(right[0]));
}

function codeTokens(source) {
  const tokens = [];
  let index = 0;
  while (index < source.length) {
    const character = source[index];
    const next = source[index + 1];
    if (/\s/u.test(character)) {
      index += 1;
      continue;
    }
    if (character === "/" && next === "/") {
      index = skipLineComment(source, index + 2);
      continue;
    }
    if (character === "/" && next === "*") {
      index = skipBlockComment(source, index + 2);
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      index = skipQuoted(source, index, character);
      continue;
    }
    if (/[A-Za-z_$]/u.test(character)) {
      let end = index + 1;
      while (end < source.length && /[A-Za-z0-9_$]/u.test(source[end])) end += 1;
      tokens.push({ type: "identifier", value: source.slice(index, end) });
      index = end;
      continue;
    }
    const pair = `${character}${next ?? ""}`;
    if (["&&", "||", "??", "?."].includes(pair)) {
      tokens.push({ type: "punctuator", value: pair });
      index += 2;
      continue;
    }
    tokens.push({ type: "punctuator", value: character });
    index += 1;
  }
  return tokens;
}

function stripComments(source) {
  const output = [...source];
  let index = 0;
  while (index < source.length) {
    const character = source[index];
    const next = source[index + 1];
    if (character === '"' || character === "'" || character === "`") {
      index = skipQuoted(source, index, character);
      continue;
    }
    if (character === "/" && next === "/") {
      const end = skipLineComment(source, index + 2);
      for (let offset = index; offset < end; offset += 1) if (source[offset] !== "\n" && source[offset] !== "\r") output[offset] = " ";
      index = end;
      continue;
    }
    if (character === "/" && next === "*") {
      const end = skipBlockComment(source, index + 2);
      for (let offset = index; offset < end; offset += 1) if (source[offset] !== "\n" && source[offset] !== "\r") output[offset] = " ";
      index = end;
      continue;
    }
    index += 1;
  }
  return output.join("");
}

function skipLineComment(source, index) {
  while (index < source.length && source[index] !== "\n" && source[index] !== "\r") index += 1;
  return index;
}

function skipBlockComment(source, index) {
  while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) index += 1;
  return Math.min(source.length, index + 2);
}

function skipQuoted(source, index, quote) {
  index += 1;
  while (index < source.length) {
    if (source[index] === "\\") {
      index += 2;
      continue;
    }
    if (source[index] === quote) return index + 1;
    index += 1;
  }
  return source.length;
}
