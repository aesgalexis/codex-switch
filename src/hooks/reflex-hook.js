import { classifyBashCommand } from "../reflex/classify.js";
import { appendReflexEvent, hashIdentifier } from "../reflex/events.js";

async function readStdin() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  return raw;
}

function responseShape(value) {
  if (value == null) return "none";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

async function main() {
  const raw = await readStdin();
  if (!raw.trim()) return;

  const input = JSON.parse(raw);
  const eventName = input?.hook_event_name;

  if (eventName !== "PreToolUse" && eventName !== "PostToolUse") return;

  const toolName = typeof input?.tool_name === "string" ? input.tool_name : "unknown";
  const command =
    toolName === "Bash" && typeof input?.tool_input?.command === "string"
      ? input.tool_input.command
      : null;
  const classification = classifyBashCommand(command);

  await appendReflexEvent({
    schema: 1,
    at: new Date().toISOString(),
    event: eventName,
    tool: toolName,
    eligible: classification.eligible,
    commandKind: classification.kind,
    commandKey: classification.key,
    compound: classification.compound,
    session: hashIdentifier(input?.session_id),
    turn: hashIdentifier(input?.turn_id),
    toolUse: hashIdentifier(input?.tool_use_id),
    permissionMode:
      typeof input?.permission_mode === "string" ? input.permission_mode : null,
    responseShape:
      eventName === "PostToolUse" ? responseShape(input?.tool_response) : null,
  });
}

try {
  await main();
} catch {
  // Observation hooks must fail open. Never interfere with the Codex tool call.
}
