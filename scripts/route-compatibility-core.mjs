import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { parseBoundedLosslessJson } from "../skills/programmable-v4-hook-builder/scripts/github-public-source-core.mjs";
import { canonicalJsonBytesV2 } from "../skills/programmable-v4-hook-builder/scripts/canonical-json-core.mjs";
import {
  checksumAddress,
  keccak256Hex
} from "../skills/programmable-v4-hook-builder/scripts/evm-encoding-core.mjs";
import { validateAgainstSchema } from "../skills/programmable-v4-hook-builder/scripts/restricted-json-schema-core.mjs";

export const REVIEWED_ROUTE_PLAN_SCHEMA_VERSION = "1.0.0";
export const MAXIMUM_REVIEWED_ROUTE_PLAN_BYTES = 64 * 1024;
export const ROUTE_CAPABILITY_CATALOG_VERSION = "1.0.0";
export const EXACT_SHARDS_APPLICANT_GITHUB_USER_ID = 155705664;
export const REVENUE_LEG_V1_TYPE =
  "ProgrammableRevenueLegV1(bytes32 roleHash,uint16 feeBps,address recipient,bytes32 recipientModeHash)";
export const REVENUE_LEG_V1_TYPEHASH =
  "0x6b5107011760a096b681164d179eacb4aeae665d02a08c0447d81f87191f09b7";
export const REVENUE_POLICY_V1_TYPE =
  "ProgrammableRevenuePolicyV1(bytes32 profileKey,address feeAsset,bytes32 feeBasisHash,uint16 totalFeeBps,bytes32 legsHash)";
export const REVENUE_POLICY_V1_TYPEHASH =
  "0x59529fb66a882121389cebbaa9a4bbbfa4ccf1fe6ce4bcecc00d5f38935f3202";
export const EXACT_SHARDS_REVENUE_POLICY_HASH =
  "0xaa78b0bf63fca83fa9b969fbb6b2bb1ecabcbe49908a48f92403e8e51e4adab2";
export const EXACT_SHARDS_REVENUE_POLICY_V1 = deepFreeze({
  legType: REVENUE_LEG_V1_TYPE,
  legTypeHash: REVENUE_LEG_V1_TYPEHASH,
  policyType: REVENUE_POLICY_V1_TYPE,
  policyTypeHash: REVENUE_POLICY_V1_TYPEHASH,
  profileKey: "0xb90e215e0e29c0dacf021e5e778847af4100433ee7d22014b73f8ca4add09d0c",
  feeAsset: "0x0000000000000000000000000000000000000000",
  feeBasisLabel: "ProgrammableRevenueFeeBasisV1:inclusive-gross-eth-moved",
  feeBasisHash: "0xfb8110e8ea13fee890a868300dd1a9a5c467acb19a53f63beccc482757a36191",
  totalFeeBps: 100,
  legOrder: ["builder-provider", "programmable-launcher", "shards-nft-holders"],
  legs: [
    {
      roleLabel: "ProgrammableRevenueRoleV1:builder-provider",
      roleHash: "0x36a60a66fdf8fc39bbaab0d3ff46b52ffc8a9b6f3dc94b5fe9836816d72890af",
      feeBps: 10,
      recipient: "0xceeBB3A6543CeBEB2ED66963897A0abEA52A50cC",
      recipientModeLabel:
        "ProgrammableRevenueRecipientModeV1:current-builder-may-rotate-to-successor",
      recipientModeHash:
        "0xc1ed7eaa8d37d922e99971bb6369533361b226b731cf9677e60e36b376519ea4",
      abiPreimage:
        "0x6b5107011760a096b681164d179eacb4aeae665d02a08c0447d81f87191f09b736a60a66fdf8fc39bbaab0d3ff46b52ffc8a9b6f3dc94b5fe9836816d72890af000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000ceebb3a6543cebeb2ed66963897a0abea52a50ccc1ed7eaa8d37d922e99971bb6369533361b226b731cf9677e60e36b376519ea4",
      legHash: "0x10c851ca78aa2bf257e924b5b4b1a471b8f091e5d971f1a2422165a60bd325ac"
    },
    {
      roleLabel: "ProgrammableRevenueRoleV1:programmable-launcher",
      roleHash: "0x069cb8bbaf512d6f3d7fd962d64b67ce531a420f558aa3a2301e77be3640d875",
      feeBps: 10,
      recipient: "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c",
      recipientModeLabel: "ProgrammableRevenueRecipientModeV1:immutable-launcher-recipient",
      recipientModeHash:
        "0x496f134b2bbc4d8ae230c1aa1a607788d75231c8ee823312e515b851a927d4f4",
      abiPreimage:
        "0x6b5107011760a096b681164d179eacb4aeae665d02a08c0447d81f87191f09b7069cb8bbaf512d6f3d7fd962d64b67ce531a420f558aa3a2301e77be3640d875000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000004957f49620aff3adbbe8195a4f633e49cc93376c496f134b2bbc4d8ae230c1aa1a607788d75231c8ee823312e515b851a927d4f4",
      legHash: "0xccc9d7a84cef40c38d165ba1ce0f1817f77172bc97b49155ac6a14fcc5e6cff5"
    },
    {
      roleLabel: "ProgrammableRevenueRoleV1:shards-nft-holders",
      roleHash: "0x84edd196638e45435db849686913b0ffb528525a1edc3aece78548ed6f2577f1",
      feeBps: 80,
      recipient: "0xbA318baA8649962fD77CC7082d098f2C09Fd60cC",
      recipientModeLabel:
        "ProgrammableRevenueRecipientModeV1:exact-shards-hook-running-holder-accumulator",
      recipientModeHash:
        "0x9aec909e12714c25df903902800a480772830ed15716e130e797f7447138ba55",
      abiPreimage:
        "0x6b5107011760a096b681164d179eacb4aeae665d02a08c0447d81f87191f09b784edd196638e45435db849686913b0ffb528525a1edc3aece78548ed6f2577f10000000000000000000000000000000000000000000000000000000000000050000000000000000000000000ba318baa8649962fd77cc7082d098f2c09fd60cc9aec909e12714c25df903902800a480772830ed15716e130e797f7447138ba55",
      legHash: "0x30cf730abcc37ad7db1d6e91abad8c1564fc624c777c456da987f0e006b9ff9e"
    }
  ],
  legsHashEncoding: "keccak256(abi.encode(builderLegHash,programmableLegHash,holdersLegHash))",
  legsAbiPreimage:
    "0x10c851ca78aa2bf257e924b5b4b1a471b8f091e5d971f1a2422165a60bd325acccc9d7a84cef40c38d165ba1ce0f1817f77172bc97b49155ac6a14fcc5e6cff530cf730abcc37ad7db1d6e91abad8c1564fc624c777c456da987f0e006b9ff9e",
  legsHash: "0x14e66b725eaebf6f894323565651567cc05a71bbb263db373d1f9f59ea171899",
  policyAbiPreimage:
    "0x59529fb66a882121389cebbaa9a4bbbfa4ccf1fe6ce4bcecc00d5f38935f3202b90e215e0e29c0dacf021e5e778847af4100433ee7d22014b73f8ca4add09d0c0000000000000000000000000000000000000000000000000000000000000000fb8110e8ea13fee890a868300dd1a9a5c467acb19a53f63beccc482757a36191000000000000000000000000000000000000000000000000000000000000006414e66b725eaebf6f894323565651567cc05a71bbb263db373d1f9f59ea171899",
  revenuePolicyHash: EXACT_SHARDS_REVENUE_POLICY_HASH
});
export const EXACT_SHARDS_REVIEWED_PLAN_V1 = deepFreeze({
  schemaVersion: "1.0.0",
  profile: "exact-shards-nested-factory",
  reviewedRequest: {
    path: "submissions/requests/1329073878-shards-v1.json",
    applicationManifestSha256: "sha256:e069926d380e56bee001dd7cfeda591db56164b1acf7478b478dd62a6e119ec2",
    pullRequest: {
      number: 6,
      headCommit: "1aa5017154d227e639cfe6256f39bf3916352124",
      authorGithubUserId: EXACT_SHARDS_APPLICANT_GITHUB_USER_ID
    }
  },
  source: {
    repository: "https://github.com/jesse-stahl/shards-v1",
    repositoryId: 1329073878,
    commit: "91b38f3de64d96cac7e29f127c004f128fc1da59",
    tree: "92d6def8609e829487adea66c13901734e43c8c7"
  },
  artifact: {
    path: "releases/shards-v1/mainnet-manifest.json",
    bytes: 7179,
    sha256: "sha256:060a103099589e938e9191cab7c18d98aa5c733eef712b14096a33d5cb48dc8e"
  },
  routeTarget: {
    role: "applicant-factory",
    address: "0x9442a520e7b31D10177C75A363355C2C29141ac5",
    runtimeCodeHash: "0x134a9e5674f22e62e939c2238693077b8027c553bb26d6a4e9e3d8554e5f85b5"
  },
  poolManager: {
    address: "0x000000000004444c5dc75cB358380D2e3dE08A90",
    runtimeCodeHash: "0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293"
  },
  factoryInterface: {
    abiSha256: "sha256:da03faea6b8c6232ddd0322b29670d1dd80e5c69cf3410bc5b302e98bfdf7c29",
    descriptor: {
      schemaVersion: "programmable.shards-factory-route-abi.v1",
      launch: {
        signature: "launch(bytes32,bytes32,bytes,(int24,int24,int24,uint160,address,string,string,string,string))",
        selector: "0x0c4ad85f",
        stateMutability: "nonpayable",
        returns: [
          { index: 0, kind: "hook", solidityType: "address" },
          { index: 1, kind: "token", solidityType: "address" },
          { index: 2, kind: "nft", solidityType: "address" }
        ]
      },
      configurationRead: {
        signature: "configurationHashOf(address)",
        selector: "0xb6eda14f",
        stateMutability: "view",
        returns: "bytes32"
      }
    }
  },
  artifactCode: [
    {
      kind: "factory",
      expectedRuntimeCodeHash: "0x134a9e5674f22e62e939c2238693077b8027c553bb26d6a4e9e3d8554e5f85b5",
      creationCodeHash: "0xc6b8a2cd51ccf198c4e6e41f668c4e4f558f81de0e677ef27373c614bf4c02f8"
    },
    {
      kind: "renderer",
      expectedRuntimeCodeHash: "0x9b54a61918b2ddf9b7daf41d9bf2d705cbef3a0fd618275762b99e19c53459bf",
      creationCodeHash: "0x910d02d740c71d608b1dc3f49e26288b0f8a62abda0c7767e251d53520a6b51e"
    },
    {
      kind: "hook",
      expectedRuntimeCodeHash: "0x2a2174aff52c3ea9ddf0a6081464c9c6dbc43ddc93609c74d9610f50f486c1e1",
      creationCodeHash: "0x3fbdbc069ee5bfcb1ded77a8d4e550f1bb0692a488b6eb5d23dac090fbca0716"
    },
    {
      kind: "token",
      expectedRuntimeCodeHash: "0xb2737fd93f2ff31e850e2be773e6e7a92a239b28091be1d4b122ff864cd7aae8",
      creationCodeHash: "0xa6461c32c0121f0090519945d9c22ed6406a783994e020f72a20e85796cad107"
    },
    {
      kind: "nft",
      expectedRuntimeCodeHash: "0xc3e3ea6cf4d2e13fa07a3b053d57cd7d6a6ecac7633aed86ab971d5e53959bb3",
      creationCodeHash: "0x888e18b33ff193b65eb61f44bc578d8d9365b505014af3782762a9d61fa39150"
    }
  ],
  configurationHash: "0xa98b7b95777267181a2b93a33632991e80a49f4a57d94150f8dfbd90421f34c1",
  revenuePolicy: EXACT_SHARDS_REVENUE_POLICY_V1,
  pool: {
    poolId: "0x075885e47ec15084de91826faafab9c2cd4fda4d24fd9e5ce3af6a4be4ad926d",
    poolKeyHash: "0x95c1d301b4a0be5bf2ec99270902aae6e8d8bd16a96a005d5985583c0b49835a",
    currency0: "0x0000000000000000000000000000000000000000",
    currency1: "0x50d17EAaeB52c66E64b918385AbF6523fDAE57CF",
    fee: 0,
    tickSpacing: 60
  },
  launchPlan: {
    create2Proxy: "0x4e59b44847b379578588920cA78FbF26c0B4956C",
    create2ProxyRuntimeCodeHash: "0x2fa86add0aed31f33a762c9d88e807c475bd51d0f52bd0955754b2608f7e4989",
    factorySalt: "0x655a4b5a2b704bef84b4ff94adde0a7ac40ad0366c82ddca5290180fe4c3986d",
    factoryInitCodeBytes: 37942,
    factoryInitCodeHash: "0x7d05592489495559b1288f8ad342239b3fb95a6aa005b5b0b1551c9523401585",
    factoryDeploymentCalldataBytes: 37974,
    factoryDeploymentCalldataHash: "0xf37ce9748abe4d5243cbd26f48c6ea5789ab1ebe8e19ea96d2198693e957c4ec",
    hookCreationCodeHash: "0x3fbdbc069ee5bfcb1ded77a8d4e550f1bb0692a488b6eb5d23dac090fbca0716",
    tokenInitCodeBytes: 3193,
    tokenInitCodeHash: "0x6e68433c748d6bac0a119815b0447aaa016c5fec1334cc9a412e76aa8149a358",
    hookInitCodeBytes: 26690,
    hookInitCodeHash: "0x6eb7c7447fa82da98f4776bcc0362303574b96c2584d1bef6ebf4aca2cc80d58",
    nftInitCodeBytes: 8496,
    nftInitCodeHash: "0x0b92ef914725a8a4cc39c39fd62fdd1b5123f3159e1eb71e20ae517c090a0c9b",
    launchCalldataBytes: 27140,
    launchCalldataHash: "0x39d08baf1cdececc5829853fd1274547c2e8260779d0c227ec30dc44daf1ae89",
    transactionCount: 1,
    transactionSender: "0xceeBB3A6543CeBEB2ED66963897A0abEA52A50cC",
    executionEntry: "acceptance-bound-router",
    factoryDeploymentExecution: {
      reviewedManifestExpectedTransactionSender: "0x2Bb333d48DFAF1596D9036671d2E43168994249E",
      productionExecutionCaller: "router-owned-exact-shards-profile-module"
    },
    factoryLaunchExecution: {
      productionExecutionCaller: "programmable-launch-stamp-router-v2"
    },
    factoryInitialStatePolicyV1: {
      mode: "vacant-or-exact-predeployed",
      allowedStates: [
        {
          id: "vacant-pair",
          factoryCode: "empty",
          rendererCode: "empty",
          action: "deploy-via-pinned-create2-proxy-then-launch-and-stamp"
        },
        {
          id: "exact-predeployed-pair",
          factoryRuntimeCodeHash:
            "0x134a9e5674f22e62e939c2238693077b8027c553bb26d6a4e9e3d8554e5f85b5",
          rendererRuntimeCodeHash:
            "0x9b54a61918b2ddf9b7daf41d9bf2d705cbef3a0fd618275762b99e19c53459bf",
          action: "launch-and-stamp"
        }
      ],
      exactFactoryInitcode: {
        requirement: "mandatory-in-both-allowed-states",
        byteLength: 37942,
        keccak256: "0x7d05592489495559b1288f8ad342239b3fb95a6aa005b5b0b1551c9523401585"
      },
      commonPreconditions: {
        tokenCode: "empty",
        hookCode: "empty",
        nftCode: "empty",
        poolSlot0: "zero"
      },
      rejectedStates: [
        "partial-factory-renderer-pair",
        "wrong-factory-runtime",
        "wrong-renderer-runtime",
        "occupied-child",
        "initialized-pool"
      ]
    },
    rawTokenSalt: "0xca9944c923e24ba5cb3188a29b18c3305158e686e39473e91bbe31fc019816ab",
    effectiveTokenSalt: "0x2fb771368a131f3ebf686980b44c57230bf257f4b82e95a10ef46d9b2bd7db37",
    hookSalt: "0x00000000000000000000000000000000000000000000000000000000000052e1",
    tickLower: -887220,
    tickBand: 22980,
    tickUpper: 69060,
    startSqrtPriceX96: "2502784483440051878955016419363",
    rendererSelection: "factory-default",
    tokenName: "Shard",
    tokenSymbol: "SHARD",
    nftName: "Shards",
    nftSymbol: "SHARDS",
    launcherFeeRecipient: "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c",
    builderFeeRecipient: "0xceeBB3A6543CeBEB2ED66963897A0abEA52A50cC"
  },
  components: [
    {
      kind: "renderer",
      address: "0x090DBD2FaB1a467f90ed82a443eFa9AAb658DE14",
      deployer: "0x9442a520e7b31D10177C75A363355C2C29141ac5",
      expectedRuntimeCodeHash: "0x9b54a61918b2ddf9b7daf41d9bf2d705cbef3a0fd618275762b99e19c53459bf"
    },
    {
      kind: "token",
      address: "0x50d17EAaeB52c66E64b918385AbF6523fDAE57CF",
      deployer: "0x9442a520e7b31D10177C75A363355C2C29141ac5",
      expectedRuntimeCodeHash: "0xb2737fd93f2ff31e850e2be773e6e7a92a239b28091be1d4b122ff864cd7aae8"
    },
    {
      kind: "hook",
      address: "0xbA318baA8649962fD77CC7082d098f2C09Fd60cC",
      deployer: "0x9442a520e7b31D10177C75A363355C2C29141ac5",
      expectedRuntimeCodeHash: "0x2a2174aff52c3ea9ddf0a6081464c9c6dbc43ddc93609c74d9610f50f486c1e1"
    },
    {
      kind: "nft",
      address: "0x9fDA98dE1B7061ae02A9Aec7A6f8ed75a8Feb8F3",
      deployer: "0x9442a520e7b31D10177C75A363355C2C29141ac5",
      expectedRuntimeCodeHash: "0xc3e3ea6cf4d2e13fa07a3b053d57cd7d6a6ecac7633aed86ab971d5e53959bb3"
    }
  ]
});
export const EXACT_SHARDS_REVIEWED_PLAN_SHA256 =
  "sha256:a1a8d40600c3d19fe629ec5be440974186d2e628c2350681ea66efa0403c1e45";
export const NESTED_FACTORY_PROFILE_KEY_DOMAIN =
  "ProgrammableNestedFactoryProfileV1(bytes32 profileIdHash,bytes32 profileVersionHash)";
export const NESTED_FACTORY_PROFILE_KEY_TYPEHASH =
  "0xd31d9770f502a83c5557bddbcc0249b7a2ff20d8378b2c2d68e90fd5514d2a51";
export const EXACT_SHARDS_PROFILE_ID_HASH =
  "0x80bf21eb2466daeb15cfbbc66749f03be10a9f84aa4060c8ce97146a93b8d33d";
export const EXACT_SHARDS_PROFILE_VERSION_HASH =
  "0x06c015bd22b4c69690933c1058878ebdfef31f9aaae40bbe86d8a09fe1b2972c";
export const EXACT_SHARDS_PROFILE_KEY =
  "0xb90e215e0e29c0dacf021e5e778847af4100433ee7d22014b73f8ca4add09d0c";
export const PRODUCTION_GRAPH_FACTORY_ADDRESS = "0xB012e4A8F2c5FC4E8E4faCA9D5Ad6FfF13FBA887";
export const PRODUCTION_GRAPH_FACTORY_RUNTIME_CODE_HASH =
  "0xd23692fae59331592048e71a96d4963e170ee56e449683dc9f7fa3f9470018b8";
export const SUPPORTED_ROUTE_BINDINGS = Object.freeze([
  Object.freeze({
    catalogVersion: ROUTE_CAPABILITY_CATALOG_VERSION,
    profileId: "direct-graph",
    profileVersion: "1.0.0",
    planSchemaId: "urn:programmable:reviewed-route-plan:1.0.0",
    profileSha256: null,
    profileKeyDomain: null,
    profileKeyTypehash: null,
    profileIdHash: null,
    profileVersionHash: null,
    profileKey: null,
    revenuePolicyHash: null,
    revenuePolicySemantics: "artifact-required/profile-specific",
    routeTargetAddress: PRODUCTION_GRAPH_FACTORY_ADDRESS,
    routeTargetRuntimeCodeHash: PRODUCTION_GRAPH_FACTORY_RUNTIME_CODE_HASH,
    factoryAddress: null,
    factoryRuntimeCodeHash: null,
    currentnessAttestationRequired: true,
    activationState: "enabled",
    platformAttestation: Object.freeze({
      schemaVersion: "programmable.platform-capability-attestation-reference.v1",
      finalizedBlockNumber: "25723754",
      finalizedBlockHash: "0xd73abbe464fa69424d2cf16e331c03428a5efca6cf07119510a62b13a4a8a706",
      getterBundleSha256: "sha256:6e6e8a93193bbe2f79f98594a1af32c27bae0746f8297dd13592d9608e2feb20",
      evidenceSha256: "sha256:f9786ebfb74c96a3c225567ad324f0fbecfd8520b8d8addec85ba58cd67e19ff"
    }),
    routeId: "custom-graph",
    routeVersion: "1.0.0",
    chainId: "1",
    supported: "direct-graph"
  }),
  Object.freeze({
    catalogVersion: ROUTE_CAPABILITY_CATALOG_VERSION,
    profileId: "exact-shards-nested-factory",
    profileVersion: "1.0.0",
    planSchemaId: "urn:programmable:reviewed-route-plan:1.0.0",
    profileSha256: EXACT_SHARDS_REVIEWED_PLAN_SHA256,
    profileKeyDomain: NESTED_FACTORY_PROFILE_KEY_DOMAIN,
    profileKeyTypehash: NESTED_FACTORY_PROFILE_KEY_TYPEHASH,
    profileIdHash: EXACT_SHARDS_PROFILE_ID_HASH,
    profileVersionHash: EXACT_SHARDS_PROFILE_VERSION_HASH,
    profileKey: EXACT_SHARDS_PROFILE_KEY,
    revenuePolicyHash: EXACT_SHARDS_REVENUE_POLICY_HASH,
    revenuePolicySemantics: "exact-profile-typed-v1",
    routeTargetAddress: null,
    routeTargetRuntimeCodeHash: null,
    factoryAddress: EXACT_SHARDS_REVIEWED_PLAN_V1.routeTarget.address,
    factoryRuntimeCodeHash: EXACT_SHARDS_REVIEWED_PLAN_V1.artifactCode
      .find(({ kind }) => kind === "factory").expectedRuntimeCodeHash,
    currentnessAttestationRequired: true,
    activationState: "disabled-pending-production-release-attestation",
    platformAttestation: null,
    routeId: "nested-factory",
    routeVersion: "1.0.0",
    chainId: "1",
    supported: "exact-shards-nested-factory"
  })
]);

export function loadReviewedRoutePlanSchema(repositoryRoot) {
  return JSON.parse(fs.readFileSync(
    path.join(repositoryRoot, "submissions", "schema", "reviewed-route-plan-v1.schema.json"),
    "utf8"
  ));
}

export function parseReviewedRoutePlan(bytes) {
  if (!Buffer.isBuffer(bytes)) throw new TypeError("reviewed route plan bytes must be a Buffer");
  if (bytes.length === 0 || bytes.length > MAXIMUM_REVIEWED_ROUTE_PLAN_BYTES) {
    throw new Error(`reviewed route plan must contain 1 to ${MAXIMUM_REVIEWED_ROUTE_PLAN_BYTES} bytes`);
  }
  const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  parseBoundedLosslessJson(source);
  return JSON.parse(source);
}

export function validateReviewedRoutePlan(value, schema) {
  const findings = validateAgainstSchema(value, schema).map((finding) => ({
    ...finding,
    remediation: "Make the plan match submissions/schema/reviewed-route-plan-v1.schema.json."
  }));
  const add = (code, field, message, remediation) => findings.push({
    severity: "blocker",
    code,
    path: field,
    message,
    remediation
  });

  if (findings.length > 0 || value === null || typeof value !== "object" || Array.isArray(value)) {
    return findings;
  }

  if (!isNormalizedRepositoryPath(value.artifact.path)) {
    add(
      "ROUTE_PLAN_ARTIFACT_PATH_INVALID",
      "$.artifact.path",
      "Reviewed plan artifact path is not a normalized repository-relative path.",
      "Use the exact slash-separated path inside the pinned source tree without dot segments or aliases."
    );
  }

  const addressEntries = [
    ["$.routeTarget.address", value.routeTarget.address],
    ...value.components.flatMap((component, index) => [
      [`$.components[${index}].address`, component.address],
      [`$.components[${index}].deployer`, component.deployer]
    ])
  ];
  for (const [field, address] of addressEntries) {
    const checksummed = checksumAddress(address, { label: field });
    if (checksummed !== address) {
      add(
        "ROUTE_PLAN_ADDRESS_NOT_CANONICAL",
        field,
        `Address must use its exact EIP-55 form ${checksummed}.`,
        "Use the checksummed address from the frozen reviewed plan."
      );
    }
  }

  const kinds = new Set();
  const addresses = new Set();
  for (let index = 0; index < value.components.length; index += 1) {
    const component = value.components[index];
    if (kinds.has(component.kind)) {
      add(
        "ROUTE_PLAN_COMPONENT_KIND_DUPLICATE",
        `$.components[${index}].kind`,
        `Component kind ${component.kind} is repeated.`,
        "Bind each material component kind exactly once."
      );
    }
    kinds.add(component.kind);
    const normalizedAddress = component.address.toLowerCase();
    if (addresses.has(normalizedAddress)) {
      add(
        "ROUTE_PLAN_COMPONENT_ADDRESS_DUPLICATE",
        `$.components[${index}].address`,
        `Component address ${component.address} is repeated.`,
        "Bind each material component address exactly once."
      );
    }
    addresses.add(normalizedAddress);
    if (component.address.toLowerCase() === value.routeTarget.address.toLowerCase()) {
      add(
        "ROUTE_PLAN_TARGET_IS_COMPONENT",
        `$.components[${index}].address`,
        "The route target cannot also be one of its child components.",
        "Keep the factory or GraphFactory target separate from the token, hook, and other child components."
      );
    }
    if (component.deployer.toLowerCase() !== value.routeTarget.address.toLowerCase()) {
      add(
        "ROUTE_PLAN_COMPONENT_DEPLOYER_MISMATCH",
        `$.components[${index}].deployer`,
        `Component ${component.kind} is not deployed by the declared route target.`,
        "Freeze the actual direct deployer topology; do not flatten a nested factory plan."
      );
    }
  }
  for (const requiredKind of ["token", "hook"]) {
    if (!kinds.has(requiredKind)) {
      add(
        "ROUTE_PLAN_CORE_COMPONENT_MISSING",
        "$.components",
        `Reviewed route plan is missing the ${requiredKind} component.`,
        "Include the exact token and hook child addresses and deployers."
      );
    }
  }
  if (value.routeTarget.role === "platform-graph-factory") {
    if (value.profile !== "direct-graph") {
      add(
        "DIRECT_GRAPH_PROFILE_MISMATCH",
        "$.profile",
        "A platform GraphFactory target must use the direct-graph profile.",
        "Classify the reviewed plan as direct-graph or supply the one exact Shards nested-factory profile."
      );
    }
    if (
      value.routeTarget.address !== PRODUCTION_GRAPH_FACTORY_ADDRESS
      || value.routeTarget.runtimeCodeHash !== PRODUCTION_GRAPH_FACTORY_RUNTIME_CODE_HASH
    ) {
      add(
        "DIRECT_GRAPH_TARGET_MISMATCH",
        "$.routeTarget",
        "Direct GraphFactory plans must bind the current production GraphFactory address and reviewed runtime code hash.",
        "Use the exact chain-1 production GraphFactory catalog binding and obtain a separate live dual-RPC currentness attestation before approval."
      );
    }
    for (const forbidden of [
      "reviewedRequest",
      "poolManager",
      "pool",
      "revenuePolicy",
      "factoryInterface",
      "artifactCode",
      "launchPlan"
    ]) {
      if (Object.hasOwn(value, forbidden)) {
        add(
          "DIRECT_GRAPH_SHARDS_BINDING_FORBIDDEN",
          `$.${forbidden}`,
          "Direct GraphFactory plans cannot carry a partial Shards nested-factory binding.",
          "Use a direct-graph plan without Shards-only fields."
        );
      }
    }
  } else if (!sameCanonicalJson(withoutSchema(value), EXACT_SHARDS_REVIEWED_PLAN_V1)) {
    add(
      "EXACT_SHARDS_NESTED_FACTORY_MISMATCH",
      "$",
      "Applicant-factory plans are supported only for the exact frozen Shards request, source, manifest, ABI, code hashes, PoolManager, and launch plan.",
      "Use the byte-exact Shards reviewed-route-plan example or keep the plan pending; no generic nested-factory profile exists."
    );
  }
  if (value.factoryInterface !== undefined) {
    const abiBytes = canonicalJsonBytesV2(value.factoryInterface.descriptor, { trailingNewline: false });
    const abiSha256 = `sha256:${crypto.createHash("sha256").update(abiBytes).digest("hex")}`;
    if (abiSha256 !== value.factoryInterface.abiSha256) {
      add(
        "ROUTE_PLAN_ABI_HASH_MISMATCH",
        "$.factoryInterface.abiSha256",
        "Factory ABI descriptor hash does not match its Canonical JSON V2 bytes.",
        "Recompute SHA-256 over the descriptor's Canonical JSON V2 UTF-8 bytes with no trailing newline."
      );
    }
  }
  if (value.revenuePolicy !== undefined) {
    try {
      const derived = deriveRevenuePolicyV1(value.revenuePolicy);
      const storedDerivation = {
        legTypeHash: value.revenuePolicy.legTypeHash,
        policyTypeHash: value.revenuePolicy.policyTypeHash,
        feeBasisHash: value.revenuePolicy.feeBasisHash,
        legs: value.revenuePolicy.legs.map((leg) => ({
          roleHash: leg.roleHash,
          recipientModeHash: leg.recipientModeHash,
          abiPreimage: leg.abiPreimage,
          legHash: leg.legHash
        })),
        legsAbiPreimage: value.revenuePolicy.legsAbiPreimage,
        legsHash: value.revenuePolicy.legsHash,
        policyAbiPreimage: value.revenuePolicy.policyAbiPreimage,
        revenuePolicyHash: value.revenuePolicy.revenuePolicyHash
      };
      if (!sameCanonicalJson(derived, storedDerivation)) {
        add(
          "ROUTE_PLAN_REVENUE_POLICY_HASH_MISMATCH",
          "$.revenuePolicy",
          "Decoded revenue economics do not reproduce the stored typed leg and policy hashes.",
          "Recompute the versioned typed revenue policy from its ordered roles, basis, bps, recipients, and recipient-mode labels."
        );
      }
      if (value.revenuePolicy.legs.reduce((sum, { feeBps }) => sum + feeBps, 0) !== value.revenuePolicy.totalFeeBps) {
        add(
          "ROUTE_PLAN_REVENUE_POLICY_NOT_CONSERVED",
          "$.revenuePolicy.legs",
          "Revenue leg bps do not sum to the total fee bps.",
          "Bind an exact conserved per-profile fee allocation; do not apply a universal platform-fee assumption."
        );
      }
    } catch (error) {
      add(
        "ROUTE_PLAN_REVENUE_POLICY_INVALID",
        "$.revenuePolicy",
        `Revenue policy typed preimage is invalid: ${error.message}`,
        "Use the exact published typed revenue-policy Golden for this profile."
      );
    }
  }
  return findings;
}

export function classifyReviewedRoutePlan(value) {
  if (
    value?.routeTarget?.role === "platform-graph-factory"
    && value.routeTarget.address === PRODUCTION_GRAPH_FACTORY_ADDRESS
    && value.routeTarget.runtimeCodeHash === PRODUCTION_GRAPH_FACTORY_RUNTIME_CODE_HASH
  ) return "direct-graph";
  if (
    value?.routeTarget?.role === "applicant-factory"
    && value?.profile === "exact-shards-nested-factory"
    && sameCanonicalJson(withoutSchema(value), EXACT_SHARDS_REVIEWED_PLAN_V1)
  ) return "exact-shards-nested-factory";
  throw new TypeError("reviewed route plan has no supported route-target role");
}

export function assessRouteCompatibility(requestedRoute, reviewedPlan) {
  const planClassification = classifyReviewedRoutePlan(reviewedPlan);
  const required = SUPPORTED_ROUTE_BINDINGS.find((binding) => (
    binding.supported === planClassification
  ));
  if (required === undefined) throw new TypeError("reviewed route plan classification is unsupported");

  const requested = SUPPORTED_ROUTE_BINDINGS.find((binding) => (
    binding.routeId === requestedRoute?.routeId
    && binding.routeVersion === requestedRoute?.routeVersion
    && binding.chainId === requestedRoute?.chainId
  ));
  const requestedRouteLabel = routeLabel(requestedRoute);
  const requiredRoute = Object.freeze({
    routeId: required.routeId,
    routeVersion: required.routeVersion,
    chainId: required.chainId
  });
  const capability = Object.freeze({
    catalogVersion: required.catalogVersion,
    profileId: required.profileId,
    profileVersion: required.profileVersion,
    planSchemaId: required.planSchemaId,
    profileSha256: required.profileSha256,
    profileKeyDomain: required.profileKeyDomain,
    profileKeyTypehash: required.profileKeyTypehash,
    profileIdHash: required.profileIdHash,
    profileVersionHash: required.profileVersionHash,
    profileKey: required.profileKey,
    revenuePolicyHash: required.revenuePolicyHash,
    revenuePolicySemantics: required.revenuePolicySemantics,
    routeTargetAddress: required.routeTargetAddress,
    routeTargetRuntimeCodeHash: required.routeTargetRuntimeCodeHash,
    factoryAddress: required.factoryAddress,
    factoryRuntimeCodeHash: required.factoryRuntimeCodeHash,
    currentnessAttestationRequired: required.currentnessAttestationRequired,
    activationState: required.activationState,
    platformAttestation: required.platformAttestation
  });
  if (requested === undefined) {
    return Object.freeze({
      status: "ROUTE_UNSUPPORTED",
      supported: null,
      planClassification,
      capabilityClassification: planClassification,
      requestedRoute: requestedRouteLabel,
      requiredRoute,
      capability,
      acceptanceRequired: false
    });
  }
  if (required.activationState !== "enabled") {
    return Object.freeze({
      status: "ROUTE_CAPABILITY_DISABLED",
      supported: null,
      planClassification,
      capabilityClassification: planClassification,
      requestedRoute: requestedRouteLabel,
      requiredRoute,
      capability,
      acceptanceRequired: requested.supported !== planClassification
    });
  }
  if (requested.supported !== planClassification) {
    return Object.freeze({
      status: "ROUTE_ACCEPTANCE_REQUIRED",
      supported: planClassification,
      planClassification,
      capabilityClassification: planClassification,
      requestedRoute: requestedRouteLabel,
      requiredRoute,
      capability,
      acceptanceRequired: true
    });
  }
  return Object.freeze({
    status: "ROUTE_SUPPORTED",
    supported: planClassification,
    planClassification,
    capabilityClassification: planClassification,
    requestedRoute: requestedRouteLabel,
    requiredRoute,
    capability,
    acceptanceRequired: false
  });
}

export function deriveNestedFactoryProfileKeyV1(profileId, profileVersion) {
  if (typeof profileId !== "string" || typeof profileVersion !== "string") {
    throw new TypeError("profile ID and version must be strings");
  }
  const profileIdHash = keccak256Hex(Buffer.from(profileId, "utf8"));
  const profileVersionHash = keccak256Hex(Buffer.from(profileVersion, "utf8"));
  const profileKey = keccak256Hex(Buffer.concat([
    Buffer.from(NESTED_FACTORY_PROFILE_KEY_TYPEHASH.slice(2), "hex"),
    Buffer.from(profileIdHash.slice(2), "hex"),
    Buffer.from(profileVersionHash.slice(2), "hex")
  ]));
  return Object.freeze({
    profileKeyDomain: NESTED_FACTORY_PROFILE_KEY_DOMAIN,
    profileKeyTypehash: NESTED_FACTORY_PROFILE_KEY_TYPEHASH,
    profileIdHash,
    profileVersionHash,
    profileKey
  });
}

export function deriveRevenuePolicyV1(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("revenue policy must be an object");
  }
  if (!Array.isArray(value.legs) || value.legs.length === 0) {
    throw new TypeError("revenue policy must contain at least one ordered leg");
  }
  const legTypeHash = keccak256Hex(Buffer.from(value.legType, "utf8"));
  const policyTypeHash = keccak256Hex(Buffer.from(value.policyType, "utf8"));
  const legs = value.legs.map((leg, index) => {
    const roleHash = keccak256Hex(Buffer.from(leg.roleLabel, "utf8"));
    const recipientModeHash = keccak256Hex(Buffer.from(leg.recipientModeLabel, "utf8"));
    const abiPreimage = Buffer.concat([
      evmBytes32Word(legTypeHash, `revenuePolicy.legs[${index}].legTypeHash`),
      evmBytes32Word(roleHash, `revenuePolicy.legs[${index}].roleHash`),
      evmUint16Word(leg.feeBps, `revenuePolicy.legs[${index}].feeBps`),
      evmAddressWord(leg.recipient, `revenuePolicy.legs[${index}].recipient`),
      evmBytes32Word(recipientModeHash, `revenuePolicy.legs[${index}].recipientModeHash`)
    ]);
    return Object.freeze({
      roleHash,
      recipientModeHash,
      abiPreimage: `0x${abiPreimage.toString("hex")}`,
      legHash: keccak256Hex(abiPreimage)
    });
  });
  const legsAbiPreimage = Buffer.concat(legs.map(({ legHash }, index) => (
    evmBytes32Word(legHash, `revenuePolicy.legs[${index}].legHash`)
  )));
  const legsHash = keccak256Hex(legsAbiPreimage);
  const policyAbiPreimage = Buffer.concat([
    evmBytes32Word(policyTypeHash, "revenuePolicy.policyTypeHash"),
    evmBytes32Word(value.profileKey, "revenuePolicy.profileKey"),
    evmAddressWord(value.feeAsset, "revenuePolicy.feeAsset", { allowZero: true }),
    evmBytes32Word(
      keccak256Hex(Buffer.from(value.feeBasisLabel, "utf8")),
      "revenuePolicy.feeBasisHash"
    ),
    evmUint16Word(value.totalFeeBps, "revenuePolicy.totalFeeBps"),
    evmBytes32Word(legsHash, "revenuePolicy.legsHash")
  ]);
  return deepFreeze({
    legTypeHash,
    policyTypeHash,
    feeBasisHash: keccak256Hex(Buffer.from(value.feeBasisLabel, "utf8")),
    legs,
    legsAbiPreimage: `0x${legsAbiPreimage.toString("hex")}`,
    legsHash,
    policyAbiPreimage: `0x${policyAbiPreimage.toString("hex")}`,
    revenuePolicyHash: keccak256Hex(policyAbiPreimage)
  });
}

export function validateExactShardsApplicantRequest(value, evidence) {
  if (value?.source?.repositoryId !== 1329073878) return [];
  const findings = [];
  const add = (code, field, message) => findings.push({
    severity: "blocker",
    code,
    path: field,
    message,
    remediation: "Use the exact merged Shards request or keep the candidate pending."
  });
  if (
    value.applicant?.githubLogin !== "jesse-stahl"
    || value.applicant?.launchWallet !== "0xceeBB3A6543CeBEB2ED66963897A0abEA52A50cC"
  ) add("EXACT_SHARDS_APPLICANT_MISMATCH", "$.applicant", "Shards applicant login or launch wallet differs from the merged request.");
  if (!sameCanonicalJson(value.source, EXACT_SHARDS_REVIEWED_PLAN_V1.source)) {
    add("EXACT_SHARDS_SOURCE_MISMATCH", "$.source", "Shards source repository, numeric ID, commit, or tree differs from the reviewed revision.");
  }
  if (
    evidence?.path !== EXACT_SHARDS_REVIEWED_PLAN_V1.reviewedRequest.path
    || evidence?.applicationManifest?.sha256 !== EXACT_SHARDS_REVIEWED_PLAN_V1.reviewedRequest.applicationManifestSha256
  ) add("EXACT_SHARDS_REQUEST_MANIFEST_MISMATCH", "$", "Shards request path or canonical applicationManifest digest differs from the merged review target.");
  if (
    value.requestedRoute?.routeId !== "custom-graph"
    || value.requestedRoute?.routeVersion !== "1.0.0"
    || value.requestedRoute?.chainId !== "1"
  ) add("EXACT_SHARDS_ORIGINAL_ROUTE_MISMATCH", "$.requestedRoute", "The merged Shards request must remain custom-graph@1.0.0 on chain 1.");
  return findings;
}

export function isExactShardsApplicantRequest(value, evidence) {
  return value?.source?.repositoryId === 1329073878
    && validateExactShardsApplicantRequest(value, evidence).length === 0;
}

export function validateReviewedRoutePlanRequestBinding(request, evidence, reviewedPlan) {
  const findings = [];
  const add = (code, field, message, remediation) => findings.push({
    severity: "blocker",
    code,
    path: field,
    message,
    remediation
  });
  if (!sameCanonicalJson(request?.source, reviewedPlan?.source)) {
    add(
      "ROUTE_PLAN_REQUEST_SOURCE_MISMATCH",
      "$.source",
      "Reviewed route plan source repository, numeric ID, commit, or tree differs from the applicant request.",
      "Generate the route plan only from the exact immutable source revision in the reviewed request."
    );
  }
  if (reviewedPlan?.reviewedRequest !== undefined && (
    reviewedPlan.reviewedRequest.path !== evidence?.path
    || reviewedPlan.reviewedRequest.applicationManifestSha256 !== evidence?.applicationManifest?.sha256
  )) {
    add(
      "ROUTE_PLAN_REQUEST_MANIFEST_MISMATCH",
      "$.reviewedRequest",
      "Reviewed route plan request path or applicationManifest digest differs from the applicant request.",
      "Bind the exact validated request path and Canonical JSON V2 applicationManifest digest."
    );
  }
  return findings;
}

export function isNormalizedRepositoryPath(value) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\\") || path.posix.isAbsolute(value)) {
    return false;
  }
  const normalized = path.posix.normalize(value);
  return normalized === value
    && normalized !== "."
    && normalized !== ".."
    && !normalized.startsWith("../")
    && !normalized.split("/").some((segment) => segment === "." || segment === "..");
}

function routeLabel(route) {
  if (
    route === null
    || typeof route !== "object"
    || Array.isArray(route)
    || typeof route.routeId !== "string"
    || typeof route.routeVersion !== "string"
    || typeof route.chainId !== "string"
  ) return null;
  return `${route.routeId}@${route.routeVersion}:chain-${route.chainId}`;
}

function withoutSchema(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  const { $schema: _schema, ...rest } = value;
  return rest;
}

function sameCanonicalJson(left, right) {
  try {
    return canonicalJsonBytesV2(left, { trailingNewline: false })
      .equals(canonicalJsonBytesV2(right, { trailingNewline: false }));
  } catch {
    return false;
  }
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

function evmBytes32Word(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/u.test(value)) {
    throw new TypeError(`${label} must be a lowercase bytes32 value`);
  }
  return Buffer.from(value.slice(2), "hex");
}

function evmAddressWord(value, label, { allowZero = false } = {}) {
  const address = checksumAddress(value, { allowZero, label });
  return Buffer.from(address.slice(2).padStart(64, "0"), "hex");
}

function evmUint16Word(value, label) {
  if (!Number.isInteger(value) || value < 0 || value > 65_535) {
    throw new TypeError(`${label} must be an unsigned 16-bit integer`);
  }
  return Buffer.from(value.toString(16).padStart(64, "0"), "hex");
}
