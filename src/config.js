const validModes = new Set(["off", "observe", "route"]);

function env(primary, legacy, fallback) {
  return process.env[primary] ?? process.env[legacy] ?? fallback;
}

function readInteger(primary, legacy, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const value = Number(env(primary, legacy, fallback));
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${primary} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function readProbability(primary, legacy, fallback) {
  const value = Number(env(primary, legacy, fallback));
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${primary} must be a number between 0 and 1`);
  }
  return value;
}

export function loadConfig() {
  const mode = env("MODEL_SWITCH_MODE", "CODEX_SWITCH_MODE", "observe");
  if (!validModes.has(mode)) {
    throw new Error(`Invalid MODEL_SWITCH_MODE: ${mode}`);
  }

  return {
    mode,
    host: env("MODEL_SWITCH_HOST", "CODEX_SWITCH_HOST", "127.0.0.1"),
    port: readInteger("MODEL_SWITCH_PORT", "CODEX_SWITCH_PORT", 8317, { max: 65535 }),
    upstream: env(
      "MODEL_SWITCH_UPSTREAM",
      "CODEX_SWITCH_UPSTREAM",
      "https://chatgpt.com/backend-api/codex",
    ).replace(/\/$/, ""),
    jevEnabled: Boolean(process.env.TYPESAFE_API_KEY),
    jevTimeoutMs: readInteger(
      "MODEL_SWITCH_JEV_TIMEOUT_MS",
      "CODEX_SWITCH_JEV_TIMEOUT_MS",
      2500,
      { min: 250, max: 30000 },
    ),
    minConfidence: readProbability(
      "MODEL_SWITCH_MIN_CONFIDENCE",
      "CODEX_SWITCH_MIN_CONFIDENCE",
      0.65,
    ),
    maxRoutingText: readInteger(
      "MODEL_SWITCH_MAX_ROUTING_TEXT",
      "CODEX_SWITCH_MAX_ROUTING_TEXT",
      12000,
      { min: 100, max: 50000 },
    ),
  };
}
