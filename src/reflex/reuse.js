import { evidenceIsCurrent, exactEvidence } from "./state.js";

const SCALAR_COMMANDS = new Map([
  ["git rev-parse HEAD", "git.head"],
  ["git branch --show-current", "git.branch.current"],
  ["git rev-parse --show-toplevel", "git.root"],
]);

const OUTPUT_KINDS = new Set([
  "git.status.short", "git.status.porcelain", "git.diff.worktree", "git.diff.cached",
  "fs.read", "fs.search", "shell.compound.readonly",
]);

function simpleFullFileRead(command) {
  if (/[|><;&`$\r\n{}]/.test(command) || /[*?]/.test(command)) return false;
  if (/^(cat|type)\s+(?:"[^"]+"|'[^']+'|\S+)$/i.test(command)) return true;
  if (!/^(get-content|gc)\b/i.test(command)) return false;
  if (/\s-(?:totalcount|head|tail|readcount|filter|include|exclude|wait)\b/i.test(command)) return false;
  const withoutFlags = command
    .replace(/\s-(?:raw|force)\b/gi, "")
    .replace(/\s-(?:literalpath|path)\s+/i, " ")
    .trim();
  return /^(get-content|gc)\s+(?:"[^"]+"|'[^']+'|\S+)$/i.test(withoutFlags);
}

export function isActualReuseCandidate(operation) {
  if (operation?.eligible !== true) return false;
  if (SCALAR_COMMANDS.get(operation.command) === operation.key) return true;
  if (!OUTPUT_KINDS.has(operation.key)) return false;
  if (operation.key === "fs.read") return simpleFullFileRead(operation.command);
  return true;
}

export function reuseCandidateReason(operation) {
  if (operation?.eligible !== true) return "ineligible_operation";
  if (SCALAR_COMMANDS.get(operation.command) === operation.key) return null;
  if (!OUTPUT_KINDS.has(operation.key)) return "unsupported_kind";
  if (operation.key === "fs.read" && !simpleFullFileRead(operation.command)) return "partial_file_read";
  return null;
}

export function isValidReusableValue(kind, value) {
  if (typeof value !== "string" || value.includes("\0")) return false;
  if (kind === "git.head") return !/[\r\n]/.test(value) && /^[0-9a-f]{40,64}$/i.test(value);
  if (kind === "git.branch.current") {
    return !/[\r\n]/.test(value) && (value === "" || (value.length <= 255 && /^[A-Za-z0-9._/-]+$/.test(value) && !value.includes("..")));
  }
  if (kind === "git.root") return !/[\r\n]/.test(value) && value.length > 0 && value.length <= 4096;
  if (OUTPUT_KINDS.has(kind)) return Buffer.byteLength(value) <= 262144;
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
    return `try { [Console]::Out.Write(${quotePowerShell(value)}) } catch { ${originalCommand} }`;
  }
  return `printf '%s' ${quotePosix(value)} || ${originalCommand}`;
}

export function planActualReuse(state, { operation, session, commandHash, platform = process.platform }) {
  const candidateReason = reuseCandidateReason(operation);
  if (candidateReason) return { outcome: "not_candidate", reason: candidateReason };
  const evidence = exactEvidence(state, { session, commandHash });
  if (!evidence) return { outcome: "fallback", reason: "missing_evidence" };
  if (!evidenceIsCurrent(state, evidence)) {
    return { outcome: "fallback", reason: "stale_after_mutation", evidenceGeneration: evidence.generation ?? evidence.workspaceGeneration };
  }
  if (evidence.workspace?.id !== state.workspaceId || (operation.family === "git" && evidence.repo?.id !== state.workspaceId)) {
    return { outcome: "fallback", reason: "workspace_mismatch" };
  }
  if (!isValidReusableValue(operation.key, evidence.value)) return { outcome: "fallback", reason: "invalid_evidence" };
  return {
    outcome: "actual_reuse", reason: "fresh_deterministic_evidence", key: operation.key,
    evidenceTimestamp: evidence.timestamp,
    evidenceGeneration: evidence.generation ?? evidence.workspaceGeneration,
    generationDomain: evidence.generationDomain ?? null,
    updatedCommand: outputCommand(evidence.value, operation.command, platform),
  };
}

export function safePlanActualReuse(state, context) {
  try {
    return planActualReuse(state, context);
  } catch (error) {
    return { outcome: "fallback", reason: "internal_error", errorKind: error instanceof Error ? error.name : "UnknownError" };
  }
}

export function preToolUseRewrite(updatedCommand) {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse", permissionDecision: "allow",
      updatedInput: { command: updatedCommand },
    },
  };
}
