# Portability and lifecycle

This document states what the portable package can prove today. A compatible directory layout, a copied installation,
and a real host invocation are different evidence levels.

## Support vocabulary

- **Format validated**: the package passes the local Agent Skills or plugin shape validator.
- **Placement tested**: a clean installer copied the complete skill to the host's expected directory and the installed
  package verifier passed.
- **Host exercised**: the named host actually selected and ran the skill for a bounded scenario.
- **Behavior evidenced**: a versioned receipt records the host/model, operating system, prompt, result, and applicable
  checks.

Do not turn format or placement evidence into a host-exercised or behavior-evidenced claim.

## Host matrix for the v0.5.1 candidate

| Host | Package path | Current evidence | Current claim |
| --- | --- | --- | --- |
| Codex | Agent Skill through `gh skill`; generated Codex plugin payload plus repository marketplace | Manifest/payload validation, MCP protocol tests, and clean skill placement are covered locally | Package-compatible; plugin-cache startup and host behavior are unverified |
| Claude Code | Agent Skill through `gh skill`; generated marketplace isolated to the canonical Skill subtree | Manifest generation and clean skill placement are covered locally; the marketplace source cannot include the root Codex MCP companion | Skill/CLI package-compatible; MCP and host behavior are unverified |
| GitHub Copilot | Agent Skill through `gh skill` | Clean skill placement is covered locally | Package-compatible; host behavior is unverified |
| Cursor | Agent Skill through `gh skill` | Recognized installer destination; not included in the release-candidate placement canary | Experimental until a versioned placement and invocation receipt exists |
| ChatGPT | Skill upload through the ChatGPT Plugins Skills UI | No candidate upload, scan, Node runtime, or invocation receipt exists | Unverified; do not advertise operational support |

The release rehearsal installs to Codex, Claude Code, and GitHub Copilot directories and runs the package's own
installed verifier. It does not launch those hosts. The local MCP transport is declared only by the Codex manifest;
the Claude marketplace uses the canonical Skill subtree as its complete `strict: false` definition and therefore does
not package the root `.mcp.json`. MCP protocol tests do not prove that an installed Codex cache starts it. Cursor and
ChatGPT are not part of that rehearsal.

## Operating-system and tool matrix

| Capability | Node.js | Git | `gh` | Network | macOS | Linux | Windows |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Intent, routing, templates | 20+ | No | No | No | Locally exercised | CI target; current candidate receipt pending | Not exercised |
| Local package validation | 20+ | Only for repository-bound checks | No | No | Locally exercised | CI target on Node 20/22; current candidate receipt pending | Not exercised |
| Bundled Registry snapshot | 20+ | No | No | No | Locally exercised | Declared compatible; current candidate receipt pending | Not exercised |
| Live Registry discovery | 20+ | No | No | Yes | Locally exercised only where explicitly run | Declared compatible; current candidate receipt pending | Not exercised |
| Application V3 exact revision | 20+ | 2.49+ with `git backfill --sparse` | No | Yes | Declared supported when doctor gates pass | Declared supported when doctor gates pass | Unsupported; fails closed |
| GitHub status | 20+ | Depends on selected status path | Usually yes | Yes | Declared supported when doctor gates pass | Declared supported when doctor gates pass | Not supported for exact-revision flow |
| GitHub submit/update | 20+ | 2.49+ with `git backfill --sparse` | Authenticated | Yes | Declared supported after explicit authorization | Declared supported after explicit authorization | Unsupported for exact-revision flow |

Without `--repository-root`, `doctor` resolves the canonical installed plugin root when the Codex wrapper is present and
otherwise the canonical installed Skill root. A non-Git plugin cache remains a valid package context: Git-worktree-only
checks are reported as unavailable instead of making the doctor fail. Pass an explicit project root before project or
Application V3 work. The report includes the current platform, Node major, exact-object Git version/capability, offline
capability boundary, and separate Application V3 preparation/submission readiness. A positive doctor result is local
capability evidence only; it proves no authentication, public reachability, acceptance, deployment, or provider support.

The repository config targets Ubuntu on Node 20 and 22, but configured CI is not a receipt for this unpublished
candidate commit. Windows has neither a configured CI job nor a host receipt; do not advertise Windows support.

## Install a pinned Agent Skill

Preview the immutable public release before installation:

```bash
gh skill preview 0xprogrammable/hookbuilder \
  programmable-v4-hook-builder@v0.4.0
```

Install it for one host and scope:

```bash
gh skill install 0xprogrammable/hookbuilder \
  skills/programmable-v4-hook-builder \
  --agent codex \
  --scope user \
  --pin v0.4.0
```

Replace `codex` only with a destination listed by `gh skill install --help`. A destination name proves placement support,
not host behavior. Verify the installed directory from inside that directory:

```bash
node scripts/verify-skill.mjs --installed
```

## Check, update, unpin, and roll back a skill

Check without changing files:

```bash
gh skill update programmable-v4-hook-builder --dry-run
```

Pinned skills are intentionally skipped. To leave a pin and enter the interactive update flow, first preview the target
release, then run:

```bash
gh skill update programmable-v4-hook-builder --unpin
```

Re-run the installed verifier after every update. For a rollback, preview the older immutable tag and reinstall that
exact tag for the same host/scope with `--force`. `--force` overwrites tracked skill files but does not remove unrelated
extra files; use a clean destination when exact tree identity matters.

The preview `gh skill` surface currently has no uninstall command. Resolve and inspect the exact host-specific skill
directory, then remove only `programmable-v4-hook-builder` using the host's documented UI or file-management flow. Never
delete a broad skills directory.

## Install and remove the Codex plugin wrapper

The repository-local Codex marketplace is `.agents/plugins/marketplace.json`; its marketplace name is `programmable`.
Its source is the generated `plugins/programmable-v4-builder` payload, not the repository root. This follows the
portable `./plugins/<name>` marketplace layout. `npm run plugin:write` rebuilds that payload from the canonical skill,
`.mcp.json`, MCP implementation, and generated Codex manifest; `npm run plugin:check` rejects any inventory, hash, or
byte drift. For an authorized local development installation:

```bash
codex plugin marketplace add /absolute/path/to/programmable-v4-builder
codex plugin add programmable-v4-builder@programmable
```

For a public Git source, add the exact released tag rather than a mutable candidate branch. Refresh a configured Git
marketplace and reinstall the plugin only after its manifest version changes:

```bash
codex plugin marketplace upgrade programmable
codex plugin add programmable-v4-builder@programmable
```

To roll back, remove this plugin, repoint the marketplace to the previously reviewed immutable tag, and reinstall it.
Removing and re-adding the marketplace is appropriate only when no other installed plugin depends on that marketplace;
otherwise use a separately reviewed marketplace snapshot. Re-run the plugin validator and `doctor` after rollback.
The unpublished v0.5.1 candidate has no verified published plugin-wrapper predecessor, so the sequence below is a
procedure, not a currently executable rollback promise. Substitute a tag only after confirming that it contains the
Codex marketplace and payload.

```bash
codex plugin remove programmable-v4-builder@programmable
codex plugin marketplace remove programmable
codex plugin marketplace add 0xprogrammable/hookbuilder --ref PREVIOUS_REVIEWED_PLUGIN_TAG
codex plugin add programmable-v4-builder@programmable
```

Remove the plugin without deleting source files:

```bash
codex plugin remove programmable-v4-builder@programmable
```

Remove the marketplace separately only when no other installed plugin depends on it:

```bash
codex plugin marketplace remove programmable
```

Plugin installation changes local Codex configuration. It does not publish the plugin or grant wallet, deployment,
GitHub-write, or external-account authority. Until a versioned cache-install and host-start receipt exists, describe the
Codex MCP surface as packaged and protocol-tested, not host-exercised.

## Release evidence

Before a host support claim, record the exact release/tag, skill tree, host and version, model/provider, operating system,
installation path, prompt, selected mode, tool availability, offline/live state, result, and checks. Structural evals and
package validators are not substitutes for an authorized host-native run.
