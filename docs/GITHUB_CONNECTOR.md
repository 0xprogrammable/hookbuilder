# GitHub connection boundary

The portable Skill remains the operating and knowledge layer. The bundled local MCP server is a thin, deterministic
adapter over the same Builder CLI; it does not carry a second policy implementation.

## What is bundled

The repo-local `.mcp.json` starts `mcp/server.mjs` over stdio for Codex and other local MCP hosts. It exposes:

- read-only tooling and repository readiness;
- live or explicitly labeled offline Registry discovery;
- local Application V3 validation;
- read-only GitHub application status;
- a read-only submit/update plan; and
- GET-only reconciliation of a crash-safe mutation receipt after interruption; and
- one separately annotated write tool that accepts only the exact freshly recomputed `sha256:` confirmation digest.

The write tool can create the bounded GitHub transport described by Application V3. It cannot approve, merge, mark
ready, accept, deploy, launch, sign a wallet transaction, or move funds. Candidate repositories are data and are never
executed by the connector.

## Two-phase external writes

1. Call `programmable_application_plan`.
2. Present the complete result and its confirmation digest to the owner.
3. Only after the owner accepts that exact plan, call `programmable_application_execute` with the same digest and
   `acknowledgeExternalWrite: true`, plus a new absolute `mutationReceiptPath` outside the application package.
4. If Registry intake state, source bytes, GitHub state, identity, or the plan changes, the digest changes and execution
   fails closed.
5. After interruption, call `programmable_application_reconcile` first. Resume only through the destructive tool with
   the original digest, the same receipt path, and `resume: true`; ambiguous mutation outcomes remain blocked.

The MCP host should show its own destructive-action confirmation as an additional control. Tool annotations are not a
substitute for the Builder's digest check.

## Host boundary

The bundled server is a local stdio adapter. It is not a deployed ChatGPT connector and does not prove that any managed
workspace has installed, authenticated, or approved it. A hosted connector must reuse the same versioned contracts,
serve Streamable HTTP with OAuth, keep GitHub tokens outside model-visible output, enforce tenant-scoped quotas and
audit logs, and pass the same shared corpus before it can be marked available.

GitHub remains the application source of truth. A future hosted transport may make GitHub easier to reach, but it must
not create a second application database or acceptance authority.
