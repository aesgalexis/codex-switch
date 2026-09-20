# codex-switch

A small local routing layer for OpenAI Codex.

It sits between Codex Desktop / CLI and the normal Codex backend, asks TypeSafe Jev which model and reasoning effort fit the current task, and can optionally rewrite the request before forwarding it.

> Experimental. Start in `observe` mode. This project is unofficial and is not affiliated with OpenAI or TypeSafe.

```text
Codex Desktop / CLI
        |
        v
codex-switch (localhost)
        |
        +--> TypeSafe Jev
        |    model + effort + confidence
        |
        v
OpenAI Codex backend
```

No OpenRouter. No community router in the request path. The code is intentionally small enough to audit.

## Why

Using the strongest model and highest reasoning effort for every Codex turn is wasteful. A typo fix and an architectural refactor do not need the same amount of model.

codex-switch is an experiment in making that choice automatically while keeping the user's normal Codex authentication and workflow.

## Status

Very early prototype.

The safe default is **`observe`**:

- Jev recommends a model and reasoning effort.
- The recommendation and confidence are printed locally.
- The Codex request is not changed.

Initial candidates:

- `gpt-5.6-luna`
- `gpt-5.6-terra`
- `gpt-5.6-sol`

Astra is deliberately excluded until cross-family switching is tested against real Codex Desktop traffic.

TypeSafe Jev is currently in early access. See the [TypeSafe announcement](https://typesafe.ai/blog/introducing-system-one-models-and-jev) and the [official JavaScript SDK](https://github.com/typesafe-ai/typesafe-sdk-js).

## Safety model

codex-switch is conservative by design:

- **Fail open** - if Jev errors or times out, the original Codex request is forwarded.
- **Observe first** - routing is disabled by default.
- **Confidence gate** - route mode only changes requests when both model and effort confidence clear the configured threshold.
- **Short Jev timeout** - default 2.5 seconds, with SDK retries disabled.
- **Local listener** - binds to `127.0.0.1` by default.
- **No credential storage** - ChatGPT/OpenAI authorization is forwarded in memory and never written to logs.
- **No shared fallback session** - missing session metadata never falls back to a global routing state.

## Requirements

- Node.js 20+
- Codex signed in normally with ChatGPT
- A TypeSafe API key for Jev decisions

Without `TYPESAFE_API_KEY`, the proxy still starts and behaves as plain passthrough.

## Quick start

```powershell
git clone https://github.com/aesgalexis/codex-switch.git
cd codex-switch
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
{"ok":true,"mode":"observe","jev":true,"minConfidence":0.65}
```

## Codex configuration

See [`examples/codex-config.toml`](examples/codex-config.toml).

The important part is:

```toml
model = "gpt-5.6-sol"
model_provider = "codex-switch"

[model_providers.codex-switch]
name = "Codex Switch"
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
[codex-switch] observe gpt-5.6-sol -> gpt-5.6-luna / low confidence=0.91/0.88 [jev, routable]
```

This is the mode intended for the first real-world tests.

### `route`

```powershell
$env:CODEX_SWITCH_MODE="route"
npm start
```

Requests are rewritten only when both Jev confidence values are at or above `CODEX_SWITCH_MIN_CONFIDENCE`.

### `off`

Plain local passthrough. Jev is not consulted.

## Configuration

See [`.env.example`](.env.example).

Useful settings:

| Variable | Default | Purpose |
| --- | ---: | --- |
| `CODEX_SWITCH_MODE` | `observe` | `off`, `observe`, or `route` |
| `CODEX_SWITCH_PORT` | `8317` | Local proxy port |
| `CODEX_SWITCH_JEV_TIMEOUT_MS` | `2500` | Jev timeout before passthrough |
| `CODEX_SWITCH_MIN_CONFIDENCE` | `0.65` | Minimum model and effort confidence for routing |
| `CODEX_SWITCH_MAX_ROUTING_TEXT` | `12000` | Maximum latest-user text sent to Jev |

## Privacy

The proxy does **not** log prompts or authorization headers.

Jev is not local: when enabled, TypeSafe receives the latest user request needed to make the routing decision, capped by `CODEX_SWITCH_MAX_ROUTING_TEXT`.

That tradeoff is intentional and should be understood before using route mode with sensitive code or prompts.

## Development

```powershell
npm test
npm run check
```

CI runs the same checks on pushes and pull requests.

## Next

- Verify the exact request shape emitted by current Codex Desktop on Windows.
- Collect real `observe` decisions.
- Add routing counters and estimated model savings.
- Validate turn pinning against real Codex session metadata.
- Enable `route` only after observation data looks sane.
- Test Astra separately.

## License

MIT.
