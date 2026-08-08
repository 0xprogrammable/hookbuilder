import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { runBoundedChildProcess } from "./bounded-child-process-core.mjs";

export async function validateScriptsAndTests({
  errors,
  installedMode,
  relative,
  skillRoot,
  untrustedDataMode,
  walk
}) {
  for (const script of walk(path.join(skillRoot, "scripts")).filter((entry) => entry.stat.isFile() && entry.path.endsWith(".mjs")).map((entry) => entry.path)) {
    const result = childProcess.spawnSync(process.execPath, ["--check", script], { encoding: "utf8", shell: false });
    if (result.status !== 0) errors.push(`${relative(script)}: ${result.stderr.trim()}`);
  }

  const testDirectory = path.join(skillRoot, "scripts", "test");
  if (!untrustedDataMode) {
    const testFiles = fs.readdirSync(testDirectory)
      .filter((name) => name.endsWith(".test.mjs") && (!installedMode || name === "cli.test.mjs"))
      .sort()
      .map((name) => path.join(testDirectory, name));
    const tests = await runBoundedChildProcess({
      command: process.execPath,
      args: ["--test", "--test-concurrency=4", ...testFiles],
      cwd: skillRoot,
      env: process.env,
      // The open-world GitHub transport fixtures intentionally replay complete
      // source closures and take several minutes on their own. Fifteen minutes
      // preserves that coverage while making the aggregate finite.
      timeoutMs: 15 * 60 * 1000
    });
    if (tests.timedOut) {
      errors.push(`deterministic tests exceeded the 15-minute aggregate bound:\n${tests.stdout}${tests.stderr}`.trim());
    } else if (tests.outputExceeded) {
      errors.push("deterministic tests exceeded the 128 MiB aggregate output bound");
    } else if (tests.status !== 0) {
      errors.push(`deterministic tests failed:\n${tests.stdout}${tests.stderr}`.trim());
    }
  }
}
