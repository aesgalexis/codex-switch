import { classifyBashCommand, safeCompoundIdentity } from "../reflex/classify.js";
import { appendReflexEvent, hashIdentifier } from "../reflex/events.js";
import { promptHintMode, selectPromptHint, userPromptHookOutput } from "../reflex/hints.js";
import { commandPattern, fingerprint, redactCommand } from "../reflex/privacy.js";
import { isActualReuseCandidate, preToolUseRewrite, safePlanActualReuse } from "../reflex/reuse.js";
import { advanceFileGenerations, advanceGenerations, consumePending, evidenceFromObservation, outputStorageReason, readReflexState, recordPending, withReflexStateLock, writeReflexState } from "../reflex/state.js";
import { deterministicShadow, semanticShadow } from "../reflex/shadow.js";
import { REFLEX_RUNTIME } from "../reflex/runtime.js";
import { editedFileKeys, fileFreshness, fullFileReadInfo } from "../reflex/files.js";
import { resolveWorkspace } from "../reflex/workspace.js";

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

function compoundOperation(classification, command) {
  if (!classification.safeCompound || classification.operations.length < 2 ||
      !classification.operations.every(isActualReuseCandidate)) return null;
  return { command, key: "shell.compound.readonly", family: "compound", access: "read-only", eligible: true };
}

function compoundGenerationDomains(classification) {
  const domains = new Set();
  for (const operation of classification.operations) {
    if (["git.head", "git.root", "git.branch.current"].includes(operation.key)) domains.add("identity");
    else if (["gh", "firebase", "gcloud"].includes(operation.family)) domains.add("external");
    else domains.add("workspace");
  }
  return [...domains];
}

function invalidationDomains(classification, toolName) {
  if (["apply_patch", "Edit", "Write"].includes(toolName)) return ["workspace"];
  if (!classification.potentiallyMutating) return [];
  const operations = classification.operations.length > 0 ? classification.operations : [classification];
  const domains = new Set();
  const structuralGit = /git\.(?:branch|checkout|switch|reset|merge|rebase|cherry-pick|pull|commit|revert|stash|clean|restore|rm|mv|worktree|clone|init)/;
  for (const operation of operations) {
    if (operation.access === "read-only") continue;
    if (operation.family === "git") {
      domains.add("workspace");
      if (structuralGit.test(operation.reason ?? "")) domains.add("identity");
    } else if (["gh", "firebase", "gcloud"].includes(operation.family)) domains.add("external");
    else if (operation.family === "unknown" || operation.family === "compound") {
      domains.add("identity"); domains.add("workspace"); domains.add("external");
    } else domains.add("workspace");
  }
  return [...domains];
}

async function main() {
  const raw = await readStdin();
  if (!raw.trim()) return;
  const input = JSON.parse(raw);
  const eventName = input?.hook_event_name;
  if (!["PreToolUse", "PostToolUse", "UserPromptSubmit"].includes(eventName)) return;

  const toolName = typeof input?.tool_name === "string" ? input.tool_name : "unknown";
  const command = toolName === "Bash" && typeof input?.tool_input?.command === "string" ? input.tool_input.command : null;
  const classification = classifyBashCommand(command);
  const session = hashIdentifier(input?.session_id);
  const toolUse = hashIdentifier(input?.tool_use_id);
  const requestedCwd = typeof input?.cwd === "string" ? input.cwd : null;
  const workspace = resolveWorkspace(requestedCwd);
  if (!workspace) return;
  const workspacePath = workspace.canonical;
  const workspaceId = workspace.id;
  return withReflexStateLock(async () => {
  const state = await readReflexState(workspaceId, workspacePath);
  state.workspaceId = workspaceId;
  const invocationKey = `${eventName}:${toolUse ?? hashIdentifier(input?.turn_id) ?? "unknown"}`;
  const previousInvocation = Date.parse(state.recentInvocations?.[invocationKey]);
  if (Number.isFinite(previousInvocation) && Date.now() - previousInvocation < 10000) return;
  state.recentInvocations ??= {};
  state.recentInvocations[invocationKey] = new Date().toISOString();
  const generationBefore = state.workspaceGeneration;

  if (eventName === "UserPromptSubmit") {
    const mode = promptHintMode();
    let hint = { facts: [], text: null };
    try {
      hint = mode === "off" ? hint : selectPromptHint(state, { session, prompt: input?.prompt, cwd: workspacePath });
    } catch {
      hint = { facts: [], text: null };
    }
    const injected = mode === "inject" && Boolean(hint.text);
    await writeReflexState(state, workspacePath);
    await appendReflexEvent({
      schema: 2,
      reflexRuntime: REFLEX_RUNTIME,
      at: new Date().toISOString(),
      event: eventName,
      session,
      turn: hashIdentifier(input?.turn_id),
      workspaceId,
      workspaceGeneration: state.workspaceGeneration,
      promptFingerprint: fingerprint(input?.prompt),
      promptLength: typeof input?.prompt === "string" ? input.prompt.length : 0,
      hintMode: mode,
      hintCandidate: hint.facts.length > 0,
      hintInjected: injected,
      hintFacts: hint.facts.map((fact) => fact.kind),
      hintBytes: injected ? Buffer.byteLength(hint.text) : 0,
    }, workspacePath);
    return injected ? userPromptHookOutput(hint.text) : null;
  }

  const operations = classification.operations.map(operationTelemetry);
  let hookResponse = null;
  let actualReuseDelivery = null;
  let compoundReuse = null;
  let evidenceStorage = null;

  if (eventName === "PreToolUse") {
    let jevAttempted = false;
    let pendingMetadata = {};
    const compound = compoundOperation(classification, command);
    if (compound) {
      compoundReuse = safePlanActualReuse(state, { operation: compound, session, commandHash: fingerprint(safeCompoundIdentity(classification, command)) });
      if (compoundReuse.outcome === "actual_reuse") {
        pendingMetadata = { actualReuse: { key: compoundReuse.key, evidenceGeneration: compoundReuse.evidenceGeneration, valueBytes: compoundReuse.valueBytes } };
        hookResponse = preToolUseRewrite(compoundReuse.updatedCommand);
      }
    } else if (classification.compound) {
      compoundReuse = {
        outcome: "not_candidate",
        reason: !classification.safeCompound ? "unsafe_compound"
          : classification.operations.some((item) => item.access !== "read-only") ? "compound_not_read_only"
            : "compound_has_unsupported_operation",
      };
    }
    for (let index = 0; index < classification.operations.length; index += 1) {
      const operation = classification.operations[index];
      const commandHash = operations[index].commandHash;
      operations[index].shadow = deterministicShadow(state, { operation, session, commandHash });
      if (classification.compound) {
        operations[index].actualReuse = {
          outcome: compoundReuse?.outcome === "actual_reuse" ? "covered_by_compound_cache" : "not_candidate",
          reason: compoundReuse?.outcome === "actual_reuse" ? "served_by_compound_cache" : "compound_component",
        };
      } else if (classification.operations.length === 1) {
        {
          const reuse = safePlanActualReuse(state, { operation, session, commandHash, cwd: workspacePath });
          operations[index].actualReuse = {
            outcome: reuse.outcome, reason: reuse.reason ?? null,
            evidenceGeneration: reuse.evidenceGeneration ?? null,
            evidenceTimestamp: reuse.evidenceTimestamp ?? null,
          };
          if (reuse.outcome === "actual_reuse") {
            pendingMetadata = { actualReuse: { key: reuse.key, evidenceGeneration: reuse.evidenceGeneration, valueBytes: reuse.valueBytes } };
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
    recordPending(state, toolUse, new Date().toISOString(), {
      ...pendingMetadata,
      fileGenerations: { ...state.fileGenerations },
      allFilesGeneration: state.allFilesGeneration,
    });
    await writeReflexState(state, workspacePath);
  } else {
    const response = input?.tool_response;
    const pending = consumePending(state, toolUse);
    const observationGeneration = Number.isInteger(pending?.workspaceGeneration) ? pending.workspaceGeneration : state.workspaceGeneration;
    const observationGenerations = pending?.generations ?? { ...state.generations };
    const reused = Boolean(pending?.actualReuse);
    if (reused) {
      actualReuseDelivery = { ...pending.actualReuse, success: responseSucceeded(response) };
    }
    const invalidated = reused ? [] : invalidationDomains(classification, toolName);
    advanceGenerations(state, invalidated);
    if (invalidated.includes("workspace")) {
      advanceFileGenerations(state, editedFileKeys(toolName, input?.tool_input, workspacePath));
    }
    const compound = compoundOperation(classification, command);
    if (!reused && responseSucceeded(response) && (compound || (!classification.compound && classification.operations.length === 1 && classification.operations[0].eligible))) {
      const observedOperation = compound ?? classification.operations[0];
      const fileRead = !compound && observedOperation.key === "fs.read"
        ? fullFileReadInfo(observedOperation.command, workspacePath) : null;
      const fileKey = fileRead?.key ?? null;
      evidenceStorage = outputStorageReason(observedOperation, observedOperation.command, responseOutput(response));
      state.evidence.push(evidenceFromObservation({
        operation: observedOperation, command: observedOperation.command,
        commandHash: compound ? fingerprint(safeCompoundIdentity(classification, command)) : null,
        output: responseOutput(response), at: new Date().toISOString(), session, tool: toolName,
        generations: observationGenerations,
        generationDomains: compound ? compoundGenerationDomains(classification) : null,
        workspaceGeneration: observationGeneration, workspaceId,
        fileKey,
        fileFreshness: fileRead ? fileFreshness(fileRead.path) : null,
        fileGeneration: fileKey ? (pending?.fileGenerations?.[fileKey] ?? state.fileGenerations?.[fileKey] ?? 0) : null,
        allFilesGeneration: fileKey ? (pending?.allFilesGeneration ?? state.allFilesGeneration ?? 0) : null,
      }));
    }
    await writeReflexState(state, workspacePath);
  }

  await appendReflexEvent({
    schema: 2,
    reflexRuntime: REFLEX_RUNTIME,
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
    invalidationDomains: actualReuseDelivery ? [] : invalidationDomains(classification, toolName),
    operations,
    compoundReuse: compoundReuse ? {
      outcome: compoundReuse.outcome, reason: compoundReuse.reason ?? null,
      evidenceGeneration: compoundReuse.evidenceGeneration ?? null,
    } : null,
    actualReuseDelivery,
    evidenceStorage,
    generationBefore,
    generationAfter: state.workspaceGeneration,
    session,
    turn: hashIdentifier(input?.turn_id),
    toolUse,
    permissionMode: typeof input?.permission_mode === "string" ? input.permission_mode : null,
    responseShape: eventName === "PostToolUse" ? responseShape(input?.tool_response) : null,
  }, workspacePath);
  return hookResponse;
  }, workspacePath);
}

try {
  const response = await main();
  if (response) process.stdout.write(JSON.stringify(response));
} catch {
  // Observation and shadow hooks must always fail open.
}
