import { exactEvidence } from "./state.js";

const REUSABLE_COMMANDS = new Map([
  ["git rev-parse HEAD", "git.head"],
  ["git branch --show-current", "git.branch.current"],
  ["git rev-parse --show-toplevel", "git.root"],
]);

export function isActualReuseCandidate(operation) {
  return operation?.eligible === true && REUSABLE_COMMANDS.get(operation.command) === operation.key;
}

export function isValidReusableValue(kind, value) {
  if (typeof value !== "string" || value.includes("\0") || /[\r\n]/.test(value)) return false;
  if (kind === "git.head") return /^[0-9a-f]{40,64}$/i.test(value);
  if (kind === "git.branch.current") {
    return value === "" || (value.length <= 255 && /^[A-Za-z0-9._/-]+$/.test(value) && !value.includes(".."));
  }
  if (kind === "git.root") return value.length > 0 && value.length <= 4096;
  return false;
}

function quotePowerShell(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function quotePosix(value) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function outputCommand(value, originalCommand, platform = process.platform) {
  if (platform === "win32") {
    return `try { Write-Output ${quotePowerShell(value)} } catch { ${originalCommand} }`;
  }
  return `printf '%s\\n' ${quotePosix(value)} || ${originalCommand}`;
}

export function planActualReuse(state, { operation, session, commandHash, platform = process.platform }) {
  if (!isActualReuseCandidate(operation)) return { outcome: "not_candidate" };
  const evidence = exactEvidence(state, { session, commandHash });
  if (!evidence) return { outcome: "fallback", reason: "missing_evidence" };
  if (evidence.workspaceGeneration !== state.workspaceGeneration) {
    return { outcome: "fallback", reason: "stale_after_mutation", evidenceGeneration: evidence.workspaceGeneration };
  }
  if (evidence.workspace?.id !== state.workspaceId || evidence.repo?.id !== state.workspaceId) {
    return { outcome: "fallback", reason: "workspace_mismatch" };
  }
  if (!isValidReusableValue(operation.key, evidence.value)) return { outcome: "fallback", reason: "invalid_evidence" };
  return {
    outcome: "actual_reuse",
    reason: "fresh_deterministic_evidence",
    key: operation.key,
    evidenceTimestamp: evidence.timestamp,
    evidenceGeneration: evidence.workspaceGeneration,
    updatedCommand: outputCommand(evidence.value, operation.command, platform),
  };
}

export function safePlanActualReuse(state, context) {
  try {
    return planActualReuse(state, context);
  } catch (error) {
    return {
      outcome: "fallback",
      reason: "internal_error",
      errorKind: error instanceof Error ? error.name : "UnknownError",
    };
  }
}

export function preToolUseRewrite(updatedCommand) {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      updatedInput: { command: updatedCommand },
    },
  };
}
