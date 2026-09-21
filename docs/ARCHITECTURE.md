# Architecture

model-switch is moving toward a local reflex layer around Codex tool use.

The architecture follows one rule:

> Deterministic facts belong to code. Ambiguous judgments may go to Jev. Expensive investigation stays with Codex.

## Layers

### L0 - facts

Tracks deterministic observations such as:

- repository root
- current branch
- HEAD
- dirty/clean state
- last known build result
- last known test result
- last known deployment revision
- timestamps
- workspace generation

Facts carry provenance and validity metadata.

### L1 - judgment

TypeSafe Jev receives small bounded state and answers questions such as:

- reuse or refresh?
- enough evidence or not?
- repeated check or materially new check?
- safe to skip a redundant verification?

Expected answer shape:

```json
{
  "decision": "reuse",
  "confidence": 0.96
}
```

Low confidence, timeout, schema failure, or missing evidence means: run the original Codex tool call.

### L2 - execution

Codex keeps doing the expensive work:

- investigate
- inspect new state
- edit
- test
- build
- deploy
- reason across files and systems

model-switch should reduce redundant orientation work, not replace Codex.

## Hook lifecycle

Phase 1, the Phase 2 shadow layer, and the narrow Phase 3 reuse pilot implement
the `PreToolUse` and `PostToolUse` points below for Bash in Codex CLI. The layer
records metadata, maintains local evidence and generations, and rewrites only
three exact deterministic Git queries. Every other operation remains unchanged.

Codex Desktop currently sends shell work through a specialized
`custom_tool_call: exec` route that does not traverse this lifecycle hook path.
Accordingly, CLI is the supported measurement environment for reliable reflex
telemetry at this stage.

### PreToolUse

Intended responsibilities:

1. classify the pending call and conservatively decompose safe semicolon-only
   compounds
2. check whether exact same-session, same-generation evidence already answers it
3. emit a deterministic shadow decision
4. optionally ask Jev one bounded sufficiency question for related evidence
5. for three exact deterministic Git facts only, return `permissionDecision:
   "allow"` with `updatedInput.command` that emits validated evidence
6. otherwise allow the original tool call unchanged

Initial eligible surface should be tiny and read-only.

### PostToolUse

Intended responsibilities:

1. observe successful eligible simple checks
2. normalize safe scalar results or fingerprint other outputs
3. update provenance, timestamps, workspace identity, and session
4. advance workspace generation after every operation not proven read-only
5. collect metrics about repeated checks and shadow decisions

### UserPromptSubmit

Initial reversible optimization.

Current behavior:

- select only valid same-session, same-workspace, same-generation repo root,
  branch, and HEAD facts
- apply a short age bound in addition to generation checks
- emit the documented `hookSpecificOutput.additionalContext` response in
  `inject` mode
- compute the same candidate without changing context in `observe` mode
- omit the hint entirely on missing, stale, mismatched, or malformed evidence

Prompt text, transcripts, file contents, commands, logs, and evidence-store
dumps are never included. Selection is deterministic; Jev is not in this path.

## Evidence model

Example:

```json
{
  "kind": "git.status",
  "value": "clean",
  "source": {
    "tool": "Bash",
    "command": "git status --short"
  },
  "observedAt": "2026-09-21T10:42:17Z",
  "workspaceGeneration": 41,
  "repo": {
    "root": "C:/projects/model-switch",
    "head": "8c41de2"
  }
}
```

## Workspace generation

Time-to-live alone is unsafe. The current state is persisted in the ignored
`.model-switch/reflex-state.json` file and bounded to 500 evidence records.

A clean status observed 5 seconds ago is stale if Codex edited a file 1 second ago.

model-switch should maintain a monotonically increasing `workspaceGeneration`.

Potentially mutating operations increment the generation.

Evidence is reusable only when its validity conditions still hold for the current generation.

Some external facts may also need their own generations or revision identifiers, for example deployments.

## Eligibility

The first implementation should recognize only an allowlist of obvious read-only checks.

Examples:

- `pwd`
- `git rev-parse --show-toplevel`
- `git branch --show-current`
- `git rev-parse HEAD`
- selected `git status` forms
- selected read-only comparisons once semantics are well understood

Unknown, redirected, piped, variable/subshell-driven, conditional, or potentially
mutating shell commands pass through untouched and are not eligible. Simple
semicolon-only compounds are decomposed only when their shell structure is
unambiguous; internal operations are observed independently, while their combined
output is not persisted as evidence. The allowlist covers explicit Git queries,
filesystem reads/searches/metadata, runtime/package inspection, and bounded
read-only queries for external CLIs used by this project.

## Jev gate

Jev does not receive a whole transcript. The current shadow integration sends
only requested/prior evidence kinds, command family, evidence age, and the fact
that both observations share a workspace generation. It uses a conservative
confidence threshold, short timeout, no retries, and returns `uncertain` on any
failure. Its answer is recorded but never applied to the tool call.

## Deterministic reuse pilot

Applied reuse is restricted to exact simple commands for HEAD, current branch,
and repository root. Evidence must match session, workspace/repository identity,
exact normalized command hash, and `workspaceGeneration`; scalar values are
validated again before use. Compounds are never rewritten.

The project hook matcher also observes `apply_patch`/Edit/Write. Those operations,
known mutating Bash commands, unknown commands, and unsafe shell structures all
advance the generation on `PostToolUse`. This pilot intentionally uses a single
conservative generation instead of trying to prove which mutations can change
HEAD, branch, or repository identity.

Codex hooks do not currently expose a supported way for `PreToolUse` to inject a
complete synthetic Bash result without a tool execution. The pilot therefore
uses the supported input-rewrite contract: on Windows it substitutes a guarded
`Write-Output`, and on POSIX a guarded `printf`. Codex receives ordinary tool
stdout while the redundant Git subprocess is avoided. If planning throws or any
condition is uncertain, the hook emits no rewrite and Codex executes the original
Git command.

Jev is excluded from this applied path. Its semantic decisions remain telemetry
only.

Example input:

```json
{
  "intent": "verify deployment is current",
  "evidence": {
    "localHead": "8c41de2",
    "deployedRevision": "8c41de2",
    "deployStatus": "success",
    "health": "200",
    "workspaceGeneration": 41
  }
}
```

Example question:

```text
Does this evidence justify skipping another deployment verification?

reuse: evidence is sufficient and still relevant
refresh: another verification should run
uncertain: evidence is ambiguous
```

Only high-confidence `reuse` should suppress a redundant check.

## Failure behavior

The system must fail open.

Run the original Codex action when:

- Jev is unavailable
- confidence is below threshold
- the pending call is unknown
- evidence is stale
- evidence provenance is incomplete
- parsing fails
- hook protocol changes
- state is ambiguous

## Existing model router

The current localhost Responses API proxy remains in the repository.

It may continue to:

- observe model/effort recommendations
- route model/effort experimentally
- collect statistics

But it is not the primary architecture anymore.

The reflex layer should be usable independently of model routing.

## Non-goals

At least initially:

- replacing Codex
- treating Jev as repository memory
- suppressing mutating commands
- aggressive prompt/context compaction
- intercepting every tool
- learning opaque long-term state
- using hooks as a security boundary

## Metrics

Useful measurements:

- eligible checks observed
- exact deterministic reuses
- Jev-gated reuses
- Jev refresh decisions
- low-confidence fallbacks
- stale-evidence fallbacks
- errors/fail-open events
- estimated tool calls avoided
- false reuse reports found during manual review
- user prompts and prompt-hint candidates/injections
- injected facts followed by matching orientation checks
- fallback PreToolUse reuse after a hint
- per-prompt tool calls and estimated avoided checks when both cohorts exist
- Git subprocesses avoided by deterministic fallback, kept distinct from outer
  tool calls (which that fallback cannot avoid)

The first milestone should optimize observability before optimization.

The observer is already producing real local telemetry. Its first captured
same-session repeat was `git rev-parse HEAD` after 124.707 seconds. Results are
cached locally as evidence and evaluated in shadow mode. Three exact Git facts
also have an applied PreToolUse rewrite that avoids their subprocess while
retaining the outer Bash tool call. Prompt hints are a separate experiment aimed
at preventing that outer orientation call before it is chosen.
