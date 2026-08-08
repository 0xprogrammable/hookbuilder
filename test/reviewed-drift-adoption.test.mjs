import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { renderReviewedDriftMarkdown } from "../skills/programmable-v4-hook-builder/scripts/reviewed-drift-receipt-core.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("maintainer adoption record is rendered from the versioned reviewed-drift receipt", () => {
  const receipt = JSON.parse(fs.readFileSync(
    path.join(repositoryRoot, "skills/programmable-v4-hook-builder/references/upstream-reviewed-drift-v1.json"),
    "utf8"
  ));
  const adoption = fs.readFileSync(path.join(repositoryRoot, "docs/UNISWAP_MASTER_SKILL_ADOPTION.md"), "utf8");
  const match = adoption.match(/<!-- reviewed-drift-v1:start -->[\s\S]*?<!-- reviewed-drift-v1:end -->\n/u);
  assert.ok(match, "reviewed drift block must exist exactly once");
  assert.equal((adoption.match(/<!-- reviewed-drift-v1:start -->/gu) ?? []).length, 1);
  assert.equal(match[0], renderReviewedDriftMarkdown(receipt));
});
