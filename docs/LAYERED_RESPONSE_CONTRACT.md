# Layered responses and deterministic forward tests

The Builder serves people who may not know protocol vocabulary while producing evidence detailed enough for independent
review. It therefore renders one result in two layers.

## Builder-facing layer

The visible response leads with the outcome, gives the current state, asks at most one material owner decision, states
what the agent will do next, and links the detailed artifacts. Ordinary derived technical work stays out of the
question. A German-speaking novice should receive the same semantic contract in German rather than an English schema
exercise.

When several product choices remain, only the first dependency-changing question is shown. Later choices are recorded
in the artifact as deferred decisions. This prevents an intake questionnaire from replacing useful autonomous work.

The visible response is non-certifying. It distinguishes design, local checking, maintainer review, acceptance,
deployment, runtime verification, provider support, and public availability. It never promotes one state into another.

## Evidence layer

The evidence artifact carries the detail omitted from the visible response:

- source-preserving intent facts and their confirmation state;
- defaults and deferred owner choices;
- repository, component, authority, value, custody, service, and data boundaries;
- findings with effect and smallest repair;
- recorded, missing, and not-run evidence;
- independent gate and status lanes; and
- design-only reviewer and operations requirements.

The canonical skill reference is
`skills/programmable-v4-hook-builder/references/layered-response-contract.md`; the closed machine shape is
`skills/programmable-v4-hook-builder/references/layered-response-v1.schema.json`.

## Deterministic forward-test boundary

`evals/forward-tests/` contains synthetic fixtures, not model output. Each fixture supplies a realistic input, an
expected route/fee/conflict/state contract, and a candidate layered result. The local validator checks:

- no more than one material decision;
- two or three options and exactly one recommended option;
- concise visible fields with no hidden questionnaire;
- every non-certifying limitation that remains true for the independent current states;
- detailed facts, findings, evidence, gates, and state histories in the artifact;
- no invented fee scope for a zero-scope service;
- no rejection merely because a capability is unfamiliar;
- a concrete hard predicate plus preserved outcome for safe redesign; and
- no claim that the proposed queue, RBAC, audit, privacy, incident, or monitoring model is live.

The validator uses no model provider, credential, network request, or generated result. Its green state is
`EVAL_STRUCTURE_VALID`, not a model-quality result, security review, approval, deployment, or availability proof.

## State example

An application may legitimately be:

- design `DESIGN_READY`;
- implementation `STRUCTURALLY_COMPLETE`;
- application `APPLIED_WAITING_REVIEW`;
- runtime `NOT_DEPLOYED`; and
- availability `NOT_AVAILABLE`.

That combination is not contradictory. It is more accurate than one overloaded “done” flag.
