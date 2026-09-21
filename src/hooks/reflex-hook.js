import { classifyBashCommand } from "../reflex/classify.js";
import { appendReflexEvent, hashIdentifier } from "../reflex/events.js";
import { commandPattern, fingerprint, redactCommand } from "../reflex/privacy.js";
import { advanceGeneration, consumePendingGeneration, evidenceFromObservation, readReflexState, recordPending, writeReflexState } from "../reflex/state.js";
import { deterministicShadow, semanticShadow } from "../reflex/shadow.js";

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

function responseOutput(response) {
  if (typeof response === "string") return response;
  if (!response || typeof response !== "object") return "";
  for (const key of ["output", "stdout", "content", "text"]) {
    if (typeof response[key] === "string") return response[key];
  }
  return "";
}

function responseSucceeded(response) {
  if (!response || typeof response !== "object") return true;
  if (response.is_error === true || response.isError === true) return false;
  const exitCode = response.exit_code ?? response.exitCode;
  return exitCode == null || exitCode === 0;
}

function operationTelemetry(operation, index) {
  return {
    index,
    key: operation.key,
    family: operation.family,
    access: operation.access,
    eligible: operation.eligible,
    command: redactCommand(operation.command),
    commandPattern: commandPattern(operation.command),
    commandHash: fingerprint(operation.command),
  };
}

async function main() {
  const raw = await readStdin();
  if (!raw.trim()) return;
  const input = JSON.parse(raw);
  const eventName = input?.hook_event_name;
  if (eventName !== "PreToolUse" && eventName !== "PostToolUse") return;

  const toolName = typeof input?.tool_name === "string" ? input.tool_name : "unknown";
  const command = toolName === "Bash" && typeof input?.tool_input?.command === "string" ? input.tool_input.command : null;
  const classification = classifyBashCommand(command);
  const session = hashIdentifier(input?.session_id);
  const toolUse = hashIdentifier(input?.tool_use_id);
  const workspacePath = typeof input?.cwd === "string" ? input.cwd : process.cwd();
  const workspaceId = fingerprint(workspacePath.toLowerCase());
  const state = await readReflexState(workspaceId);
  state.workspaceId = workspaceId;
  const generationBefore = state.workspaceGeneration;
  const operations = classification.operations.map(operationTelemetry);

  if (eventName === "PreToolUse") {
    recordPending(state, toolUse);
    let jevAttempted = false;
    for (let index = 0; index < classification.operations.length; index += 1) {
      const operation = classification.operations[index];
      const commandHash = operations[index].commandHash;
      operations[index].shadow = deterministicShadow(state, { operation, session, commandHash });
      if (!jevAttempted && operations[index].shadow.decision === "would_refresh") {
        const semantic = await semanticShadow(state, { operation, session, commandHash });
        if (semantic) {
          operations[index].semanticShadow = semantic;
          jevAttempted = true;
        }
      }
    }
    await writeReflexState(state);
  } else {
    const response = input?.tool_response;
    const observationGeneration = consumePendingGeneration(state, toolUse);
    advanceGeneration(state, classification.potentiallyMutating);
    if (!classification.compound && classification.operations.length === 1 && classification.operations[0].eligible && responseSucceeded(response)) {
      state.evidence.push(evidenceFromObservation({
        operation: classification.operations[0], command: classification.operations[0].command,
        output: responseOutput(response), at: new Date().toISOString(), session, tool: toolName,
        generation: observationGeneration, workspaceId,
      }));
    }
    await writeReflexState(state);
  }

  await appendReflexEvent({
    schema: 2,
    at: new Date().toISOString(),
    event: eventName,
    tool: toolName,
    eligible: classification.eligible,
    commandKind: classification.kind,
    commandKey: classification.key ?? null,
    command: redactCommand(command),
    commandPattern: commandPattern(command),
    family: classification.family ?? "unknown",
    access: classification.access ?? "unknown",
    compound: classification.compound,
    safeCompound: classification.safeCompound,
    potentiallyMutating: classification.potentiallyMutating,
    operations,
    generationBefore,
    generationAfter: state.workspaceGeneration,
    session,
    turn: hashIdentifier(input?.turn_id),
    toolUse,
    permissionMode: typeof input?.permission_mode === "string" ? input.permission_mode : null,
    responseShape: eventName === "PostToolUse" ? responseShape(input?.tool_response) : null,
  });
}

try {
  await main();
} catch {
  // Observation and shadow hooks must always fail open.
}
