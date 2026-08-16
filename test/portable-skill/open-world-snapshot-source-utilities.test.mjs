import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { installOpenWorldSnapshotSourceUtilities } from "../../skills/programmable-v4-hook-builder/scripts/open-world-snapshot-source-utilities.mjs";

test("descriptor-bound Application V3 snapshot rejects a path substitution between lstat and open", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-application-snapshot-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, "application.v3.json");
  const replacement = path.join(root, "replacement.json");
  fs.writeFileSync(target, "{\"before\":true}\n");
  fs.writeFileSync(replacement, "{\"after\":true}\n");

  const runtime = {
    fileIdentity: (stat) => `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}`,
    throwApplicationInputSplitReviewHold: (message) => { throw new Error(message); }
  };
  installOpenWorldSnapshotSourceUtilities(runtime);

  const originalOpenSync = fs.openSync;
  let substituted = false;
  fs.openSync = function openWithSubstitution(filePath, flags, mode) {
    if (!substituted && filePath === target) {
      substituted = true;
      fs.renameSync(replacement, target);
    }
    return originalOpenSync.call(this, filePath, flags, mode);
  };
  try {
    assert.throws(
      () => runtime.readFileSnapshot(target, "application.v3.json", 1024, { requireUtf8: true }),
      (error) => error?.code === "SOURCE_CHANGED_DURING_OPERATION"
    );
  } finally {
    fs.openSync = originalOpenSync;
  }
  assert.equal(substituted, true);
});

test("descriptor-bound Application V3 snapshot rejects a symlink leaf", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-application-symlink-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, "application.v3.json");
  const source = path.join(root, "source.json");
  fs.writeFileSync(source, "{}\n");
  fs.symlinkSync(source, target);

  const runtime = {
    fileIdentity: (stat) => `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}`,
    throwApplicationInputSplitReviewHold: (message) => { throw new Error(message); }
  };
  installOpenWorldSnapshotSourceUtilities(runtime);
  assert.throws(
    () => runtime.readFileSnapshot(target, "application.v3.json", 1024, { requireUtf8: true }),
    (error) => error?.code === "APPLICATION_INPUT_INVALID"
  );
});
