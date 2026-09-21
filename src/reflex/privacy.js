import { createHash } from "node:crypto";

export function fingerprint(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex").slice(0, 16);
}

export function redactCommand(command) {
  if (typeof command !== "string") return null;
  return command
    .slice(0, 2000)
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s"']+/gi, "$1[REDACTED]")
    .replace(/(bearer\s+)[a-z0-9._~+/=-]+/gi, "$1[REDACTED]")
    .replace(/((?:api[_-]?key|token|secret|password|passwd)\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s;]+)/gi, "$1[REDACTED]")
    .replace(/(--(?:token|password|secret|api-key)\s+)(?:"[^"]*"|'[^']*'|[^\s]+)/gi, "$1[REDACTED]")
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1[REDACTED]@");
}

export function commandPattern(command) {
  const redacted = redactCommand(command) ?? "unknown";
  return redacted
    .replace(/"[^"]*"|'[^']*'/g, "<value>")
    .replace(/\b[0-9a-f]{12,}\b/gi, "<id>")
    .replace(/\b\d+\b/g, "<n>")
    .slice(0, 240);
}
