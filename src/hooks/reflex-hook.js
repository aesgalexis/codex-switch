import { classifyBashCommand } from "../reflex/classify.js";
import { appendReflexEvent, hashIdentifier } from "../reflex/events.js";
import { commandPattern, fingerprint, redactCommand } from "../reflex/privacy.js";
import { preToolUseRewrite, safePlanActualReuse } from "../reflex/reuse.js";
import { advanceGeneration, consumePending, evidenceFromObservation, readReflexState, recordPending, writeReflexState } from "../reflex/state.js";
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
  let hookResponse = null;
  let actualReuseDelivery = null;

  if (eventName === "PreToolUse") {
    let jevAttempted = false;
    let pendingMetadata = {};
    for (let index = 0; index < classification.operations.length; index += 1) {
      const operation = classification.operations[index];
      const commandHash = operations[index].commandHash;
      operations[index].shadow = deterministicShadow(state, { operation, session, commandHash });
      if (!classification.compound && classification.operations.length === 1) {
        {
          const reuse = safePlanActualReuse(state, { operation, session, commandHash });
          if (reuse.outcome !== "not_candidate") {
            operations[index].actualReuse = {
              outcome: reuse.outcome,
              reason: reuse.reason,
              evidenceGeneration: reuse.evidenceGeneration ?? null,
              evidenceTimestamp: reuse.evidenceTimestamp ?? null,
            };
          }
          if (reuse.outcome === "actual_reuse") {
            pendingMetadata = { actualReuse: { key: reuse.key, evidenceGeneration: reuse.evidenceGeneration } };
            hookResponse = preToolUseRewrite(reuse.updatedCommand);
          }
        }
      }
      if (!jevAttempted && operations[index].shadow.decision === "would_refresh") {
        const semantic = await semanticShadow(state, { operation, session, commandHash });
        if (semantic) {
          operations[index].semanticShadow = semantic;
          jevAttempted = true;
        }
      }
    }
    recordPending(state, toolUse, new Date().toISOString(), pendingMetadata);
    await writeReflexState(state);
  } else {
    const response = input?.tool_response;
    const pending = consumePending(state, toolUse);
    const observationGeneration = Number.isInteger(pending?.workspaceGeneration) ? pending.workspaceGeneration : state.workspaceGeneration;
    const reused = Boolean(pending?.actualReuse);
    if (reused) {
      actualReuseDelivery = { ...pending.actualReuse, success: responseSucceeded(response) };
    }
    advanceGeneration(state, reused ? false : classification.potentiallyMutating);
    if (!reused && !classification.compound && classification.operations.length === 1 && classification.operations[0].eligible && responseSucceeded(response)) {
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
    potentiallyMutating: actualReuseDelivery ? false : classification.potentiallyMutating,
    operations,
    actualReuseDelivery,
    generationBefore,
    generationAfter: state.workspaceGeneration,
    session,
    turn: hashIdentifier(input?.turn_id),
    toolUse,
    permissionMode: typeof input?.permission_mode === "string" ? input.permission_mode : null,
    responseShape: eventName === "PostToolUse" ? responseShape(input?.tool_response) : null,
  });
  return hookResponse;
}

try {
  const response = await main();
  if (response) process.stdout.write(JSON.stringify(response));
} catch {
  // Observation and shadow hooks must always fail open.
}
