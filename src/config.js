const validModes = new Set(["off", "observe", "route"]);

export function loadConfig() {
  const mode = process.env.CODEX_SWITCH_MODE ?? "observe";
  if (!validModes.has(mode)) {
    throw new Error(`Invalid CODEX_SWITCH_MODE: ${mode}`);
  }

  const port = Number(process.env.CODEX_SWITCH_PORT ?? 8317);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("CODEX_SWITCH_PORT must be a valid TCP port");
  }

  return {
    mode,
    host: process.env.CODEX_SWITCH_HOST ?? "127.0.0.1",
    port,
    upstream: (process.env.CODEX_SWITCH_UPSTREAM ?? "https://chatgpt.com/backend-api/codex").replace(/\/$/, ""),
    jevEnabled: Boolean(process.env.TYPESAFE_API_KEY),
    maxRoutingText: 12000,
  };
}
