import { parseBoundedStrictJson } from "./strict-json-core.mjs";

export function extractJsonPublicText(source) {
  let value;
  try {
    value = parseBoundedStrictJson(source);
  } catch {
    return "";
  }
  const strings = [];
  const pending = [value];
  while (pending.length > 0) {
    const entry = pending.pop();
    if (typeof entry === "string") {
      strings.push(entry);
      continue;
    }
    if (Array.isArray(entry)) {
      for (let index = entry.length - 1; index >= 0; index -= 1) pending.push(entry[index]);
    } else if (entry && typeof entry === "object") {
      const items = Object.values(entry);
      for (let index = items.length - 1; index >= 0; index -= 1) pending.push(items[index]);
    }
  }
  return strings.join("\n");
}

export function extractYamlPublicText(source) {
  const lines = source.split(/\r?\n/u);
  const values = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#") || /^(?:---|\.\.\.)$/u.test(trimmed)) continue;

    const separator = yamlMappingSeparator(line);
    let scalar = separator === -1 ? trimmed.replace(/^-\s+/u, "") : line.slice(separator + 1).trim();
    if (/^[>|][+-]?[0-9]?$/u.test(scalar)) {
      const indentation = leadingWhitespace(line);
      const block = [];
      while (index + 1 < lines.length) {
        const next = lines[index + 1];
        if (next.trim().length > 0 && leadingWhitespace(next) <= indentation) break;
        index += 1;
        if (next.trim().length > 0) block.push(next.trim());
      }
      if (block.length > 0) values.push(block.join(" "));
      continue;
    }
    scalar = stripYamlComment(scalar).trim();
    if (scalar.length === 0 || scalar === "{}" || scalar === "[]") continue;
    values.push(decodeYamlScalar(scalar));
  }
  return values.join("\n");
}

export function extractMarkdownPublicText(source) {
  const frontmatterMatch = source.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/u);
  const frontmatter = frontmatterMatch ? extractYamlPublicText(frontmatterMatch[1]) : "";
  const body = (frontmatterMatch ? source.slice(frontmatterMatch[0].length) : source)
    .replace(/<!--[^]*?-->/gu, " ")
    .replace(/\{\/\*[^]*?\*\/\}/gu, " ")
    .replace(/^(?: {0,3})(`{3,}|~{3,})[^\n]*\n[^]*?^ {0,3}\1\s*$/gmu, " ")
    .replace(/^ {4}.*$/gmu, " ")
    .replace(/^(?:import|export)\s+[^\n]*$/gmu, " ")
    .replace(/`[^`\n]*`/gu, " ");
  return [frontmatter, body].filter(Boolean).join("\n");
}

export function yamlMappingSeparator(line) {
  let quote = null;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quote) {
      if (character === quote) {
        if (quote === "'" && line[index + 1] === "'") index += 1;
        else quote = null;
      } else if (quote === '"' && character === "\\") index += 1;
      continue;
    }
    if (character === "'" || character === '"') quote = character;
    else if (character === ":") return index;
  }
  return -1;
}

export function stripYamlComment(value) {
  let quote = null;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === quote) {
        if (quote === "'" && value[index + 1] === "'") index += 1;
        else quote = null;
      } else if (quote === '"' && character === "\\") index += 1;
      continue;
    }
    if (character === "'" || character === '"') quote = character;
    else if (character === "#" && (index === 0 || /\s/u.test(value[index - 1]))) return value.slice(0, index);
  }
  return value;
}

export function decodeYamlScalar(value) {
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/gu, "'");
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }
  return value;
}

export function leadingWhitespace(value) {
  return value.match(/^\s*/u)?.[0].length ?? 0;
}

export function extractHtmlPublicText(source) {
  const withoutCommentsOrCode = source
    .replace(/<!--[\s\S]*?-->/gu, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/giu, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/giu, " ");
  const attributes = [...withoutCommentsOrCode.matchAll(/\b(?:alt|aria-label|content|placeholder|title)\s*=\s*(["'])(.*?)\1/giu)]
    .map((match) => decodeCommonEntities(match[2]));
  const visible = decodeCommonEntities(withoutCommentsOrCode.replace(/<[^>]*>/gu, " "));
  return [...attributes, visible].filter(Boolean).join("\n");
}
export function decodeCommonEntities(value) {
  return value
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&quot;/giu, '"')
    .replace(/&#39;/giu, "'");
}
