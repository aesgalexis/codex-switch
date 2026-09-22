import { isValidReusableValue } from "./reuse.js";
import { evidenceIsCurrent } from "./state.js";

const FACTS = [
  ["git.root", "repo_root"],
  ["git.branch.current", "branch"],
  ["git.head", "head"],
];

const WORKSPACE_INTENT = /\b(repo(?:sitory)?|git|branch|commit|code|project|file|test|build|deploy|implement|fix|update|change|review|inspect|readme|docs?|script|hook|npm|node|proyecto|archivo|prueba|rama|c[oó]digo|implementar|corregir|actualizar|revisar)\b/i;
const SENSITIVE_PATH = /(?:^|[\\/])(?:\.env(?:\.|$)|\.npmrc$|\.pypirc$|\.netrc$|id_(?:rsa|dsa|ecdsa|ed25519)$|credentials(?:\.json)?$|service[-_]?account(?:\.json)?$)|\.(?:pem|p12|pfx|key)$/i;
const MAX_CHANGED_FILES = 5;

export function promptHintMode(value = process.env.MODEL_SWITCH_PROMPT_HINT_MODE) {
  return ["off", "observe", "inject"].includes(value) ? value : "inject";
}

function latestFreshEvidence(state, { kind, nowMs, maxAgeMs }) {
  return [...state.evidence].reverse().find((item) =>
    item.kind === kind &&
    evidenceIsCurrent(state, item) &&
    item.workspace?.id === state.workspaceId &&
    item.repo?.id === state.workspaceId &&
    Number.isFinite(Date.parse(item.timestamp)) &&
    nowMs - Date.parse(item.timestamp) >= 0 &&
    nowMs - Date.parse(item.timestamp) <= maxAgeMs &&
    isValidReusableValue(kind, item.value)
  ) ?? null;
}

function latestWorkingTreeEvidence(state, { nowMs, maxAgeMs }) {
  return [...state.evidence].reverse().find((item) =>
    ["git.status.short", "git.status.porcelain"].includes(item.kind) &&
    evidenceIsCurrent(state, item) &&
    item.workspace?.id === state.workspaceId && item.repo?.id === state.workspaceId &&
    typeof item.value === "string" &&
    Number.isFinite(Date.parse(item.timestamp)) &&
    nowMs - Date.parse(item.timestamp) >= 0 && nowMs - Date.parse(item.timestamp) <= maxAgeMs
  ) ?? null;
}

function changedFiles(status) {
  const paths = status.split(/\r?\n/).filter(Boolean).map((line) => {
    const raw = line.length > 3 ? line.slice(3).trim() : "";
    const renamed = raw.includes(" -> ") ? raw.split(" -> ").at(-1) : raw;
    return renamed.replace(/^"|"$/g, "");
  }).filter((item) => item && item.length <= 260 && !/[\r\n\0]/.test(item) && !SENSITIVE_PATH.test(item));
  if (paths.length === 0) return null;
  const visible = paths.slice(0, MAX_CHANGED_FILES);
  return `${visible.join(", ")}${paths.length > visible.length ? ` (+${paths.length - visible.length} more)` : ""}`;
}

export function selectPromptHint(state, {
  session,
  prompt,
  cwd = null,
  nowMs = Date.now(),
  maxAgeMs = Number(process.env.MODEL_SWITCH_PROMPT_HINT_MAX_AGE_MS ?? 300000),
} = {}) {
  if (!state || !Array.isArray(state.evidence) || typeof prompt !== "string" || !prompt.trim()) {
    return { facts: [], text: null };
  }
  const workspaceRelevant = WORKSPACE_INTENT.test(prompt);
  const facts = [];
  if (workspaceRelevant && typeof cwd === "string" && cwd.length > 0 && cwd.length <= 4096 && !/[\r\n\0]/.test(cwd)) {
    facts.push({ kind: "workspace.cwd", label: "workspace_cwd", value: cwd, timestamp: null });
  }
  for (const [kind, label] of FACTS) {
    if (!workspaceRelevant) continue;
    const evidence = latestFreshEvidence(state, { kind, nowMs, maxAgeMs });
    if (evidence) facts.push({ kind, label, value: evidence.value, timestamp: evidence.timestamp });
  }
  if (workspaceRelevant) {
    const status = latestWorkingTreeEvidence(state, { nowMs, maxAgeMs });
    if (status) {
      const lines = status.value.split(/\r?\n/).filter(Boolean);
      facts.push({ kind: "git.working-tree", label: "working_tree", value: lines.length === 0 ? "clean" : "dirty", timestamp: status.timestamp });
      const files = changedFiles(status.value);
      if (files) facts.push({ kind: "git.changed-files", label: "modified", value: files, timestamp: status.timestamp });
    }
  }
  if (facts.length === 0) return { facts, text: null };
  const lines = facts.map((fact) => `${fact.label}: ${fact.value}`);
  return {
    facts,
    text: [
      `model-switch fresh workspace facts (generation ${state.workspaceGeneration}):`,
      ...lines,
      "Treat these as current orientation; verify only if the task or a later mutation requires it.",
    ].join("\n"),
  };
}

export function userPromptHookOutput(text) {
  return {
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: text,
    },
  };
}
