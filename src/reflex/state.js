import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { eventLogPath } from "./events.js";
import { fingerprint, redactCommand } from "./privacy.js";

export function statePath() {
  return path.join(path.dirname(eventLogPath()), "reflex-state.json");
}

export function emptyState(workspaceId = null) {
  return { schema: 1, workspaceGeneration: 0, workspaceId, updatedAt: null, evidence: [], pending: {} };
}

export async function readReflexState(workspaceId = null) {
  try {
    const parsed = JSON.parse(await readFile(statePath(), "utf8"));
    if (parsed?.schema !== 1) return emptyState(workspaceId);
    if (workspaceId && parsed.workspaceId && parsed.workspaceId !== workspaceId) return emptyState(workspaceId);
    return { ...parsed, evidence: Array.isArray(parsed.evidence) ? parsed.evidence : [], pending: parsed.pending && typeof parsed.pending === "object" ? parsed.pending : {} };
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return emptyState(workspaceId);
    throw error;
  }
}

export async function writeReflexState(state) {
  const target = statePath();
  await mkdir(path.dirname(target), { recursive: true });
  const pendingEntries = Object.entries(state.pending ?? {}).slice(-200);
  const bounded = { ...state, evidence: state.evidence.slice(-500), pending: Object.fromEntries(pendingEntries), updatedAt: new Date().toISOString() };
  await writeFile(target, JSON.stringify(bounded, null, 2) + "\n", "utf8");
}

export function exactEvidence(state, { session, commandHash }) {
  return [...state.evidence].reverse().find((item) => item.session === session && item.provenance.commandHash === commandHash && (!state.workspaceId || item.workspace?.id === state.workspaceId)) ?? null;
}

export function familyEvidence(state, { session, family }) {
  return [...state.evidence].reverse().find((item) => item.session === session && item.provenance.family === family && (!state.workspaceId || item.workspace?.id === state.workspaceId)) ?? null;
}

export function advanceGeneration(state, potentiallyMutating) {
  if (potentiallyMutating) state.workspaceGeneration += 1;
  return state.workspaceGeneration;
}

export function recordPending(state, toolUse, at = new Date().toISOString()) {
  if (!toolUse) return;
  state.pending ??= {};
  state.pending[toolUse] = { workspaceGeneration: state.workspaceGeneration, at };
}

export function consumePendingGeneration(state, toolUse) {
  const generation = toolUse ? state.pending?.[toolUse]?.workspaceGeneration : null;
  if (toolUse && state.pending) delete state.pending[toolUse];
  return Number.isInteger(generation) ? generation : state.workspaceGeneration;
}

export function evidenceFromObservation({ operation, command, output, at, session, tool, generation, workspaceId }) {
  const safeValueKinds = new Set(["git.head", "git.root", "git.branch.current", "runtime.node.version", "runtime.npm.version", "workspace.pwd"]);
  const normalizedOutput = typeof output === "string" ? output.trim().slice(0, 16000) : JSON.stringify(output ?? null).slice(0, 16000);
  return {
    kind: operation.key,
    ...(safeValueKinds.has(operation.key) ? { value: redactCommand(normalizedOutput) } : { valueFingerprint: fingerprint(normalizedOutput), valueBytes: Buffer.byteLength(normalizedOutput) }),
    timestamp: at,
    session,
    provenance: { tool, family: operation.family, commandKey: operation.key, commandHash: fingerprint(command), responseFingerprint: fingerprint(normalizedOutput) },
    workspaceGeneration: generation,
    workspace: { id: workspaceId },
    repo: operation.family === "git" ? { id: workspaceId } : null,
  };
}
