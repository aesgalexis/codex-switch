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
- `UserPromptSubmit`: later, inject a tiny amount of relevant fresh state before Codex starts re-orienting itself.

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

The repository currently contains the original **model + reasoning router prototype**:

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

This code is staying in the project, but model routing is now a **secondary module**, not the main purpose.

### Next implementation

The next milestone is the reflex path:

1. local evidence store
2. `PostToolUse` observation for a tiny allowlist of read-only Bash/Git checks
3. `PreToolUse` duplicate-check detection
4. deterministic reuse without Jev where possible
5. Jev `reuse | refresh | uncertain` gate where semantics are required
6. metrics comparing avoided checks vs fallbacks
7. only then consider `UserPromptSubmit` context injection

See [docs/ROADMAP.md](docs/ROADMAP.md).

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

The reflex architecture is intended to send Jev only the **small bounded state required for a decision**, not whole repository contents or full Codex transcripts.

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

## License

MIT.
