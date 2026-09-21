# model-switch

A local reflex layer for OpenAI Codex.

**Reuse fresh evidence, use TypeSafe Jev for bounded semantic judgments, and let Codex do the expensive work only when necessary.**

> Experimental. This project is unofficial and is not affiliated with OpenAI or TypeSafe.

## Why

Coding agents spend a surprising amount of time re-checking things they just learned:

- Is this the repository?
- What branch am I on?
- Is the worktree clean?
- Did the deploy finish?
- Is production already on this commit?
- Do I really need to inspect GitHub again?
- Is there enough evidence to continue, or should I verify?

Some of those questions are deterministic. Some are fuzzy. Very few deserve a full Codex reasoning cycle every time.

model-switch is evolving from a pure model router into a **local reflex layer** that sits around Codex tool use.

```text
                         local evidence
                              |
                              v
Codex -> tool call -> PreToolUse gate
                         |
                +--------+--------+
                |                 |
          deterministic         ambiguous
             answer               |
                |                 v
                |                Jev
                |          reuse / refresh
                |                 |
                +--------+--------+
                         |
                  enough evidence?
                    /         \
                  yes          no
                   |            |
              skip/rewrite   run tool
                                |
                                v
                           PostToolUse
                                |
                                v
                         update evidence
```

The goal is not to make Jev know the repository. The goal is to let normal code track facts, let Jev make small semantic decisions over those facts, and fall back to Codex whenever uncertainty remains.

## Design principles

### 1. Facts first

If code can know something exactly, code should answer it.

Examples:

- repository root
- branch
- HEAD
- dirty/clean state
- known deploy revision
- last build/test result
- timestamps and workspace generation

Jev should not be asked to rediscover deterministic state.

### 2. Jev as a semantic gate

Jev is useful for bounded questions such as:

- Is this evidence sufficient to skip another verification?
- Does this tool call appear to be repeating a fresh observation?
- Should this state be reused or refreshed?
- Is this deployment evidence strong enough to continue?

A low-confidence answer must **fail open**: Codex performs the original check.

### 3. Evidence has provenance

Cached state is only useful if we know where it came from and when it stopped being valid.

A future evidence record will look roughly like:

```json
{
  "kind": "git.status",
  "value": "clean",
  "source": "Bash",
  "observedAt": "2026-09-21T10:42:17Z",
  "workspaceGeneration": 41,
  "repoHead": "8c41de2"
}
```

Any potentially mutating operation advances the workspace generation. Evidence from an older generation is not silently reused.

### 4. Hooks, not prompt tricks

Current Codex supports lifecycle hooks including `PreToolUse`, `PostToolUse`, and `UserPromptSubmit`.

The intended integration is:

- `PreToolUse`: inspect a pending local tool call and decide whether fresh evidence can satisfy it.
- `PostToolUse`: observe completed tool results and update the evidence store.
- `UserPromptSubmit`: optionally inject a tiny amount of relevant fresh state before Codex starts re-orienting itself.

Hooks remain a useful optimization layer, not a security boundary.

### 5. Conservative by default

- Read-only checks first.
- No suppression of mutations in the first implementation.
- No aggressive context rewriting.
- Short Jev timeouts.
- Confidence gates.
- Fail open on errors, stale evidence, unknown commands, or low confidence.
- Keep the behavior observable and reversible.

## Architecture

The project is moving toward three layers:

| Layer | Job | Intelligence |
| --- | --- | --- |
| **L0 - facts** | Track deterministic repository/tool state | normal code |
| **L1 - judgment** | Decide reuse vs refresh when the answer is semantic | TypeSafe Jev |
| **L2 - execution** | Investigate, reason, edit, test, deploy | Codex |

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Current status

### Implemented today

The repository now has two independent experimental paths.

TypeSafe Jev is working locally through `@typesafe-ai/sdk`, and the official
project-scoped `typesafe-ai` skill is installed under
`.agents/skills/typesafe-ai`. In a real router observation, a trivial task
requested with Sol + High was evaluated by Jev as `gpt-5.6-luna` + `low`.
The router remains in its safe default `observe` mode, so that recommendation
was recorded without rewriting the request.

The **Phase 1 observer / Phase 2 evidence layer / Phase 3 reuse pilot** now provides:

- project-scoped Codex `PreToolUse` and `PostToolUse` hooks for Bash, verified
  in Codex CLI
- a conservative read-only classifier for Git inspection, filesystem reading
  and search, runtime/package inspection, and bounded `gh`, Firebase, and
  `gcloud` queries
- safe decomposition of semicolon-only compounds, while pipes, redirects,
  variables, subshells, conditionals, and other ambiguous shell forms remain
  non-reusable
- redacted local command diagnostics plus semantic command keys
- hashed session, turn, and tool-use identifiers
- no tool-response contents in the log
- workspace generations and normalized local evidence with provenance
- deterministic shadow decisions: `would_reuse`, `would_refresh`,
  `stale_after_mutation`, `not_eligible`, and `unknown`
- real deterministic reuse for exactly `git rev-parse HEAD`,
  `git branch --show-current`, and `git rev-parse --show-toplevel`
- prompt-time state hints for fresh repo root, branch, and HEAD evidence, with
  explicit `off | observe | inject` modes and conservative `observe` default
- optional Jev shadow judgments (`reuse | refresh | uncertain`) for bounded
  semantic sufficiency cases
- richer repetition, coverage, unknown-family, mutation, and potential-savings
  metrics via `npm run reflex:stats`
- fail-open behavior
- no blocking; rewriting is limited to the three deterministic reuse commands

Real telemetry is now working. The first repeated check observed within one
actual session was `git rev-parse HEAD`, repeated after 124.707 seconds
(approximately 125 seconds). Safe semicolon-separated compounds can now expose
recognized internal operations for observation, but the compound still runs
unchanged and its combined output is not stored as evidence.

There is currently an integration difference between Codex clients. Codex CLI
invokes Bash through the `PreToolUse`/`PostToolUse` lifecycle path used by this
observer. Codex Desktop currently executes these shell operations through its
specialized `custom_tool_call: exec` path, which does not traverse this hook
lifecycle. Reliable reflex telemetry is therefore being measured in CLI for
now; Desktop support is not claimed yet.

The original **model + reasoning router prototype** also remains available:

```text
Codex Desktop / CLI
        |
        v
model-switch localhost proxy
        |
        +--> Jev: model + effort
        |
        v
OpenAI Codex backend
```

It supports:

- `observe` mode
- `route` mode
- confidence gating
- short Jev timeout
- fail-open passthrough
- local statistics
- normal ChatGPT/Codex authentication forwarding

Model routing is now a **secondary module**, not the main purpose.

### Next implementation

The immediate goal is to measure whether prompt-time facts prevent orientation
calls, while continuing to validate shadow decisions and applied reuse:

1. collect a larger real-session sample
2. review classification and redaction misses
3. validate generation changes after potentially mutating operations
4. review deterministic and Jev shadow decisions
5. compare prompt turns with and without injected hints
6. reserve Jev `reuse | refresh | uncertain` judgments for semantic cases where
   local deterministic facts are not sufficient

See [docs/ROADMAP.md](docs/ROADMAP.md).

## Reflex layer quick start

Most operations remain observational. Applied behavior is limited to the three
exact deterministic Git rewrites and the optional prompt hint described below.

Project hooks live in `.codex/hooks.json`. Codex must trust the project hook layer before those hooks will run.

Use Codex CLI normally inside this repository, then inspect what repeated
orientation checks were observed:

```powershell
npm run reflex:stats
```

The local event log is written to `.model-switch/reflex-events.jsonl`; evidence
and generation state are written to `.model-switch/reflex-state.json`. Both are
ignored by Git. Set `MODEL_SWITCH_REFLEX_LOG` to relocate the event log and its
adjacent state file.

Recognized operations include explicit Git queries (`status`, `diff`, branch
queries, `rev-parse`, `log`, `show`, refs and config reads), filesystem reads,
listings, metadata and searches, Node/npm inspection, and a bounded set of
read-only external CLI queries. Unknown or potentially mutating commands
invalidate the current workspace generation conservatively. All operations
outside the three exact reuse commands remain observational/shadow-only and are
never blocked, rewritten, skipped, or served from evidence.

For the three exact deterministic commands, fresh same-session, same-workspace,
same-generation evidence is reused through the official `PreToolUse`
`permissionDecision: "allow"` plus `updatedInput.command` mechanism. The
rewritten shell command prints the validated cached scalar, with the original
Git command as fallback. This avoids the redundant Git subprocess; it does not
remove the surrounding Codex Bash tool call.

`UserPromptSubmit` can add a separate preventive layer. Set
`MODEL_SWITCH_PROMPT_HINT_MODE=inject` to provide a short official
`additionalContext` block containing only valid same-session, same-generation
repo root, branch, and HEAD facts. The default `observe` mode computes the
candidate without changing model context; `off` disables it. Facts older than
`MODEL_SWITCH_PROMPT_HINT_MAX_AGE_MS` are excluded. This may prevent Codex from
choosing an orientation tool call; unlike the PreToolUse fallback, such a
prevention would save the outer tool call as well as its Git subprocess.

The contract is documented in the official [Codex hooks documentation](https://learn.chatgpt.com/docs/hooks):
`UserPromptSubmit` accepts `hookSpecificOutput.additionalContext`, which is
added as extra developer context for the model. This adds a small number of
input tokens; it saves tokens or tool calls only when Codex consequently avoids
an otherwise redundant check.

The first controlled CLI injection delivered all three facts. Codex then made
one task-relevant file-read call and no HEAD, branch, or root checks. This is a
successful mechanism test, not yet causal proof: the sample has one injected
turn, so `estimatedChecksAvoided` remains `null` until comparable control and
injected cohorts exist.

`npm run reflex:stats` reports deterministic fallback savings as
`gitSubprocessesAvoided`; `toolCallsAvoidedByPreToolReuse` is always zero because
that fallback still executes the surrounding Bash call. Prompt-level avoided
checks are estimated separately only when both cohorts are available.

Every operation not proven read-only advances `workspaceGeneration` after
`PostToolUse`. This includes known mutations, unknown commands, unsafe shell
structures, `apply_patch`/Edit/Write operations, tests, builds, deploys, and
external writes. This conservative rule may invalidate HEAD more often than
necessary, but prevents reuse across a possible commit, checkout, reset, merge,
or rebase.

When `TYPESAFE_API_KEY` is available, the hook may ask Jev one bounded semantic
question for related evidence in shadow mode. Jev never receives command output,
repository contents, or a transcript. See `.env.example` for its independent
timeout, confidence threshold, and off switch.

## Existing router quick start

The original routing prototype still works independently of the future hook layer.

Requirements:

- Node.js 20+
- Codex signed in normally with ChatGPT
- TypeSafe API key for Jev decisions

```powershell
git clone https://github.com/aesgalexis/model-switch.git
cd model-switch
npm install

$env:TYPESAFE_API_KEY="YOUR_KEY"
npm start
```

Health check:

```powershell
Invoke-RestMethod http://127.0.0.1:8317/health
```

Without `TYPESAFE_API_KEY`, the proxy starts as plain passthrough.

See [examples/codex-config.toml](examples/codex-config.toml) for the provider configuration.

## Router modes

### `observe` - default

Jev recommends a model and reasoning effort, but the request is unchanged.

### `route`

```powershell
$env:MODEL_SWITCH_MODE="route"
npm start
```

The request is rewritten only when both Jev confidence values clear `MODEL_SWITCH_MIN_CONFIDENCE`.

### `off`

Plain local passthrough. Jev is not consulted.

## Configuration

See [.env.example](.env.example).

The `MODEL_SWITCH_MODE` and routing-specific variables currently apply to the **existing model-router prototype**. The reflex layer will receive its own explicit settings as it is implemented rather than overloading these controls.

## Privacy

The current proxy does not log prompts or authorization headers.

Jev is remote. In the existing router, TypeSafe receives the latest user request required for the routing decision, capped by `MODEL_SWITCH_MAX_ROUTING_TEXT`.

The reflex shadow gate sends Jev only small metadata: requested/prior evidence
kind, command family, age, and whether the workspace generation matches. Local
command diagnostics are redacted for common credentials and remain under the
Git-ignored `.model-switch/` directory; tool-response contents are not written
to the event log. Evidence stores safe scalar values only for a small set of
facts and fingerprints other outputs.

Jev remains shadow-only and can never authorize an applied reuse.

## References

- [OpenAI Codex hooks](https://developers.openai.com/docs/hooks)
- [OpenAI Codex advanced configuration](https://developers.openai.com/docs/config-file/config-advanced)
- [TypeSafe AI / Jev](https://typesafe.ai/)
- [TypeSafe JavaScript SDK](https://github.com/typesafe-ai/typesafe-sdk-js)

## Development

```powershell
npm test
npm run check
```

To validate, commit all non-ignored repository changes, and push the current
branch (configuring `origin` as upstream when needed):

```powershell
npm run repo:publish
npm run repo:publish -- "Expand reflex observation"
```

The command aborts before staging when checks fail. It refuses tracked or staged
`.env`, `.env.*` (except `.env.example`), `.model-switch/`, and `*.log` paths.
If there are no changes to commit, it still pushes any existing local commits.

## License

MIT.
