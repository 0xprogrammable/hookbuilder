# Get started

Programmable v4 Builder turns a plain-language product idea or an existing repository into a complete project that can
be reviewed. You describe the outcome. The agent derives protocol details, repository structure and test coverage.

You do not need the Builder to use Submit a Launch. If you build independently, follow the same
[public requirements](https://github.com/0xprogrammable/submit-launch/blob/main/docs/COMPLETE_LAUNCH_REQUIREMENTS.md)
and application contract.

## Before you begin

You need:

- a coding agent that can load the complete Programmable v4 Builder Skill;
- Node.js 22 or newer for the portable commands; and
- a Git repository for the project.

The repository may stay local while you design and build. Submit a Launch requires exact public GitHub source when you
prepare the review Draft.

Never put a private key, seed phrase, wallet file, API token or private RPC URL in the prompt or project package.

## Start from an idea

Give your agent one request:

```text
Use the Programmable v4 Builder skill. Preserve this idea, ask me only about choices that would materially change the product, then design, build and check the complete project: <idea>
```

The idea can include a hook, token, app, game, service, indexer, custom market, several repositories or none of those.
The Builder does not force it into a starter template.

## Start from an existing repository

Use this request instead:

```text
Use the Programmable v4 Builder skill. Inspect this project without replacing working architecture, recover its intent, repair concrete gaps and prepare the exact revision for review: <public GitHub URL or local repository>
```

The agent should preserve unrelated work and ask before changing economics, custody, authority, trust, failure behavior,
exit rights or another material product decision.

## What happens next

The agent follows one path:

1. Preserve the idea and identify the product surfaces that actually exist.
2. Resolve the current Submit a Launch contract and use only the requirements for the current stage and route.
3. Choose the smallest architecture that preserves the intended behavior.
4. Build the complete project and run the checks available in the current environment.
5. Record missing evidence or integrations without inventing a pass.
6. Freeze the exact public source and prepare one review Draft when the project is ready.

Templates and capability packs may reduce repeated work. They are not an allowlist. A missing template, unusual design or
unknown capability remains eligible for custom architecture and review.

## How route choices affect requirements

| Project state | What the Builder does |
| --- | --- |
| No market | Builds the real product without inventing a market, fee route or launch stamp. |
| External route | Keeps the project eligible and avoids a false Programmable launch label. |
| Route unresolved | Continues honest design and source work while route-dependent readiness stays pending. |
| Official Programmable Ethereum route | Uses the current application contract and applies the returned launch-readiness plan. |
| Unsupported future contract or handler | Pauses only the affected stage as `INTEGRATION_PENDING`. |

The Builder reads current values from Submit a Launch. It does not rely on a remembered checklist in its own
documentation.

## Submit the completed project

From the completed public repository, run:

```bash
node "$SKILL_ROOT/scripts/cli.mjs" submit-project "$REPOSITORY_ROOT"
```

This is the normal submission command. It checks the exact repository, resolves the current accepted application
contract and returns either one repair or one safe next action. Run the same command again for status.

Common states are:

| State | Meaning |
| --- | --- |
| `NEEDS_PROJECT_PACKAGE` | The project or its review package is incomplete. Complete the named input, then retry. |
| `INTEGRATION_PENDING` | A current policy, compatibility or external integration cannot be used yet. The result names the affected stage. |
| `READY_FOR_CONFIRMATION` | The read-only Draft plan is complete. Review its exact confirmation digest before authorizing the GitHub write. |
| `CHECKS_RUNNING` | The Draft exists and protected checks are still running. |
| `REVIEW_REQUIRED` | The Draft is waiting for independent review. |
| `CHANGES_REQUESTED` | The exact submitted revision needs the named repair. |

The first plan performs no GitHub write. A later command may create or update one Draft only after the owner authorizes
its freshly computed digest. A changed source revision or Submit a Launch contract invalidates the old plan.

## Current and legacy applications

The current official-route path uses Application V3.2 with Submission 2.1. The Builder discovers this through the
protected compatibility manifest rather than a copied local checklist.

Existing V3.1 drafts remain valid under their original contract. They cannot establish the official Programmable route
or launch readiness. Continue one by creating a new V3.2 revision linked to the prior application; never rewrite the old
bytes or report history.

Read [Application compatibility and migration](../skills/programmable-v4-hook-builder/references/application-compatibility-and-migration.md)
for the exact boundary.

## What submission does not do

Opening a Draft does not review, approve, audit, deploy, sign, route, register, promote or launch the project. Those are
separate actions with separate evidence and authority.

Local checks also do not prove provider support, liquidity, tradability or public availability. The final handoff should
state what was created, what ran, what remains unverified and the exact next owner action.
