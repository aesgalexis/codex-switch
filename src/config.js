const validModes = new Set(["off", "observe", "route"]);

function readInteger(name, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function readProbability(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be a number between 0 and 1`);
  }
  return value;
}

export function loadConfig() {
  const mode = process.env.CODEX_SWITCH_MODE ?? "observe";
  if (!validModes.has(mode)) {
    throw new Error(`Invalid CODEX_SWITCH_MODE: ${mode}`);
  }

  return {
    mode,
    host: process.env.CODEX_SWITCH_HOST ?? "127.0.0.1",
    port: readInteger("CODEX_SWITCH_PORT", 8317, { max: 65535 }),
    upstream: (process.env.CODEX_SWITCH_UPSTREAM ?? "https://chatgpt.com/backend-api/codex").replace(/\/$/, ""),
    jevEnabled: Boolean(process.env.TYPESAFE_API_KEY),
    jevTimeoutMs: readInteger("CODEX_SWITCH_JEV_TIMEOUT_MS", 2500, { min: 250, max: 30000 }),
    minConfidence: readProbability("CODEX_SWITCH_MIN_CONFIDENCE", 0.65),
    maxRoutingText: readInteger("CODEX_SWITCH_MAX_ROUTING_TEXT", 12000, { min: 100, max: 50000 }),
  };
}
