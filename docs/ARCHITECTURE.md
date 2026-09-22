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
- identity, workspace, and external generations

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

Phase 1, the Phase 2 shadow layer, and the Phase 3 deterministic reuse layer implement
the `PreToolUse` and `PostToolUse` points below for Bash in Codex CLI. The layer
records metadata, maintains local evidence and generations, and rewrites only
exact allowlisted deterministic queries. Every other operation remains unchanged.

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
5. for exact allowlisted identity, status/diff, full-file read, and search
   commands, return `permissionDecision: "allow"` with `updatedInput.command`
   that emits validated evidence
6. otherwise allow the original tool call unchanged

Initial eligible surface should be tiny and read-only.

### PostToolUse

Intended responsibilities:

1. observe successful eligible simple checks and fully allowlisted read-only compounds
2. normalize safe scalar results, cache bounded non-sensitive reusable output,
   or fingerprint other outputs
3. update provenance, timestamps, workspace identity, and session
4. advance the affected domain generations after every operation not proven read-only
5. collect metrics about repeated checks and shadow decisions

### UserPromptSubmit

Initial reversible optimization.

Current behavior:

- select only valid same-session, same-workspace, same-generation repo root,
  branch, HEAD, and bounded working-tree facts
- apply a short age bound in addition to generation checks
- emit the documented `hookSpecificOutput.additionalContext` response in
  `inject` mode
- compute the same candidate without changing context in `observe` mode
- omit the hint entirely on missing, stale, mismatched, or malformed evidence

Prompt text, transcripts, file contents, commands, logs, and evidence-store
dumps are never included. Selection is deterministic; Jev is not in this path.

## Evidence model

Simplified example:

```json
{
  "kind": "git.status.short",
  "value": " M README.md\n",
  "timestamp": "2026-09-21T10:42:17Z",
  "generationDomain": "workspace",
  "generation": 41,
  "provenance": { "tool": "Bash", "family": "git" }
}
```

## Domain generations

Time-to-live alone is unsafe. The current state is persisted in the ignored
`.model-switch/reflex-state.json` file and bounded to 500 evidence records.

A clean status observed 5 seconds ago is stale if Codex edited a file 1 second ago.

model-switch maintains separate monotonically increasing `identity`, `workspace`,
and `external` generations. A file edit invalidates working-tree, diff, read, and
search evidence without unnecessarily invalidating HEAD, branch, or repository
root. Structural Git operations invalidate identity and workspace evidence;
external writes invalidate external evidence. Unknown mutations invalidate all
domains.

Evidence is reusable only when its recorded domain generation matches the
current generation. The legacy aggregate `workspaceGeneration` remains for
schema migration and telemetry ordering.

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
unambiguous. Their combined output is persisted only when every component is also
an applied-reuse candidate. The broader observation allowlist covers explicit Git queries,
filesystem reads/searches/metadata, runtime/package inspection, and bounded
read-only queries for external CLIs used by this project.

## Jev gate

Jev does not receive a whole transcript. The current shadow integration sends
only requested/prior evidence kinds, command family, evidence age, and the fact
that the prior evidence is current in its validity domain. It uses a conservative
confidence threshold, short timeout, no retries, and returns `uncertain` on any
failure. Its answer is recorded but never applied to the tool call.

## Deterministic reuse

Applied reuse is restricted to exact commands for HEAD, current branch,
repository root, selected status/diff forms, full-file reads, and searches.
Evidence must match session, workspace/repository identity, exact normalized
command hash, and the relevant domain generation. Values are validated again
before use. Partial file reads are never rewritten. Safe read-only compounds are
cached and replayed only as a complete exact command; their evidence records every
domain generation on which the compound depends.

The project hook matcher also observes `apply_patch`/Edit/Write. Those operations,
known mutating Bash commands, unknown commands, and unsafe shell structures
advance the affected generations on `PostToolUse`. Unknown operations use the
conservative all-domain fallback.

Codex hooks do not currently expose a supported way for `PreToolUse` to inject a
complete synthetic Bash result without a tool execution. The pilot therefore
uses the supported input-rewrite contract: on Windows it substitutes a guarded
console write, and on POSIX a guarded `printf`. Codex receives ordinary tool
stdout while the redundant Git subprocess is avoided. If planning throws or any
condition is uncertain, the hook emits no rewrite and Codex executes the original
command. Reusable output is byte-bounded and rejected when the command or output
looks sensitive; only its fingerprint is then retained.

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
- successful deterministic deliveries and operations served from cache
- false reuse reports found during manual review
- user prompts and prompt-hint candidates/injections
- injected facts followed by matching orientation checks
- fallback PreToolUse reuse after a hint
- per-prompt tool calls and estimated avoided checks when both cohorts exist
- Git subprocesses avoided by deterministic fallback, kept distinct from outer
  tool calls (which that fallback cannot avoid)

The first milestone should optimize observability before optimization.

The observer is producing real local telemetry. Applied reuse currently covers
three exact Git identity facts, selected status/diff forms, full-file reads,
searches, and exact compounds composed exclusively from those candidates. The
rewrite avoids underlying subprocess work while retaining the outer Bash tool
call. Prompt hints are a separate experiment aimed at preventing that outer
orientation call before it is chosen.
