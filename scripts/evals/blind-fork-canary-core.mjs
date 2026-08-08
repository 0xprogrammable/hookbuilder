import crypto from "node:crypto";

const SECRET_OR_WRITE_FLAG = /(?:^|[-_])(?:api[-_]?key|authorization|bearer|broadcast|credential|jwt|keystore|mnemonic|password|private[-_]?key|resume|secret|sender|token|unlocked)(?:$|[-_=])/iu;

function deepFreeze(value) {
  if (value !== null && typeof value === "object") for (const entry of Object.values(value)) deepFreeze(entry);
  return Object.freeze(value);
}

export const FROZEN_MAINNET_FORK_CANARY = deepFreeze({
  sourcePath: "test/ProgrammableVolumeFeeHookV2MainnetForkCanary.t.sol",
  sourceSha256: "sha256:7ee7e042af764c24de9eb73f1036505e198ce2a4676dcab96f45900ac9c6091c",
  command: {
    id: "mainnet-fork-canary",
    kind: "fork",
    argv: ["forge", "test", "--match-path", "test/ProgrammableVolumeFeeHookV2MainnetForkCanary.t.sol", "--match-test", "testPinnedMainnetRuntimesAndLocalHookRegistration", "--fork-url", "https://eth.drpc.org", "--fork-block-number", "25708544", "--json", "-vv"],
    cwd: ".",
    required: true,
    timeoutMs: 300_000,
    executionPolicy: { networkAccess: "read-only", externalWrites: false },
  },
  output: {
    suiteKey: "test/ProgrammableVolumeFeeHookV2MainnetForkCanary.t.sol:ProgrammableVolumeFeeHookV2MainnetForkCanaryTest",
    testName: "testPinnedMainnetRuntimesAndLocalHookRegistration()",
    prefix: "PROGRAMMABLE_MAINNET_FORK_CANARY_V1:",
    result: {
      blockHash: "0x87dd2497fb2c5fba0f2c513fe1b441ae5660e8360bde1be308875be27c336162",
      blockNumber: 25708543,
      chainId: "1",
      contentSha256: "sha256:3082709a049a0117c3f1ff132529a06f3f6e595eae93c31907936737d9d7ae1f",
      evidenceBoundary: { approvalCreated: false, auditClaimed: false, externalActionsPerformed: [], productionClaimed: false },
      kind: "mainnet-fork-canary-result",
      localFork: { canonicalPoolManagerBound: true, forkBlockNumber: 25708544, hookDeploymentLocalOnly: true, poolRegistrationLocalOnly: true, transactionBroadcast: false },
      provider: { credentialMode: "none", networkAccess: "read-only", url: "https://eth.drpc.org" },
      runtimes: [
        { address: "0x000000000022d473030f116ddee9f6b43ac78ba3", codeByteLength: 9152, codeKeccak256: "0xc67d1657868aa5146eaf24fb879fb1fdec3d2d493b3683a61c9c2f4fb2851131", id: "permit2" },
        { address: "0x000000000004444c5dc75cb358380d2e3de08a90", codeByteLength: 24009, codeKeccak256: "0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293", id: "pool-manager" },
        { address: "0x66a9893cc07d91d95644aedd05d03f95e1dba8af", codeByteLength: 19499, codeKeccak256: "0x6a5f46971b50c6e1b7eef97902311444e479d734e4f80ad88367783cf373fe7f", id: "universal-router" },
        { address: "0x52f0e24d1c21c8a0cb1e5a5dd6198556bd9e1203", codeByteLength: 5820, codeKeccak256: "0x06de58fa119c5deaa7a667fb92d3894e25d9160e62fb82c8d86d43b47eefe441", id: "v4-quoter" },
      ],
      schemaVersion: "1.0.0",
      status: "LOCAL_READ_ONLY_FORK_EVIDENCE_NOT_APPROVAL",
    },
  },
});

function sha256(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function stringLeaves(value, output = []) {
  if (typeof value === "string") output.push(value);
  else if (Array.isArray(value)) for (const entry of value) stringLeaves(entry, output);
  else if (value !== null && typeof value === "object") for (const entry of Object.values(value)) stringLeaves(entry, output);
  return output;
}

function exactObject(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

export function inspectReadOnlyForkDeclaration({ command, expectedCommand, sourceBytes, expectedSourceSha256 }) {
  const issues = [];
  if (!exactObject(command, expectedCommand)) issues.push("fork command differs from the frozen declaration");
  if (command?.kind !== "fork" || command?.executionPolicy?.networkAccess !== "read-only" || command?.executionPolicy?.externalWrites !== false) {
    issues.push("read-only access is restricted to a fork command with no external writes");
  }
  if (command?.required !== true || command?.cwd !== "." || !Number.isSafeInteger(command?.timeoutMs) || command.timeoutMs < 1) {
    issues.push("fork command must be required, repository-rooted, and time bounded");
  }
  const argv = command?.argv;
  if (!Array.isArray(argv) || argv.some((entry) => typeof entry !== "string") || argv[0] !== "forge" || argv[1] !== "test") {
    issues.push("fork command must use direct forge test argv");
  }
  if (Array.isArray(argv) && argv.some((entry) => SECRET_OR_WRITE_FLAG.test(entry))) issues.push("fork argv contains a credential or write-capable flag");
  const valueAfter = (flag) => {
    if (!Array.isArray(argv) || argv.filter((entry) => entry === flag).length !== 1) return null;
    const index = argv.indexOf(flag);
    return index >= 0 && index + 1 < argv.length ? argv[index + 1] : null;
  };
  const provider = valueAfter("--fork-url");
  const block = valueAfter("--fork-block-number");
  let url = null;
  try { url = new URL(provider); } catch {}
  if (!url || url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/" || url.origin !== provider) {
    issues.push("fork provider must be a literal credential-free HTTPS URL without query or fragment");
  }
  if (!/^[1-9][0-9]*$/u.test(block ?? "") || !Number.isSafeInteger(Number(block))) issues.push("fork command must pin one safe decimal block number");
  const sourceSha256 = Buffer.isBuffer(sourceBytes) ? sha256(sourceBytes) : null;
  if (typeof expectedSourceSha256 === "string" && sourceSha256 !== expectedSourceSha256) issues.push("fork canary source differs from the frozen source bytes");
  return Object.freeze({
    valid: issues.length === 0,
    issues,
    providerUrl: url ? provider : null,
    providerUriSha256: url ? sha256(Buffer.from(provider, "utf8")) : null,
    blockNumber: /^[1-9][0-9]*$/u.test(block ?? "") ? Number(block) : null,
    sourceSha256,
    declarationSha256: command === undefined ? null : sha256(Buffer.from(canonicalJson(command), "utf8")),
  });
}

export function parseForgeForkCanaryOutput({ stdout, expected }) {
  const issues = [];
  let forge = null;
  try { forge = JSON.parse(Buffer.isBuffer(stdout) ? stdout.toString("utf8") : stdout); }
  catch { issues.push("forge fork output is not one JSON document"); }
  const suites = forge && !Array.isArray(forge) && typeof forge === "object" ? Object.entries(forge) : [];
  if (suites.length !== 1 || suites[0]?.[0] !== expected.suiteKey) issues.push("forge fork output must contain exactly the frozen suite");
  const testEntries = suites.length === 1 && suites[0][1]?.test_results && typeof suites[0][1].test_results === "object"
    ? Object.entries(suites[0][1].test_results)
    : [];
  if (testEntries.length !== 1 || testEntries[0]?.[0] !== expected.testName) issues.push("forge fork output must contain exactly the frozen canary test");
  const testResult = testEntries.length === 1 ? testEntries[0][1] : null;
  if (testResult?.status !== "Success" || testResult?.reason !== null) issues.push("fork canary test did not succeed without a failure reason");
  if (!Array.isArray(testResult?.decoded_logs) || testResult.decoded_logs.length !== 1) issues.push("fork canary must emit exactly one decoded log");
  const logStrings = [...stringLeaves(testResult?.decoded_logs), ...stringLeaves(testResult?.logs)];
  const matchingLogs = logStrings.filter((value) => value.startsWith(expected.prefix));
  if (matchingLogs.length !== 1 || matchingLogs[0].indexOf(expected.prefix, expected.prefix.length) !== -1) {
    issues.push("fork canary must emit exactly one unambiguous canonical result log");
  }
  let result = null;
  const encoded = matchingLogs.length === 1 ? matchingLogs[0].slice(expected.prefix.length) : "";
  try { result = JSON.parse(encoded); } catch { if (encoded) issues.push("fork canary result log is not JSON"); }
  if (result !== null && encoded !== canonicalJson(result)) issues.push("fork canary result log is not canonical JSON");
  if (result !== null && !exactObject(result, expected.result)) issues.push("fork canary result differs from the frozen result");
  if (result !== null) {
    const content = { ...result };
    delete content.contentSha256;
    if (result.contentSha256 !== sha256(Buffer.from(canonicalJson(content), "utf8"))) issues.push("fork canary content hash is invalid");
  }
  return Object.freeze({
    valid: issues.length === 0,
    issues,
    normalized: result === null ? null : {
      suite: suites[0]?.[0] ?? null,
      test: testEntries[0]?.[0] ?? null,
      status: testResult?.status ?? null,
      providerUriSha256: typeof result?.provider?.url === "string" ? sha256(Buffer.from(result.provider.url, "utf8")) : null,
      forkBlockNumber: result?.localFork?.forkBlockNumber ?? result?.blockNumber ?? null,
      blockNumber: result?.blockNumber ?? null,
      blockHash: result?.blockHash ?? null,
      runtimes: result?.runtimes ?? null,
      contentSha256: result?.contentSha256 ?? null,
      canonicalResultSha256: sha256(Buffer.from(canonicalJson(result), "utf8")),
    },
  });
}

export function validateReadOnlyForkReplay({ command, expectedCommand, sourceBytes, expectedSourceSha256, stdout, expectedOutput }) {
  const declaration = inspectReadOnlyForkDeclaration({ command, expectedCommand, sourceBytes, expectedSourceSha256 });
  const output = parseForgeForkCanaryOutput({ stdout, expected: expectedOutput });
  const issues = [...declaration.issues, ...output.issues];
  if (output.normalized?.providerUriSha256 !== declaration.providerUriSha256) issues.push("fork output provider differs from command provider");
  if (output.normalized?.forkBlockNumber !== declaration.blockNumber) issues.push("fork output execution block differs from command fork block");
  return Object.freeze({ valid: issues.length === 0, issues, declaration, output });
}
