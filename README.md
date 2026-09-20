# codex-switch

A deliberately small local router for Codex.

```
Codex Desktop / CLI
        |
        v
codex-switch on localhost
        |
        +--> TypeSafe Jev: choose model + reasoning effort
        |
        v
OpenAI Codex backend
```

No OpenRouter. No community router in the request path. The only external services are OpenAI for Codex and TypeSafe for Jev.

## Status

Early prototype. **Default mode is `observe`**: Jev recommends a model and reasoning effort and the console shows the decision, but Codex requests are not modified.

Initial routing is intentionally limited to:

- `gpt-5.6-luna`
- `gpt-5.6-terra`
- `gpt-5.6-sol`

Astra is excluded until changing model families underneath current Codex Desktop requests is verified as safe.

## Requirements

- Node.js 20+
- Codex signed in normally with ChatGPT
- TypeSafe API key in `TYPESAFE_API_KEY`

The project uses TypeSafe's official JavaScript SDK only.

## Run

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

Expected:

```json
{"ok":true,"mode":"observe","jev":true}
```

## Codex configuration

See `examples/codex-config.toml`.

The important properties are:

```toml
model_provider = "codex-switch"

[model_providers.codex-switch]
base_url = "http://127.0.0.1:8317"
wire_api = "responses"
requires_openai_auth = true
supports_websockets = false
```

Codex keeps its normal OpenAI/ChatGPT authentication. The local proxy forwards the request upstream and never logs the authorization header.

## Modes

### observe - default

Jev makes decisions and the console shows them, but the request remains untouched:

```
[codex-switch] observe gpt-5.6-sol -> gpt-5.6-luna / low [jev]
```

This is the mode to use first in real Codex sessions.

### route

After observation looks sane:

```powershell
$env:CODEX_SWITCH_MODE="route"
npm start
```

Now codex-switch rewrites `model` and `reasoning.effort` before forwarding the request.

### off

Plain local passthrough. Jev is not consulted.

## Privacy

codex-switch does not log prompts or authorization tokens.

Jev receives only enough of the latest user request to choose a route. Routing text is capped at 12,000 characters.

## Design rules

1. Fail open: if Jev fails, keep the original Codex model.
2. Observe before routing.
3. Bind only to `127.0.0.1`.
4. Never store ChatGPT/OpenAI credentials.
5. Avoid cross-family model switching until tested.
6. Keep the project small enough to audit in one sitting.

## Rollout

1. Verify the exact request path used by current Codex Desktop on Windows.
2. Run real sessions in `observe` mode.
3. Compare Jev recommendations with what Codex was manually using.
4. Add Luna/Terra/Sol counters and estimated savings.
5. Enable `route` only after the observation data looks good.
6. Test Astra separately before adding it to normal routing.
