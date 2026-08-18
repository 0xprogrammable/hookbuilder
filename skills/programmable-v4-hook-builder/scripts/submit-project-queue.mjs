import path from "node:path";

import { CliFailure } from "./cli-runtime.mjs";
import { preflightProtectedUniversalAdmissionContract } from "./universal-admission-contract-github.mjs";
import {
  UNIVERSAL_ADMISSION_INERT_AUTHORITY,
  universalAdmissionQueueStatus
} from "./universal-admission-contract-core.mjs";

const WORKSPACE_FILE = "applicant-workspace.v1.json";
const TRANSPORTS = new Set(["auto", "queue", "github-draft"]);

export const SUBMIT_PROJECT_TRANSPORT_OPTION = Object.freeze({
  name: "--transport",
  key: "transport",
  type: "value",
  valueName: "auto|queue|github-draft",
  description: "Select transport explicitly. The default auto mode remains the existing GitHub Draft V3.1 adapter."
});

export function normalizeSubmitProjectTransport(value) {
  const selected = value ?? "auto";
  if (!TRANSPORTS.has(selected)) {
    throw new CliFailure("USAGE_ERROR", "--transport must be auto, queue, or github-draft", { exitCode: 2 });
  }
  return selected;
}

export async function runSubmitProjectQueuePreflight({
  contractPreflight = preflightProtectedUniversalAdmissionContract,
  repositoryRoot,
  source,
  validation,
  verbose,
  workspace
}) {
  const contract = await contractPreflight({ repositoryRoot, source });
  if (contract?.ok !== true) {
    return unavailable({
      code: contract?.code ?? "UNIVERSAL_ADMISSION_CONTRACT_UNAVAILABLE",
      contract: null,
      repair: contract?.repair ?? "Retry only after the exact protected contract can be verified.",
      repositoryRoot,
      source,
      summary: contract?.summary ?? "The exact protected Universal Admission contract is unavailable.",
      validation,
      verbose,
      workspace
    });
  }
  return unavailable({
    code: "QUEUE_TRANSPORT_DISABLED",
    contract,
    repair: "Wait for a separately reviewed enabled contract and compatible Builder. Select --transport github-draft explicitly only if that low-volume adapter is intended; no fallback is automatic.",
    repositoryRoot,
    source,
    summary: "The protected Universal Admission queue is a disabled reference surface, not a live Applicant transport.",
    validation,
    verbose,
    workspace
  });
}

function unavailable({ code, contract, repair, repositoryRoot, source, summary, validation, verbose, workspace }) {
  const queue = contract === null ? unverifiedQueueStatus() : universalAdmissionQueueStatus(contract.binding);
  const safeNextCommand = queueCommand(repositoryRoot, workspace);
  const diagnostic = {
    code,
    causeClass: "INTEGRATION",
    summary,
    repair,
    safeNextCommand,
    writePerformed: false
  };
  const result = {
    state: "INTEGRATION_PENDING",
    diagnostics: [diagnostic],
    writePerformed: false,
    safeNextCommand,
    workspace: {
      root: workspace,
      stateFile: path.join(workspace, WORKSPACE_FILE),
      statePersisted: false,
      sourceCommit: source.headCommit,
      sourceTree: source.tree,
      confirmationDigest: null,
      pullRequest: null
    },
    transport: {
      requested: "queue",
      selected: "queue",
      status: code === "QUEUE_TRANSPORT_DISABLED" ? "DISABLED" : "UNAVAILABLE",
      queueUsable: false,
      fallbackPerformed: false,
      planCreated: false,
      contract: queue.contract
    },
    queueUsable: false,
    queue,
    authority: UNIVERSAL_ADMISSION_INERT_AUTHORITY
  };
  if (verbose) result.details = {
    contractBinding: contract?.binding ?? null,
    submissionValidation: validation
  };
  return { exitCode: 1, result };
}

function unverifiedQueueStatus() {
  return {
    transport: "authenticated-admission-queue-v1",
    operation: "enqueue",
    queueUsable: false,
    deploymentState: "unverified",
    endpoint: null,
    audience: null,
    trustSnapshot: null,
    contract: null,
    applicationV3: {
      contractId: "public-pr-application-v3.1",
      bytesMutated: false,
      admissionEnvelopeMaterialized: false,
      admissionBinding: null
    },
    effects: {
      confirmationRequested: false,
      candidateCodeExecuted: false,
      externalWriteAttempted: false,
      networkMutationAttempted: false,
      fallbackAttempted: false
    },
    authority: UNIVERSAL_ADMISSION_INERT_AUTHORITY
  };
}

function queueCommand(repositoryRoot, workspace) {
  return [
    "node", "\"$BUILDER_CLI\"", "submit-project", shellQuote(repositoryRoot),
    "--workspace-root", shellQuote(workspace), "--transport", "queue"
  ].join(" ");
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}
