# model-switch

A small local model and reasoning router for OpenAI Codex.

It sits between Codex Desktop / CLI and the normal Codex backend, asks TypeSafe Jev which model and reasoning effort fit the current task, and can optionally rewrite the request before forwarding it.

> Experimental. Start in `observe` mode. This project is unofficial and is not affiliated with OpenAI or TypeSafe.

```text
Codex Desktop / CLI
        |
        v
model-switch (localhost)
        |
        +--> TypeSafe Jev
        |    model + effort + confidence
        |
        v
OpenAI Codex backend
```

No OpenRouter. No community router in the request path. The code is intentionally small enough to audit.

## Why

A typo fix and an architectural refactor do not need the same model or reasoning effort.

model-switch is an experiment in choosing that automatically while keeping the user's normal Codex authentication and workflow.

## Status

Very early prototype.

The safe default is **`observe`**:

- Jev recommends a model and reasoning effort.
- The recommendation and confidence are printed locally.
- The Codex request is not changed.
- Local counters show how Jev would have routed the session.

Initial candidates:

- `gpt-5.6-luna`
- `gpt-5.6-terra`
- `gpt-5.6-sol`

Astra is deliberately excluded until cross-family switching is tested against real Codex Desktop traffic.

TypeSafe Jev is currently in early access. See the [TypeSafe announcement](https://typesafe.ai/blog/introducing-system-one-models-and-jev) and the [official JavaScript SDK](https://github.com/typesafe-ai/typesafe-sdk-js).

## Safety model

model-switch is conservative by design:

- **Fail open** - if Jev errors or times out, the original Codex request is forwarded.
- **Observe first** - routing is disabled by default.
- **Confidence gate** - route mode only changes requests when both model and effort confidence clear the configured threshold.
- **Short Jev timeout** - default 2.5 seconds, with SDK retries disabled.
- **Local listener** - binds to `127.0.0.1` by default.
- **No credential storage** - ChatGPT/OpenAI authorization is forwarded in memory and never written to logs.
- **No prompt logging** - statistics contain counts only.
- **No shared fallback session** - missing session metadata never falls back to a global routing state.

## Requirements

- Node.js 20+
- Codex signed in normally with ChatGPT
- A TypeSafe API key for Jev decisions

Without `TYPESAFE_API_KEY`, the proxy still starts and behaves as plain passthrough.

## Quick start

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

Example:

```json
{"ok":true,"name":"model-switch","mode":"observe","jev":true,"minConfidence":0.65}
```

Routing statistics:

```powershell
Invoke-RestMethod http://127.0.0.1:8317/stats
```

Example:

```json
{
  "requests": 42,
  "responseRequests": 38,
  "jevDecisions": 12,
  "routed": 0,
  "passthrough": 38,
  "routingErrors": 0,
  "recommendations": {
    "models": {
      "gpt-5.6-luna": 7,
      "gpt-5.6-terra": 3,
      "gpt-5.6-sol": 2
    },
    "efforts": {
      "low": 7,
      "medium": 4,
      "high": 1
    }
  }
}
```

Counters reset when model-switch restarts. Nothing is persisted yet.

## Codex configuration

See [`examples/codex-config.toml`](examples/codex-config.toml).

The important part is:

```toml
model = "gpt-5.6-sol"
model_provider = "model-switch"

[model_providers.model-switch]
name = "Model Switch"
base_url = "http://127.0.0.1:8317"
wire_api = "responses"
requires_openai_auth = true
supports_websockets = false
```

Keep your normal Codex configuration available so reverting is trivial.

## Modes

### `observe` - default

Jev makes a recommendation, but nothing is rewritten.

```text
[model-switch] observe gpt-5.6-sol -> gpt-5.6-luna / low confidence=0.91/0.88 [jev, routable]
```

This is the mode intended for the first real-world tests.

### `route`

```powershell
$env:MODEL_SWITCH_MODE="route"
npm start
```

Requests are rewritten only when both Jev confidence values are at or above `MODEL_SWITCH_MIN_CONFIDENCE`.

### `off`

Plain local passthrough. Jev is not consulted.

## Configuration

See [`.env.example`](.env.example).

| Variable | Default | Purpose |
| --- | ---: | --- |
| `MODEL_SWITCH_MODE` | `observe` | `off`, `observe`, or `route` |
| `MODEL_SWITCH_PORT` | `8317` | Local proxy port |
| `MODEL_SWITCH_JEV_TIMEOUT_MS` | `2500` | Jev timeout before passthrough |
| `MODEL_SWITCH_MIN_CONFIDENCE` | `0.65` | Minimum model and effort confidence for routing |
| `MODEL_SWITCH_MAX_ROUTING_TEXT` | `12000` | Maximum latest-user text sent to Jev |

The old `CODEX_SWITCH_*` environment variable names are still accepted as temporary backwards-compatible aliases.

## Privacy

The proxy does **not** log prompts or authorization headers.

Jev is not local: when enabled, TypeSafe receives the latest user request needed to make the routing decision, capped by `MODEL_SWITCH_MAX_ROUTING_TEXT`.

The local `/stats` endpoint stores only counters and recommendation labels in memory.

## Development

```powershell
npm test
npm run check
```

CI runs the same checks on pushes and pull requests.

## Next

- Verify the exact request shape emitted by current Codex Desktop on Windows.
- Collect real `observe` decisions.
- Compare recommendation distribution against actual Codex usage.
- Validate turn pinning against real Codex session metadata.
- Enable `route` only after observation data looks sane.
- Test Astra separately.

## License

MIT.
