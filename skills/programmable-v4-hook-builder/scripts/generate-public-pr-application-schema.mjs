#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const applicationSchemaPath = path.resolve(
  scriptDirectory,
  "../references/public-pr-application.schema.json"
);

const localId = { type: "string", pattern: "^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$" };
const kind = { type: "string", pattern: "^[A-Za-z][A-Za-z0-9]*(?:[._:@/+~-][A-Za-z0-9]+)*$" };
const plainText = (minimum, maximum) => ({ type: "string", minLength: minimum, maxLength: maximum });

export function generatePublicApplicationSchema() {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://schemas.programmable.family/autonomous-approval/v1/application-manifest.schema.json",
    title: "Programmable autonomous application manifest",
    description: "Inert builder-declared source and capability hints. The autonomous admission service independently resolves and approves exact revisions.",
    type: "object",
    additionalProperties: false,
    required: [
      "applicationId",
      "applicationRevision",
      "capabilityHints",
      "chainProfileRequests",
      "components",
      "githubSources",
      "primarySourceId",
      "project",
      "schemaVersion"
    ],
    properties: {
      schemaVersion: { const: "1.0.0" },
      applicationId: { type: "string", pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$", maxLength: 80 },
      applicationRevision: { type: "integer", minimum: 1, maximum: 1_000_000 },
      project: {
        type: "object",
        additionalProperties: false,
        required: ["summary", "title"],
        properties: {
          title: plainText(3, 120),
          summary: plainText(20, 4_000)
        }
      },
      primarySourceId: localId,
      githubSources: {
        type: "array",
        minItems: 1,
        maxItems: 16,
        items: { $ref: "#/$defs/githubSourceHint" }
      },
      chainProfileRequests: {
        type: "array",
        maxItems: 32,
        items: { $ref: "#/$defs/chainRequest" }
      },
      components: {
        type: "array",
        minItems: 1,
        maxItems: 256,
        items: { $ref: "#/$defs/component" }
      },
      capabilityHints: {
        type: "array",
        minItems: 1,
        maxItems: 256,
        items: { $ref: "#/$defs/capability" }
      }
    },
    $defs: {
      repositoryPath: {
        type: "string",
        minLength: 1,
        maxLength: 256,
        pattern: "^(?:\\.|(?!/)(?!.*(?:^|/)\\.{1,2}(?:/|$))(?!.*//)(?!.*\\\\).+)$"
      },
      rightsDeclaration: {
        type: "object",
        additionalProperties: false,
        required: ["authorizationGrantId", "basis", "licenseBindings"],
        properties: {
          basis: { enum: ["applicant-original", "spdx-license", "controller-authorization"] },
          authorizationGrantId: { anyOf: [localId, { type: "null" }] },
          licenseBindings: {
            type: "array",
            maxItems: 16,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["licensePath", "pathRoots", "spdxId"],
              properties: {
                spdxId: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9.+-]{1,79}$" },
                licensePath: { $ref: "#/$defs/repositoryPath" },
                pathRoots: {
                  type: "array",
                  minItems: 1,
                  maxItems: 32,
                  uniqueItems: true,
                  items: { $ref: "#/$defs/repositoryPath" }
                }
              }
            }
          }
        }
      },
      githubSourceHint: {
        type: "object",
        additionalProperties: false,
        required: [
          "executionRoots", "ownerHint", "purposeHint", "repositoryHint", "repositoryIdHint",
          "requestedRevisionHint", "rightsDeclaration", "sourceId", "visibilityHint"
        ],
        properties: {
          sourceId: localId,
          ownerHint: { type: "string", minLength: 1, maxLength: 39 },
          repositoryHint: { type: "string", minLength: 1, maxLength: 100 },
          repositoryIdHint: { type: "string", pattern: "^[1-9][0-9]{0,63}$" },
          requestedRevisionHint: { type: "string", pattern: "^(?:[0-9a-f]{40}|[0-9a-f]{64})$" },
          visibilityHint: { const: "public" },
          purposeHint: kind,
          executionRoots: {
            type: "array",
            minItems: 1,
            maxItems: 32,
            uniqueItems: true,
            items: { $ref: "#/$defs/repositoryPath" }
          },
          rightsDeclaration: { $ref: "#/$defs/rightsDeclaration" }
        }
      },
      chainRequest: {
        type: "object",
        additionalProperties: false,
        required: ["namespaceHint", "profileHint", "referenceHint", "requestId"],
        properties: {
          requestId: localId,
          namespaceHint: plainText(1, 64),
          referenceHint: plainText(1, 128),
          profileHint: kind
        }
      },
      component: {
        type: "object",
        additionalProperties: false,
        required: ["chainRequestIds", "componentId", "kindHint", "reviewRelevanceHint", "sourceIds", "summary", "visibilityHint"],
        properties: {
          componentId: localId,
          kindHint: kind,
          summary: plainText(1, 4_000),
          sourceIds: { type: "array", maxItems: 16, uniqueItems: true, items: localId },
          chainRequestIds: { type: "array", maxItems: 32, uniqueItems: true, items: localId },
          visibilityHint: { enum: ["public-source", "private-source", "external-service", "opaque", "not-applicable"] },
          reviewRelevanceHint: { enum: ["value-or-authority", "noncritical", "unknown"] }
        }
      },
      capability: {
        type: "object",
        additionalProperties: false,
        required: ["capabilityId", "chainRequestIds", "componentIds", "controlsUserValueHint", "kindHint", "movesUserValueHint", "summary"],
        properties: {
          capabilityId: localId,
          kindHint: kind,
          summary: plainText(1, 4_000),
          componentIds: { type: "array", maxItems: 256, uniqueItems: true, items: localId },
          chainRequestIds: { type: "array", maxItems: 32, uniqueItems: true, items: localId },
          movesUserValueHint: { type: ["boolean", "null"] },
          controlsUserValueHint: { type: ["boolean", "null"] }
        }
      }
    }
  };
}

export function serializePublicApplicationSchema(schema) {
  return `${JSON.stringify(schema, null, 2)}\n`;
}

function main() {
  const argument = process.argv[2] ?? "--check";
  if (!["--check", "--write"].includes(argument) || process.argv.length > 3) {
    process.stderr.write("Usage: node generate-public-pr-application-schema.mjs [--check|--write]\n");
    process.exitCode = 2;
    return;
  }
  const generatedBytes = serializePublicApplicationSchema(generatePublicApplicationSchema());
  if (argument === "--write") {
    fs.writeFileSync(applicationSchemaPath, generatedBytes);
    process.stdout.write(`${path.relative(process.cwd(), applicationSchemaPath)} updated\n`);
    return;
  }
  if (fs.readFileSync(applicationSchemaPath, "utf8") !== generatedBytes) {
    process.stderr.write("public-pr-application.schema.json is stale; run the generator with --write.\n");
    process.exitCode = 1;
    return;
  }
  process.stdout.write("public-pr-application.schema.json is self-contained and current\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
