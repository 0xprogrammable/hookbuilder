import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const FEE_CONFORMANCE_SCHEMA_VERSION = "programmable-fee-conformance-v1";
export const FEE_POLICY_ID = "programmable-volume-fee-v1";
export const FEE_POLICY_VERSION = "1.1.0";
export const PROGRAMMABLE_FEE_OWNER = "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c";
export const RATE_DENOMINATOR = 1_000_000n;
export const PROGRAMMABLE_HUNDREDTHS_OF_BIP = 1_000n;
export const MAX_SELECTED_HUNDREDTHS_OF_BIP = 100_000n;
export const MIN_GROSS_QUOTE_AMOUNT = 1_000n;

export const REQUIRED_EVIDENCE_SCENARIOS = Object.freeze([
  "rate-selected-zero",
  "rate-selected-below-floor",
  "rate-selected-at-floor",
  "rate-selected-three-percent",
  "programmable-rounding-exact-10-bps",
  "cumulative-rounding-fragmentation-resistant",
  "claim-preserves-rounding-remainders",
  "zero-for-one-exact-input",
  "zero-for-one-exact-output",
  "one-for-zero-exact-input",
  "one-for-zero-exact-output",
  "specified-quote-partial-fill-atomic-revert",
  "unspecified-quote-uses-executed-delta",
  "dust-below-fee-quantum-atomic-revert",
  "canonical-pool-only",
  "atomic-registration-and-initialization",
  "pool-manager-callback-authentication",
  "hook-address-permission-bits",
  "lp-fee-exact-output-compatible",
  "delta-and-liability-conservation",
  "programmable-owner-only-claim",
  "owner-selected-per-claim-destination",
  "project-claim-separation",
  "cross-pool-and-currency-isolation",
  "same-pool-self-call-forbidden",
  "claim-token-settlement-and-take",
  "zero-executed-quote-no-liability"
]);

const REQUIRED_FUNCTIONS = Object.freeze([
  "PROGRAMMABLE_FEE_OWNER",
  "PROGRAMMABLE_HUNDREDTHS_OF_BIP",
  "MINIMUM_EFFECTIVE_HUNDREDTHS_OF_BIP",
  "MAX_SELECTED_HUNDREDTHS_OF_BIP",
  "MAX_EXACT_OUTPUT_COMPATIBLE_LP_FEE",
  "canonicalPoolId",
  "canonicalPoolRegistered",
  "quoteCurrencyAddress",
  "programmableFeeRemainder",
  "projectFeeRemainder",
  "claimableLiability",
  "registerCanonicalPool",
  "effectiveTotalHundredthsOfBip",
  "quoteGrossFees",
  "quoteExactOutputFees",
  "claimProgrammableFees",
  "claimProjectFees",
  "getHookPermissions"
]);

const REQUIRED_EVENTS = Object.freeze([
  "CanonicalPoolRegistered",
  "QuoteFeesAccrued",
  "ProgrammableFeesClaimed",
  "ProjectFeesClaimed"
]);

const REQUIRED_ERRORS = Object.freeze([
  "PartialFillUnsupported",
  "QuoteAmountBelowFeeQuantum",
  "UnauthorizedClaim"
]);

const EXPECTED_MANIFEST = Object.freeze({
  policyId: FEE_POLICY_ID,
  policyVersion: FEE_POLICY_VERSION,
  platformOwner: PROGRAMMABLE_FEE_OWNER,
  rateUnit: "hundredths-of-bip",
  formula: "effective=max(selected,1000);platform=1000;project=effective-1000",
  poolScope: "single-canonical-pool-key",
  quoteBasis: "executed-gross-quote-side-volume",
  collectionPath: "quadrant-dependent-swap-return-delta",
  partialFillPolicy: "specified-quote-atomic-revert",
  dustPolicy: "nonzero-gross-below-1000-smallest-units-atomic-revert",
  roundingPolicy: "cumulative-independent-platform-project-remainders",
  remainderScope: "canonical-pool-lifetime",
  claimResetsRemainders: false,
  minimumGrossQuoteUnits: 1_000,
  fragmentationResistant: true,
  selfCallPolicy: "same-pool-swap-forbidden",
  settlementPath: "erc6909-claim-burn-then-underlying-take",
  claimDestinationPolicy: "owner-or-owner-selected-per-claim",
  hookAddressPolicy: "create2-exact-permission-mask",
  maxExactOutputCompatibleLpFeePips: 999_998
});

const BYTECODE_MINIMUM_HEX_LENGTH = 1_024;
const MAX_FILE_BYTES = Object.freeze({
  source: 1_000_000,
  supportingSource: 1_000_000,
  artifact: 16_000_000,
  buildInfo: 96_000_000,
  evidence: 4_000_000,
  manifest: 1_000_000
});

export function effectiveHundredthsOfBip(selectedValue) {
  const selected = toRate(selectedValue, "selectedHundredthsOfBip");
  if (selected > MAX_SELECTED_HUNDREDTHS_OF_BIP) {
    throw new RangeError(`selectedHundredthsOfBip must be at most ${MAX_SELECTED_HUNDREDTHS_OF_BIP}`);
  }
  return selected < PROGRAMMABLE_HUNDREDTHS_OF_BIP ? PROGRAMMABLE_HUNDREDTHS_OF_BIP : selected;
}

export function computeGrossFeeSplit(grossValue, selectedValue, remainderState = {}) {
  const gross = toUnsignedBigInt(grossValue, "grossQuoteAmount");
  const selected = toRate(selectedValue, "selectedHundredthsOfBip");
  const effective = effectiveHundredthsOfBip(selected);
  if (gross !== 0n && gross < MIN_GROSS_QUOTE_AMOUNT) {
    throw new RangeError(
      `grossQuoteAmount is below the ${MIN_GROSS_QUOTE_AMOUNT}-unit Programmable fee quantum`
    );
  }

  const projectRate = effective - PROGRAMMABLE_HUNDREDTHS_OF_BIP;
  const programmableRemainder = toRemainder(
    remainderState.programmableFeeRemainder ?? 0n,
    "programmableFeeRemainder"
  );
  const projectRemainder = toRemainder(
    remainderState.projectFeeRemainder ?? 0n,
    "projectFeeRemainder"
  );
  const programmable = accumulateRate(gross, PROGRAMMABLE_HUNDREDTHS_OF_BIP, programmableRemainder);
  const project = accumulateRate(gross, projectRate, projectRemainder);
  const programmableFee = programmable.fee;
  const projectFee = project.fee;
  const totalFee = projectFee + programmableFee;

  return Object.freeze({
    grossQuoteAmount: gross,
    selectedHundredthsOfBip: selected,
    effectiveHundredthsOfBip: effective,
    programmableHundredthsOfBip: PROGRAMMABLE_HUNDREDTHS_OF_BIP,
    projectHundredthsOfBip: projectRate,
    totalFee,
    programmableFee,
    projectFee,
    programmableFeeRemainder: programmable.nextRemainder,
    projectFeeRemainder: project.nextRemainder,
    netQuoteAmount: gross - totalFee
  });
}

export function computeExactOutputFeeSplit(netValue, selectedValue, remainderState = {}) {
  const net = toUnsignedBigInt(netValue, "netQuoteAmount");
  const selected = toRate(selectedValue, "selectedHundredthsOfBip");
  const effective = effectiveHundredthsOfBip(selected);
  const denominator = RATE_DENOMINATOR - effective;
  if (net === 0n) return computeGrossFeeSplit(0n, selected, remainderState);
  const estimate = ceilDiv(net * RATE_DENOMINATOR, denominator);
  let gross = estimate > 8n ? estimate - 8n : MIN_GROSS_QUOTE_AMOUNT;
  if (gross < MIN_GROSS_QUOTE_AMOUNT) gross = MIN_GROSS_QUOTE_AMOUNT;
  for (let index = 0; index < 17; index += 1) {
    const split = computeGrossFeeSplit(gross, selected, remainderState);
    if (split.netQuoteAmount === net) return split;
    gross += 1n;
  }
  throw new RangeError("exact-output amount cannot be represented under the declared cumulative rounding rule");
}

function accumulateRate(gross, rate, carriedRemainder) {
  const fractional = (gross * rate) % RATE_DENOMINATOR;
  const combined = fractional + carriedRemainder;
  return {
    fee: (gross * rate) / RATE_DENOMINATOR + combined / RATE_DENOMINATOR,
    nextRemainder: combined % RATE_DENOMINATOR
  };
}

function toRemainder(value, label) {
  const remainder = toUnsignedBigInt(value, label);
  if (remainder >= RATE_DENOMINATOR) throw new RangeError(`${label} must be below ${RATE_DENOMINATOR}`);
  return remainder;
}

export function collectionPathFor({ quoteIsCurrency0, zeroForOne, exactInput }) {
  for (const [name, value] of Object.entries({ quoteIsCurrency0, zeroForOne, exactInput })) {
    if (typeof value !== "boolean") throw new TypeError(`${name} must be boolean`);
  }
  const specifiedIsCurrency0 = zeroForOne === exactInput;
  return specifiedIsCurrency0 === quoteIsCurrency0
    ? "before-swap-return-delta"
    : "after-swap-return-delta";
}

export function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

export function createFeeConformanceManifest({
  root,
  source,
  artifact,
  buildInfo,
  evidence,
  contractName,
  supportingSources = []
}) {
  const rootPath = canonicalRoot(root);
  const sourceRecord = createFileRecord(rootPath, source, "source");
  const artifactRecord = createFileRecord(rootPath, artifact, "artifact");
  const buildInfoRecord = createFileRecord(rootPath, buildInfo, "buildInfo");
  const evidenceRecord = createFileRecord(rootPath, evidence, "evidence");
  if (!/^[A-Z][A-Za-z0-9_]{0,127}$/.test(contractName ?? "")) {
    throw new Error("contractName must be a Solidity identifier beginning with an uppercase letter");
  }

  const normalizedSupporting = supportingSources.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("each supporting source must be an object");
    }
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(entry.role ?? "")) {
      throw new Error("supporting source role must be lowercase kebab-case");
    }
    return { role: entry.role, ...createFileRecord(rootPath, entry.path, "supportingSource") };
  });

  return {
    schemaVersion: FEE_CONFORMANCE_SCHEMA_VERSION,
    candidateStatus: "reference-candidate-not-audited-or-deployed",
    policy: { ...EXPECTED_MANIFEST },
    contract: {
      name: contractName,
      source: sourceRecord,
      artifact: artifactRecord,
      buildInfo: buildInfoRecord,
      supportingSources: normalizedSupporting
    },
    evidence: evidenceRecord
  };
}

export function validateFeeConformance({ manifestPath, root = path.dirname(path.resolve(manifestPath)) }) {
  const errors = [];
  const warnings = [
    "Structural conformance is not a security audit, semantic proof, deployment receipt, or runtime evidence.",
    "Builder-supplied build info and test evidence remain untrusted until a maintainer rebuilds and reruns them in an isolated sandbox."
  ];
  let manifest;
  let rootPath;
  let resolvedManifest;

  try {
    rootPath = canonicalRoot(root);
    resolvedManifest = resolveCandidateFile(rootPath, manifestPath, "manifest", MAX_FILE_BYTES.manifest);
    manifest = readJson(resolvedManifest.absolutePath, "manifest");
  } catch (error) {
    errors.push(error.message);
    return conformanceResult(errors, warnings);
  }

  validateManifestShape(manifest, errors);
  if (errors.length > 0) return conformanceResult(errors, warnings);

  let sourceRecord;
  let artifactRecord;
  let buildInfoRecord;
  let evidenceRecord;
  const supportingRecords = [];
  try {
    sourceRecord = resolveAndHashRecord(rootPath, manifest.contract.source, "source");
    artifactRecord = resolveAndHashRecord(rootPath, manifest.contract.artifact, "artifact");
    buildInfoRecord = resolveAndHashRecord(rootPath, manifest.contract.buildInfo, "buildInfo");
    evidenceRecord = resolveAndHashRecord(rootPath, manifest.evidence, "evidence");
    for (const entry of manifest.contract.supportingSources) {
      supportingRecords.push({
        role: entry.role,
        ...resolveAndHashRecord(rootPath, entry, "supportingSource")
      });
    }
  } catch (error) {
    errors.push(error.message);
    return conformanceResult(errors, warnings);
  }

  const source = fs.readFileSync(sourceRecord.absolutePath, "utf8");
  let artifact;
  let buildInfo;
  let evidence;
  try {
    artifact = readJson(artifactRecord.absolutePath, "artifact");
    buildInfo = readJson(buildInfoRecord.absolutePath, "build info");
    evidence = readJson(evidenceRecord.absolutePath, "evidence");
  } catch (error) {
    errors.push(error.message);
    return conformanceResult(errors, warnings);
  }

  validateSource(source, errors);
  validateFactorySource(supportingRecords, errors);
  validateArtifactAndBuildInfo({
    artifact,
    buildInfo,
    source,
    sourcePath: manifest.contract.source.path,
    contractName: manifest.contract.name,
    errors
  });
  validateEvidence({
    evidence,
    manifest,
    buildInfo,
    sourceRecord,
    artifactRecord,
    buildInfoRecord,
    supportingRecords,
    errors
  });

  return conformanceResult(errors, warnings, {
    manifestSha256: sha256File(resolvedManifest.absolutePath),
    sourceSha256: sourceRecord.sha256,
    artifactSha256: artifactRecord.sha256,
    buildInfoSha256: buildInfoRecord.sha256,
    evidenceSha256: evidenceRecord.sha256
  });
}

function validateManifestShape(manifest, errors) {
  if (!isPlainObject(manifest)) {
    errors.push("manifest must be a JSON object");
    return;
  }
  rejectDangerousObjectKeys(manifest, "manifest", errors);
  if (manifest.schemaVersion !== FEE_CONFORMANCE_SCHEMA_VERSION) {
    errors.push(`manifest.schemaVersion must equal ${FEE_CONFORMANCE_SCHEMA_VERSION}`);
  }
  if (manifest.candidateStatus !== "reference-candidate-not-audited-or-deployed") {
    errors.push("manifest.candidateStatus must explicitly say reference-candidate-not-audited-or-deployed");
  }
  if (!isPlainObject(manifest.policy)) {
    errors.push("manifest.policy must be an object");
  } else {
    for (const [key, expected] of Object.entries(EXPECTED_MANIFEST)) {
      const actual = key === "platformOwner" ? checksumInsensitive(manifest.policy[key]) : manifest.policy[key];
      const normalizedExpected = key === "platformOwner" ? expected.toLowerCase() : expected;
      if (actual !== normalizedExpected) errors.push(`manifest.policy.${key} must equal ${expected}`);
    }
  }
  if (!isPlainObject(manifest.contract)) {
    errors.push("manifest.contract must be an object");
    return;
  }
  if (!/^[A-Z][A-Za-z0-9_]{0,127}$/.test(manifest.contract.name ?? "")) {
    errors.push("manifest.contract.name is not a supported Solidity contract name");
  }
  for (const key of ["source", "artifact", "buildInfo"]) {
    validateFileRecordShape(manifest.contract[key], `manifest.contract.${key}`, errors);
  }
  if (!Array.isArray(manifest.contract.supportingSources) || manifest.contract.supportingSources.length === 0) {
    errors.push("manifest.contract.supportingSources must include the CREATE2 hook factory");
  } else {
    const roles = new Set();
    for (const [index, entry] of manifest.contract.supportingSources.entries()) {
      validateFileRecordShape(entry, `manifest.contract.supportingSources[${index}]`, errors);
      if (!/^[a-z][a-z0-9-]{0,63}$/.test(entry?.role ?? "")) {
        errors.push(`manifest.contract.supportingSources[${index}].role must be lowercase kebab-case`);
      } else if (roles.has(entry.role)) {
        errors.push(`duplicate supporting source role: ${entry.role}`);
      } else {
        roles.add(entry.role);
      }
    }
    if (!roles.has("hook-factory")) errors.push("supporting source role hook-factory is required");
  }
  validateFileRecordShape(manifest.evidence, "manifest.evidence", errors);
}

function validateFileRecordShape(record, label, errors) {
  if (!isPlainObject(record)) {
    errors.push(`${label} must be an object`);
    return;
  }
  if (typeof record.path !== "string" || record.path.length === 0) errors.push(`${label}.path is required`);
  if (!/^[a-f0-9]{64}$/.test(record.sha256 ?? "")) errors.push(`${label}.sha256 must be lowercase SHA-256`);
}

function validateSource(rawSource, errors) {
  const source = stripSolidityComments(rawSource);
  const normalized = source.replace(/\s+/g, "").replace(/(?<=\d)_(?=\d)/g, "");
  const requirePattern = (pattern, message) => {
    if (!pattern.test(source)) errors.push(message);
  };

  if (!new RegExp(PROGRAMMABLE_FEE_OWNER, "i").test(source)) {
    errors.push(`source must bind the exact Programmable fee owner ${PROGRAMMABLE_FEE_OWNER}`);
  }
  for (const [name, expected] of [
    ["RATE_DENOMINATOR", "1000000"],
    ["PROGRAMMABLE_HUNDREDTHS_OF_BIP", "1000"],
    ["MINIMUM_EFFECTIVE_HUNDREDTHS_OF_BIP", "1000"],
    ["MAX_SELECTED_HUNDREDTHS_OF_BIP", "100000"]
  ]) {
    if (!normalized.includes(`${name}=${expected}`)) errors.push(`source must define ${name} as ${expected}`);
  }

  requirePattern(/contract\s+[A-Za-z_][A-Za-z0-9_]*\s+is\s+[^\{]*\bBaseHook\b/s, "source must inherit BaseHook");
  requirePattern(/function\s+_beforeSwap\s*\(/, "source must implement _beforeSwap");
  requirePattern(/function\s+_afterSwap\s*\(/, "source must implement _afterSwap");
  requirePattern(/function\s+unlockCallback\s*\([^)]*\)[^{;]*\bonlyPoolManager\b/s, "unlockCallback must use onlyPoolManager");
  requirePattern(/msg\.sender\s*!=\s*PROGRAMMABLE_FEE_OWNER/, "Programmable claims must authenticate the immutable owner");
  requirePattern(/key\.toId\s*\(\s*\)/, "source must derive and compare the canonical PoolId from PoolKey");
  requirePattern(/PartialFillUnsupported/, "source must declare an atomic partial-fill rejection path");
  requirePattern(/QuoteAmountBelowFeeQuantum/, "source must declare the dust/rounding rejection path");
  requirePattern(/programmableFeeRemainder/, "source must persist the cumulative Programmable rounding remainder");
  requirePattern(/projectFeeRemainder/, "source must persist the cumulative project rounding remainder");
  requirePattern(/function\s+_accumulateRate\s*\(/, "source must implement one bounded cumulative rate accumulator");
  requirePattern(/mulmod\s*\(\s*grossQuoteAmount\s*,\s*rate\s*,\s*RATE_DENOMINATOR\s*\)/, "cumulative rounding must use overflow-safe modular multiplication");
  requirePattern(
    /_accumulateRate\s*\(\s*grossQuoteAmount\s*,\s*PROGRAMMABLE_HUNDREDTHS_OF_BIP\s*,\s*programmableFeeRemainder\s*\)/s,
    "source must carry the exact cumulative 10-bps Programmable remainder"
  );
  requirePattern(
    /_accumulateRate\s*\(\s*grossQuoteAmount\s*,\s*effective\s*-\s*PROGRAMMABLE_HUNDREDTHS_OF_BIP\s*,\s*projectFeeRemainder\s*\)/s,
    "source must carry the cumulative project-rate remainder independently"
  );
  requirePattern(/totalFee\s*=\s*projectFee\s*\+\s*programmableFee/, "total fee must conserve the two cumulative streams");
  requirePattern(/CurrenciesOutOfOrderOrEqual/, "source must reject unsorted or equal pool currencies before registration");
  requirePattern(/InvalidTickSpacing/, "source must reject invalid tick spacing before registration");
  requirePattern(/InvalidLpFee/, "source must reject invalid LP fees before registration");
  requirePattern(
    /uint24\s+public\s+constant\s+MAX_EXACT_OUTPUT_COMPATIBLE_LP_FEE\s*=\s*999_998\s*;/,
    "source must bind the exact-output-compatible static LP fee ceiling to 999998 pips"
  );
  requirePattern(
    /if\s*\(\s*!key\.fee\.isValid\s*\(\s*\)\s*\|\|\s*key\.fee\s*>\s*MAX_EXACT_OUTPUT_COMPATIBLE_LP_FEE\s*\)\s*revert\s+InvalidLpFee/,
    "the standard reference must reject LP fees above 999998 pips so maximum protocol fees cannot disable exact output"
  );
  requirePattern(
    /function\s+registerCanonicalPool\s*\([^)]*\)\s*external\s+nonReentrant\s+returns/,
    "canonical pool registration must guard its PoolManager initialization callback against reentry"
  );
  requirePattern(
    /function\s+registerCanonicalPool\s*\([^)]*sqrtPriceX96[^)]*\)[^{]*\{[\s\S]*poolManager\s*\.\s*initialize\s*\(\s*key\s*,\s*sqrtPriceX96\s*\)/,
    "canonical pool registration must atomically initialize PoolManager"
  );
  requirePattern(/toBeforeSwapDelta\s*\(/, "source must implement before-swap return-delta collection");
  requirePattern(/CurrencySettler/, "source must use the reviewed CurrencySettler claim-token path");
  requirePattern(/\.settle\s*\(/, "source must settle claim-token debt before taking underlying currency");
  requirePattern(/\.take\s*\(/, "source must take collected or redeemed quote currency through PoolManager");
  requirePattern(/SAME_POOL_SWAP_FORBIDDEN\s*=\s*true/, "source must explicitly forbid same-pool self-swaps");
  requirePattern(/beforeSwapReturnDelta\s*:\s*true/, "beforeSwapReturnDelta permission must be explicit");
  requirePattern(/afterSwapReturnDelta\s*:\s*true/, "afterSwapReturnDelta permission must be explicit");
  requirePattern(/beforeSwap\s*:\s*true/, "beforeSwap permission must be explicit");
  requirePattern(/afterSwap\s*:\s*true/, "afterSwap permission must be explicit");

  if (/poolManager\s*\.\s*swap\s*\(/.test(source)) {
    errors.push("source declares same-pool swaps forbidden but directly invokes poolManager.swap");
  }
  const publicFunctionNames = [...source.matchAll(/function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\([^)]*\)[^{;]*(?:public|external)/gs)]
    .map((match) => match[1]);
  for (const name of publicFunctionNames) {
    if (/(?:rescue|sweep|set.*programmable|update.*programmable|transfer.*programmable|change.*recipient)/i.test(name)) {
      errors.push(`source exposes forbidden liability redirection or rescue surface: ${name}`);
    }
  }
}

function validateFactorySource(records, errors) {
  const factory = records.find((entry) => entry.role === "hook-factory");
  if (!factory) return;
  const source = stripSolidityComments(fs.readFileSync(factory.absolutePath, "utf8"));
  for (const token of [
    "Create2",
    "ALL_HOOK_MASK",
    "REQUIRED_HOOK_FLAGS",
    "BEFORE_INITIALIZE_FLAG",
    "BEFORE_SWAP_FLAG",
    "AFTER_SWAP_FLAG",
    "BEFORE_SWAP_RETURNS_DELTA_FLAG",
    "AFTER_SWAP_RETURNS_DELTA_FLAG"
  ]) {
    if (!source.includes(token)) errors.push(`hook factory source is missing ${token}`);
  }
  if (!/actualFlags\s*!=\s*REQUIRED_HOOK_FLAGS/.test(source)) {
    errors.push("hook factory must reject every CREATE2 address whose permission bits are not exact");
  }
}

function validateArtifactAndBuildInfo({ artifact, buildInfo, source, sourcePath, contractName, errors }) {
  if (!isPlainObject(artifact)) {
    errors.push("artifact must be a JSON object");
    return;
  }
  if (!isPlainObject(buildInfo)) {
    errors.push("build info must be a JSON object");
    return;
  }
  rejectDangerousObjectKeys(artifact, "artifact", errors);
  rejectDangerousObjectKeys(buildInfo, "build info", errors);

  const normalizedSourcePath = sourcePath.replaceAll("\\", "/");
  const inputSource = buildInfo.input?.sources?.[normalizedSourcePath];
  const outputSource = buildInfo.output?.sources?.[normalizedSourcePath];
  const outputContract = buildInfo.output?.contracts?.[normalizedSourcePath]?.[contractName];
  if (buildInfo.input?.language !== "Solidity" || buildInfo.language !== "Solidity") {
    errors.push("build info must be a Solidity standard-json build");
  }
  if (!/^0\.8\.(?:2[4-9]|[3-9][0-9])(?:$|\+)/.test(buildInfo.solcVersion ?? "")) {
    errors.push("build info must identify Solidity 0.8.24 or newer");
  }
  if (inputSource?.content !== source) errors.push("build info input source content does not exactly match the source file");
  if (!outputSource?.ast || outputSource.ast.nodeType !== "SourceUnit") {
    errors.push("build info must include the compiler-produced source AST");
  }
  if (!outputContract) {
    errors.push(`build info output is missing ${normalizedSourcePath}:${contractName}`);
    return;
  }

  const artifactAbi = artifact.abi;
  const outputAbi = outputContract.abi;
  if (!Array.isArray(artifactAbi) || !Array.isArray(outputAbi)) {
    errors.push("artifact and build info must both contain an ABI");
  } else if (stableJson(artifactAbi) !== stableJson(outputAbi)) {
    errors.push("artifact ABI does not match the build-info contract ABI");
  }

  const artifactBytecode = stripHexPrefix(artifact.deployedBytecode?.object);
  const outputBytecode = stripHexPrefix(outputContract.evm?.deployedBytecode?.object);
  if (!isHex(artifactBytecode) || artifactBytecode.length < BYTECODE_MINIMUM_HEX_LENGTH) {
    errors.push("artifact deployed bytecode is missing or too small for the required fee hook surface");
  }
  if (!isHex(outputBytecode) || outputBytecode.length < BYTECODE_MINIMUM_HEX_LENGTH) {
    errors.push("build-info deployed bytecode is missing or too small for the required fee hook surface");
  }
  if (artifactBytecode !== outputBytecode) errors.push("artifact deployed bytecode does not match build info");

  if (Array.isArray(artifactAbi)) validateAbi(artifactAbi, errors);
  const astContract = findAstContract(outputSource?.ast, contractName);
  if (!astContract) {
    errors.push(`compiler AST is missing contract ${contractName}`);
  } else {
    const astFunctions = new Set(
      (astContract.nodes ?? [])
        .filter((node) => node?.nodeType === "FunctionDefinition" && typeof node.name === "string")
        .map((node) => node.name)
    );
    for (const name of [
      "registerCanonicalPool",
      "claimProgrammableFees",
      "claimProjectFees",
      "getHookPermissions",
      "_beforeSwap",
      "_afterSwap",
      "unlockCallback"
    ]) {
      if (!astFunctions.has(name)) errors.push(`compiler AST is missing required function ${name}`);
    }
  }
}

function validateAbi(abi, errors) {
  const functionEntries = abi.filter((entry) => entry?.type === "function");
  const functions = new Map(functionEntries.map((entry) => [entry.name, entry]));
  const events = new Set(abi.filter((entry) => entry?.type === "event").map((entry) => entry.name));
  const customErrors = new Set(abi.filter((entry) => entry?.type === "error").map((entry) => entry.name));
  for (const name of REQUIRED_FUNCTIONS) if (!functions.has(name)) errors.push(`ABI is missing function ${name}`);
  for (const name of REQUIRED_EVENTS) if (!events.has(name)) errors.push(`ABI is missing event ${name}`);
  for (const name of REQUIRED_ERRORS) if (!customErrors.has(name)) errors.push(`ABI is missing error ${name}`);

  const claim = functions.get("claimProgrammableFees");
  if (claim && (claim.stateMutability !== "nonpayable" || claim.inputs?.length !== 1 || claim.inputs[0]?.type !== "address")) {
    errors.push("claimProgrammableFees ABI must accept exactly one per-claim destination address");
  }
  const banned = functionEntries
    .map((entry) => entry.name)
    .filter((name) => /(?:rescue|sweep|set.*programmable|update.*programmable|change.*recipient)/i.test(name));
  for (const name of banned) errors.push(`ABI exposes forbidden liability redirection or rescue surface: ${name}`);
}

function validateEvidence({
  evidence,
  manifest,
  buildInfo,
  sourceRecord,
  artifactRecord,
  buildInfoRecord,
  supportingRecords,
  errors
}) {
  if (!isPlainObject(evidence)) {
    errors.push("evidence must be a JSON object");
    return;
  }
  rejectDangerousObjectKeys(evidence, "evidence", errors);
  if (evidence.schemaVersion !== "programmable-fee-conformance-evidence-v1") {
    errors.push("evidence.schemaVersion must equal programmable-fee-conformance-evidence-v1");
  }
  if (evidence.evidenceLevel !== "builder-supplied-local-untrusted") {
    errors.push("evidence.evidenceLevel must remain builder-supplied-local-untrusted");
  }
  if (evidence.auditStatus !== "not-independently-audited") {
    errors.push("evidence.auditStatus must explicitly remain not-independently-audited");
  }
  if (evidence.deploymentStatus !== "not-deployed") {
    errors.push("evidence.deploymentStatus must explicitly remain not-deployed");
  }
  if (evidence.runner?.tool !== "forge" || evidence.runner?.exitCode !== 0) {
    errors.push("evidence.runner must record a successful Forge execution");
  }
  if (typeof evidence.runner?.command !== "string" || !/\bforge\s+test\b/.test(evidence.runner.command)) {
    errors.push("evidence.runner.command must identify the exact forge test command");
  }
  const expectedIntegrity = {
    sourceSha256: sourceRecord.sha256,
    artifactSha256: artifactRecord.sha256,
    buildInfoSha256: buildInfoRecord.sha256
  };
  for (const [key, expected] of Object.entries(expectedIntegrity)) {
    if (evidence.integrity?.[key] !== expected) errors.push(`evidence.integrity.${key} does not match the candidate`);
  }
  const supportingIntegrity = new Map(
    (evidence.integrity?.supportingSources ?? []).map((entry) => [entry?.role, entry?.sha256])
  );
  for (const entry of supportingRecords) {
    if (supportingIntegrity.get(entry.role) !== entry.sha256) {
      errors.push(`evidence integrity does not bind supporting source ${entry.role}`);
    }
  }

  if (!Array.isArray(evidence.scenarios)) {
    errors.push("evidence.scenarios must be an array");
    return;
  }
  const compiledTests = collectCompiledTests(buildInfo);
  const byId = new Map();
  for (const scenario of evidence.scenarios) {
    if (!isPlainObject(scenario) || typeof scenario.id !== "string") {
      errors.push("every evidence scenario must be an object with an id");
      continue;
    }
    if (byId.has(scenario.id)) errors.push(`duplicate evidence scenario ${scenario.id}`);
    byId.set(scenario.id, scenario);
    if (scenario.status !== "passed") errors.push(`evidence scenario ${scenario.id} did not pass`);
    if (typeof scenario.test !== "string" || !/^[A-Za-z0-9_]+::test[A-Za-z0-9_]+$/.test(scenario.test)) {
      errors.push(`evidence scenario ${scenario.id} must bind a Foundry contract::test name`);
    } else if (!compiledTests.has(scenario.test)) {
      errors.push(`evidence scenario ${scenario.id} names a test absent from compiler build info: ${scenario.test}`);
    }
  }
  for (const id of REQUIRED_EVIDENCE_SCENARIOS) {
    if (!byId.has(id)) errors.push(`missing required evidence scenario ${id}`);
  }

  if (manifest.candidateStatus !== "reference-candidate-not-audited-or-deployed") {
    errors.push("evidence cannot upgrade the candidate beyond its manifest status");
  }
}

function collectCompiledTests(buildInfo) {
  const tests = new Set();
  for (const outputSource of Object.values(buildInfo?.output?.sources ?? {})) {
    collectAstTests(outputSource?.ast, tests);
  }
  return tests;
}

function collectAstTests(node, tests, contractName = null) {
  if (!node || typeof node !== "object") return;
  const nextContractName = node.nodeType === "ContractDefinition" && typeof node.name === "string"
    ? node.name
    : contractName;
  if (
    node.nodeType === "FunctionDefinition"
    && nextContractName
    && typeof node.name === "string"
    && /^test[A-Za-z0-9_]+$/.test(node.name)
  ) {
    tests.add(`${nextContractName}::${node.name}`);
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const child of value) collectAstTests(child, tests, nextContractName);
    } else if (value && typeof value === "object") {
      collectAstTests(value, tests, nextContractName);
    }
  }
}

function conformanceResult(errors, warnings, integrity = null) {
  const uniqueErrors = [...new Set(errors)].sort();
  return {
    ok: uniqueErrors.length === 0,
    status: uniqueErrors.length === 0
      ? "STRUCTURALLY_CONFORMANT_REFERENCE_CANDIDATE"
      : "FEE_CONFORMANCE_FAILED",
    policyId: FEE_POLICY_ID,
    policyVersion: FEE_POLICY_VERSION,
    assurance: "structural-only-not-an-audit",
    evidenceTrust: "builder-supplied-untrusted",
    integrity,
    errors: uniqueErrors,
    warnings
  };
}

function createFileRecord(rootPath, requestedPath, kind) {
  const record = resolveCandidateFile(rootPath, requestedPath, kind, MAX_FILE_BYTES[kind]);
  return { path: record.relativePath, sha256: sha256File(record.absolutePath) };
}

function resolveAndHashRecord(rootPath, record, kind) {
  const resolved = resolveCandidateFile(rootPath, record.path, kind, MAX_FILE_BYTES[kind]);
  const digest = sha256File(resolved.absolutePath);
  if (digest !== record.sha256) throw new Error(`${kind} SHA-256 does not match manifest: ${record.path}`);
  return { ...resolved, sha256: digest };
}

function resolveCandidateFile(rootPath, requestedPath, kind, maximumBytes) {
  if (typeof requestedPath !== "string" || requestedPath.length === 0 || requestedPath.includes("\0")) {
    throw new Error(`${kind} path must be a non-empty string`);
  }
  const absolutePath = path.isAbsolute(requestedPath)
    ? fs.realpathSync(path.resolve(requestedPath))
    : path.resolve(rootPath, requestedPath);
  const relativePath = path.relative(rootPath, absolutePath).replaceAll("\\", "/");
  if (relativePath === "" || relativePath === "." || relativePath.startsWith("../") || path.isAbsolute(relativePath)) {
    throw new Error(`${kind} path must stay inside the candidate root`);
  }
  assertNoSymlinkComponents(rootPath, absolutePath, kind);
  const stat = fs.statSync(absolutePath);
  if (!stat.isFile()) throw new Error(`${kind} path is not a file: ${relativePath}`);
  if (stat.size > maximumBytes) throw new Error(`${kind} exceeds ${maximumBytes} bytes: ${relativePath}`);
  return { absolutePath, relativePath };
}

function canonicalRoot(root) {
  if (typeof root !== "string" || root.length === 0) throw new Error("candidate root is required");
  const resolved = fs.realpathSync(path.resolve(root));
  if (!fs.statSync(resolved).isDirectory()) throw new Error("candidate root must be a directory");
  return resolved;
}

function assertNoSymlinkComponents(rootPath, absolutePath, kind) {
  const relative = path.relative(rootPath, absolutePath);
  let cursor = rootPath;
  for (const segment of relative.split(path.sep)) {
    cursor = path.join(cursor, segment);
    const stat = fs.lstatSync(cursor);
    if (stat.isSymbolicLink()) throw new Error(`${kind} path may not contain symbolic links`);
  }
}

function readJson(filePath, label) {
  let value;
  try {
    value = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
  return value;
}

function rejectDangerousObjectKeys(value, label, errors, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (["__proto__", "prototype", "constructor"].includes(key)) errors.push(`${label} contains forbidden key ${key}`);
    rejectDangerousObjectKeys(child, label, errors, seen);
  }
}

function findAstContract(ast, contractName) {
  if (!ast || typeof ast !== "object") return null;
  if (ast.nodeType === "ContractDefinition" && ast.name === contractName) return ast;
  for (const value of Object.values(ast)) {
    if (Array.isArray(value)) {
      for (const child of value) {
        const found = findAstContract(child, contractName);
        if (found) return found;
      }
    } else if (value && typeof value === "object") {
      const found = findAstContract(value, contractName);
      if (found) return found;
    }
  }
  return null;
}

function stripSolidityComments(source) {
  let output = "";
  let index = 0;
  let state = "code";
  while (index < source.length) {
    const current = source[index];
    const next = source[index + 1];
    if (state === "code" && current === "/" && next === "/") {
      state = "line";
      output += "  ";
      index += 2;
      continue;
    }
    if (state === "code" && current === "/" && next === "*") {
      state = "block";
      output += "  ";
      index += 2;
      continue;
    }
    if (state === "line") {
      if (current === "\n") {
        state = "code";
        output += "\n";
      } else output += " ";
      index += 1;
      continue;
    }
    if (state === "block") {
      if (current === "*" && next === "/") {
        state = "code";
        output += "  ";
        index += 2;
      } else {
        output += current === "\n" ? "\n" : " ";
        index += 1;
      }
      continue;
    }
    output += current;
    index += 1;
  }
  return output;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stripHexPrefix(value) {
  if (typeof value !== "string") return "";
  return value.startsWith("0x") ? value.slice(2).toLowerCase() : value.toLowerCase();
}

function isHex(value) {
  return typeof value === "string" && value.length % 2 === 0 && /^[a-f0-9]+$/.test(value);
}

function checksumInsensitive(value) {
  return typeof value === "string" ? value.toLowerCase() : value;
}

function toRate(value, label) {
  const rate = toUnsignedBigInt(value, label);
  if (rate > MAX_SELECTED_HUNDREDTHS_OF_BIP) {
    throw new RangeError(`${label} must be at most ${MAX_SELECTED_HUNDREDTHS_OF_BIP}`);
  }
  return rate;
}

function toUnsignedBigInt(value, label) {
  let parsed;
  try {
    if (typeof value === "bigint") parsed = value;
    else if (typeof value === "number" && Number.isSafeInteger(value)) parsed = BigInt(value);
    else if (typeof value === "string" && /^(?:0|[1-9][0-9]*)$/.test(value)) parsed = BigInt(value);
    else throw new Error();
  } catch {
    throw new TypeError(`${label} must be an unsigned integer`);
  }
  if (parsed < 0n) throw new RangeError(`${label} must be non-negative`);
  return parsed;
}

function ceilDiv(numerator, denominator) {
  if (denominator <= 0n) throw new RangeError("denominator must be positive");
  return numerator === 0n ? 0n : (numerator + denominator - 1n) / denominator;
}
