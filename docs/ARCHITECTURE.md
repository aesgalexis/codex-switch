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

### PreToolUse

Intended responsibilities:

1. classify whether the pending call is eligible
2. check whether exact fresh evidence already answers it
3. use Jev only if semantic judgment is needed
4. reuse or rewrite only when confidence and freshness gates pass
5. otherwise allow the original tool call unchanged

Initial eligible surface should be tiny and read-only.

### PostToolUse

Intended responsibilities:

1. observe successful eligible checks
2. normalize results into evidence records
3. update provenance and timestamps
4. advance or invalidate workspace state after mutations
5. collect metrics about repeated checks

### UserPromptSubmit

Later optimization only.

Potential use:

- select a few relevant fresh facts for the new user request
- inject those facts as small additional context
- avoid dumping the whole evidence store into context

This should be added only after PreToolUse/PostToolUse behavior is measured.

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

Time-to-live alone is unsafe.

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

Unknown, compound, redirected, piped, or potentially mutating shell commands should pass through untouched.

## Jev gate

Jev should not receive a whole transcript.

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

The first milestone should optimize observability before optimization.
