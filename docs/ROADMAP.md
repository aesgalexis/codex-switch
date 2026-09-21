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

Status: initial implementation complete and producing real Codex CLI telemetry;
continued real-session measurement is next.

Implemented:

- project-scoped Bash `PreToolUse` and `PostToolUse` hooks
- hook entrypoint with fail-open behavior
- tiny read-only command allowlist
- structured local JSONL event log
- semantic command keys instead of raw commands
- hashed session, turn, and tool-use identifiers
- no tool-response contents
- repetition counts and timing metrics via `npm run reflex:stats`
- verified Windows hook command for Codex CLI

Observed in real use:

- the first same-session repeated check was `git rev-parse HEAD`
- the repeat interval was 124.707 seconds (approximately 125 seconds)
- compound commands passed through and remained ineligible

Current client boundary:

- Codex CLI traverses the Bash `PreToolUse` and `PostToolUse` lifecycle used by
  the observer
- Codex Desktop currently uses a specialized `custom_tool_call: exec` route
  that does not traverse this lifecycle path, so reliable Phase 1 measurement
  is being performed in CLI

Behavior:

- never block
- observation itself does not rewrite or reuse; the later Phase 3 pilot adds
  the narrowly scoped applied behavior

Success criterion:

Collect enough normal CLI sessions to answer which orientation checks Codex
repeats, how often, and how close together. One real repeat has already been
captured; broader usage is still needed before reuse is implemented.

## Phase 2 - deterministic evidence store

Status: initial shadow implementation complete; real-session validation in
progress. No command is suppressed.

Goal: answer exact repeated checks without Jev.

Implemented in shadow mode:

- bounded local evidence store under `.model-switch/`
- hashed workspace/repository identity
- workspace generation advanced by any non-proven-read-only operation
- provenance, timestamps, sessions, command and response fingerprints
- exact same-session/same-generation reuse candidates
- stale-after-mutation decisions
- broader conservative Git, filesystem, runtime, GitHub, Firebase, and gcloud
  read-only classification
- safe semicolon-only compound decomposition
- redacted unknown-command diagnostics and expanded statistics
- optional bounded Jev sufficiency judgments for related evidence

Initial candidates:

- repository root
- branch
- HEAD
- selected clean/dirty checks

Current behavior:

- observe and persist evidence
- calculate dry-run decisions showing when a call *could* have been reused
- execute the original tool call except for the three Phase 3 pilot commands

Success criterion:

Enough real-session review shows deterministic and semantic shadow decisions,
generation invalidation, and redaction behavior are correct.

## Phase 3 - safe reuse

Status: first conservative pilot implemented.

Goal: actually avoid a tiny set of redundant deterministic checks.

Enabled only for exact repeats of:

- `git rev-parse HEAD`
- `git branch --show-current`
- `git rev-parse --show-toplevel`

The implementation uses the supported `PreToolUse` `updatedInput.command`
mechanism to replace the redundant Git query with a shell-native output command.
All other commands remain observe/shadow-only.

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

Status: initial reversible experiment implemented.

Goal: reduce re-orientation before Codex even chooses a tool.

Implemented with `UserPromptSubmit`:

- select only relevant fresh facts
- emit the documented `additionalContext` hook output in `inject` mode
- support `off | observe | inject`, defaulting conservatively to `observe`
- correlate injected facts with subsequent orientation checks and fallback reuse
- compare turns with and without hints as real CLI data accumulates

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

## Immediate next objective

1. Collect comparable CLI turns with prompt hints off/observed and injected.
2. Measure whether HEAD, branch, and root orientation checks actually decrease.
3. Audit classifier misses, redaction, provenance, and generation invalidation.
4. Keep applied reuse limited to the three deterministic pilot commands.
5. Keep Jev limited to bounded semantic decisions where deterministic local
   facts cannot decide safely.
