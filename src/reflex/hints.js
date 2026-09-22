import { isValidReusableValue } from "./reuse.js";
import { evidenceIsCurrent } from "./state.js";

const FACTS = [
  ["git.root", "repo_root"],
  ["git.branch.current", "branch"],
  ["git.head", "head"],
];

const WORKSPACE_INTENT = /\b(repo(?:sitory)?|git|branch|commit|code|project|file|test|build|deploy|implement|fix|update|change|review|inspect|readme|docs?|script|hook|npm|node|proyecto|archivo|prueba|rama|c[oó]digo|implementar|corregir|actualizar|revisar)\b/i;

export function promptHintMode(value = process.env.MODEL_SWITCH_PROMPT_HINT_MODE) {
  return ["off", "observe", "inject"].includes(value) ? value : "observe";
}

function latestFreshEvidence(state, { kind, session, nowMs, maxAgeMs }) {
  return [...state.evidence].reverse().find((item) =>
    item.kind === kind &&
    item.session === session &&
    evidenceIsCurrent(state, item) &&
    item.workspace?.id === state.workspaceId &&
    item.repo?.id === state.workspaceId &&
    Number.isFinite(Date.parse(item.timestamp)) &&
    nowMs - Date.parse(item.timestamp) >= 0 &&
    nowMs - Date.parse(item.timestamp) <= maxAgeMs &&
    isValidReusableValue(kind, item.value)
  ) ?? null;
}

function latestWorkingTreeEvidence(state, { session, nowMs, maxAgeMs }) {
  return [...state.evidence].reverse().find((item) =>
    ["git.status.short", "git.status.porcelain"].includes(item.kind) &&
    item.session === session && evidenceIsCurrent(state, item) &&
    item.workspace?.id === state.workspaceId && item.repo?.id === state.workspaceId &&
    typeof item.value === "string" &&
    Number.isFinite(Date.parse(item.timestamp)) &&
    nowMs - Date.parse(item.timestamp) >= 0 && nowMs - Date.parse(item.timestamp) <= maxAgeMs
  ) ?? null;
}

export function selectPromptHint(state, {
  session,
  prompt,
  nowMs = Date.now(),
  maxAgeMs = Number(process.env.MODEL_SWITCH_PROMPT_HINT_MAX_AGE_MS ?? 300000),
} = {}) {
  if (!state || !Array.isArray(state.evidence) || typeof prompt !== "string" || !prompt.trim()) {
    return { facts: [], text: null };
  }
  const workspaceRelevant = WORKSPACE_INTENT.test(prompt);
  const facts = [];
  for (const [kind, label] of FACTS) {
    if (kind !== "git.root" && !workspaceRelevant) continue;
    const evidence = latestFreshEvidence(state, { kind, session, nowMs, maxAgeMs });
    if (evidence) facts.push({ kind, label, value: evidence.value, timestamp: evidence.timestamp });
  }
  if (workspaceRelevant) {
    const status = latestWorkingTreeEvidence(state, { session, nowMs, maxAgeMs });
    if (status) {
      const lines = status.value.split(/\r?\n/).filter(Boolean);
      facts.push({ kind: "git.working-tree", label: "working_tree", value: lines.length === 0 ? "clean" : "dirty", timestamp: status.timestamp });
      facts.push({ kind: "git.changed-files", label: "changed_files", value: String(lines.length), timestamp: status.timestamp });
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
