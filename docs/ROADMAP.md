# Roadmap

The project direction changed in September 2026.

The original model router stays alive, but the main experiment is now a Codex reflex layer built around evidence reuse and Jev-gated semantic decisions.

## Phase 0 - preserve the existing router

Status: implemented.

Keep:

- localhost proxy
- observe mode
- route mode
- confidence gating
- fail-open passthrough
- routing statistics

Do not expand model routing until the reflex path is working.

## Phase 1 - observe hooks

Status: initial implementation complete; real Codex-session measurement is next.

Implemented:

- project-scoped Bash `PreToolUse` and `PostToolUse` hooks
- hook entrypoint with fail-open behavior
- tiny read-only command allowlist
- structured local JSONL event log
- semantic command keys instead of raw commands
- hashed session, turn, and tool-use identifiers
- no tool-response contents
- repetition counts and timing metrics via `npm run reflex:stats`

Behavior:

- never block
- never rewrite
- never reuse

Success criterion:

Run normal Codex sessions and answer: which orientation checks Codex repeats, how often, and how close together?

## Phase 2 - deterministic evidence store

Goal: answer exact repeated checks without Jev.

Build:

- in-memory evidence store
- repo identity
- workspace generation
- provenance
- freshness rules
- allowlist for simple read-only Git/shell checks

Initial candidates:

- repository root
- branch
- HEAD
- selected clean/dirty checks

Behavior:

- observe first
- add a dry-run decision showing when a call *could* have been reused

Success criterion:

Manual review shows the deterministic reuse decisions are correct.

## Phase 3 - safe reuse

Goal: actually avoid a tiny set of redundant deterministic checks.

Enable reuse only for calls with:

- exact recognized semantics
- fresh same-generation evidence
- no ambiguity
- no mutation risk

Everything else passes through.

Success criterion:

Repeated checks disappear without visible agent regressions.

## Phase 4 - Jev semantic gate

Goal: cover useful cases where facts exist but sufficiency is semantic.

Add Jev decisions such as:

- `reuse`
- `refresh`
- `uncertain`

Candidate cases:

- enough evidence to skip another deploy verification
- enough evidence to skip another GitHub status inspection
- repeated diagnostic check vs materially new investigation

Requirements:

- bounded inputs
- short timeout
- no retries by default
- high confidence threshold for reuse
- fail open

Success criterion:

Jev saves additional checks without becoming a second agent.

## Phase 5 - prompt-time state hinting

Goal: reduce re-orientation before Codex even chooses a tool.

Experiment with `UserPromptSubmit`:

- select only relevant fresh facts
- inject tiny additional context
- measure whether redundant checks decrease

Do not inject the entire evidence store.

## Phase 6 - adapters

Only after the core is stable, consider explicit evidence adapters for:

- GitHub
- CI
- Firebase Hosting
- other deployment targets used in real workflows

Adapters should expose deterministic facts first.

Jev judges sufficiency; it should not scrape these systems itself.

## Phase 7 - model routing revisited

The existing router becomes an optional policy module.

Possible later experiments:

- model selection
- reasoning effort selection
- route only after reflex-layer savings are measured
- compare savings from avoiding work vs changing models

## Safety constraints

Until evidence says otherwise:

- never suppress edits
- never suppress deploys
- never suppress tests/builds merely because they ran before
- never treat wall-clock freshness as sufficient after mutations
- never let low-confidence Jev output change behavior
- never hide the fallback path

## First practical target

The first useful demo should be deliberately boring:

1. Codex runs `git rev-parse HEAD`.
2. PostToolUse stores the result.
3. Nothing mutates the workspace.
4. Codex asks for the same fact again.
5. PreToolUse recognizes that the same fresh fact is already known.
6. model-switch returns/reuses it without another subprocess.

Then expand one behavior at a time.
