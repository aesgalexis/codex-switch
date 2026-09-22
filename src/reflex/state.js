import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { eventLogPath } from "./events.js";
import { fingerprint, redactCommand } from "./privacy.js";

const DEFAULT_CACHE_MAX_BYTES = 32768;
const IDENTITY_KINDS = new Set(["git.head", "git.root", "git.branch.current"]);
const EXTERNAL_FAMILIES = new Set(["gh", "firebase", "gcloud"]);
const CACHEABLE_OUTPUT_KINDS = new Set([
  "git.status.short", "git.status.porcelain", "git.diff.worktree", "git.diff.cached",
  "fs.read", "fs.search", "shell.compound.readonly",
]);

export function statePath() {
  return path.join(path.dirname(eventLogPath()), "reflex-state.json");
}

export function emptyState(workspaceId = null) {
  return {
    schema: 2, workspaceGeneration: 0,
    generations: { identity: 0, workspace: 0, external: 0 },
    workspaceId, updatedAt: null, evidence: [], pending: {},
  };
}

function normalizedState(parsed, workspaceId) {
  const legacy = Number.isInteger(parsed.workspaceGeneration) ? parsed.workspaceGeneration : 0;
  return {
    ...parsed, schema: 2, workspaceGeneration: legacy,
    generations: {
      identity: Number.isInteger(parsed.generations?.identity) ? parsed.generations.identity : legacy,
      workspace: Number.isInteger(parsed.generations?.workspace) ? parsed.generations.workspace : legacy,
      external: Number.isInteger(parsed.generations?.external) ? parsed.generations.external : legacy,
    },
    workspaceId: parsed.workspaceId ?? workspaceId,
    evidence: Array.isArray(parsed.evidence) ? parsed.evidence : [],
    pending: parsed.pending && typeof parsed.pending === "object" ? parsed.pending : {},
  };
}

export async function readReflexState(workspaceId = null) {
  try {
    const parsed = JSON.parse(await readFile(statePath(), "utf8"));
    if (![1, 2].includes(parsed?.schema)) return emptyState(workspaceId);
    if (workspaceId && parsed.workspaceId && parsed.workspaceId !== workspaceId) return emptyState(workspaceId);
    return normalizedState(parsed, workspaceId);
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return emptyState(workspaceId);
    throw error;
  }
}

export async function writeReflexState(state) {
  const target = statePath();
  await mkdir(path.dirname(target), { recursive: true });
  const bounded = {
    ...state, schema: 2, evidence: state.evidence.slice(-500),
    pending: Object.fromEntries(Object.entries(state.pending ?? {}).slice(-200)),
    updatedAt: new Date().toISOString(),
  };
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(bounded, null, 2) + "\n", "utf8");
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function withReflexStateLock(work) {
  const lockPath = `${statePath()}.lock`;
  await mkdir(path.dirname(lockPath), { recursive: true });
  let handle;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      handle = await open(lockPath, "wx");
      break;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  if (!handle) throw new Error("reflex state lock unavailable");
  try { return await work(); }
  finally {
    await handle.close();
    await rm(lockPath, { force: true });
  }
}

export function evidenceDomain(kind, family = null) {
  if (IDENTITY_KINDS.has(kind)) return "identity";
  if (EXTERNAL_FAMILIES.has(family) || /^(gh|firebase|gcloud)\./.test(kind ?? "")) return "external";
  return "workspace";
}

export function currentGeneration(state, domain) {
  return state.generations?.[domain] ?? state.workspaceGeneration ?? 0;
}

export function evidenceIsCurrent(state, evidence) {
  if (evidence.generations && typeof evidence.generations === "object") {
    return Object.entries(evidence.generations).every(([domain, observed]) => observed === currentGeneration(state, domain));
  }
  const domain = evidence.generationDomain ?? evidenceDomain(evidence.kind, evidence.provenance?.family);
  const observed = Number.isInteger(evidence.generation) ? evidence.generation : evidence.workspaceGeneration;
  return observed === currentGeneration(state, domain);
}

export function exactEvidence(state, { session, commandHash }) {
  return [...state.evidence].reverse().find((item) =>
    item.session === session && item.provenance?.commandHash === commandHash &&
    (!state.workspaceId || item.workspace?.id === state.workspaceId)
  ) ?? null;
}

export function familyEvidence(state, { session, family }) {
  return [...state.evidence].reverse().find((item) =>
    item.session === session && item.provenance?.family === family &&
    (!state.workspaceId || item.workspace?.id === state.workspaceId)
  ) ?? null;
}

export function advanceGenerations(state, domains = []) {
  const unique = [...new Set(domains)];
  if (unique.length === 0) return state.generations;
  state.workspaceGeneration = (state.workspaceGeneration ?? 0) + 1;
  state.generations ??= { identity: 0, workspace: 0, external: 0 };
  for (const domain of unique) state.generations[domain] = (state.generations[domain] ?? 0) + 1;
  return state.generations;
}

export function advanceGeneration(state, potentiallyMutating) {
  if (potentiallyMutating) advanceGenerations(state, ["identity", "workspace", "external"]);
  return state.workspaceGeneration;
}

export function recordPending(state, toolUse, at = new Date().toISOString(), metadata = {}) {
  if (!toolUse) return;
  state.pending ??= {};
  state.pending[toolUse] = {
    workspaceGeneration: state.workspaceGeneration,
    generations: { ...state.generations }, at, ...metadata,
  };
}

export function consumePending(state, toolUse) {
  const pending = toolUse ? state.pending?.[toolUse] ?? null : null;
  if (toolUse && state.pending) delete state.pending[toolUse];
  return pending;
}

export function consumePendingGeneration(state, toolUse) {
  const generation = consumePending(state, toolUse)?.workspaceGeneration;
  return Number.isInteger(generation) ? generation : state.workspaceGeneration;
}

function cacheLimit() {
  const value = Number(process.env.MODEL_SWITCH_REFLEX_CACHE_MAX_BYTES ?? DEFAULT_CACHE_MAX_BYTES);
  return Number.isFinite(value) && value >= 0 ? Math.min(value, 262144) : DEFAULT_CACHE_MAX_BYTES;
}

function sensitiveCommand(command) {
  return /(?:^|[\s"'\\/])(?:\.env(?:\.[^\s"']*)?|\.npmrc|\.pypirc|\.netrc|id_(?:rsa|dsa|ecdsa|ed25519)|credentials(?:\.json)?|service[-_ ]account(?:\.json)?|[^\s"']*\.(?:pem|p12|pfx|key))(?:[\s"']|$)|authorization|credential|secret|token|password|private[-_ ]?key/i.test(command);
}

function sensitiveOutput(output) {
  return /-----BEGIN [A-Z ]*PRIVATE KEY-----|authorization\s*:|bearer\s+[A-Za-z0-9._~+/-]{12,}|(?:api[_-]?key|token|password|secret)\s*[:=]\s*\S+/i.test(output);
}

export function cacheableOutput(operation, command, output) {
  if (!CACHEABLE_OUTPUT_KINDS.has(operation.key) || typeof output !== "string") return null;
  const bytes = Buffer.byteLength(output);
  if (bytes > cacheLimit() || output.includes("\0") || sensitiveCommand(command) || sensitiveOutput(output)) return null;
  return { value: output, valueBytes: bytes };
}

export function outputStorageReason(operation, command, output) {
  if (!CACHEABLE_OUTPUT_KINDS.has(operation.key)) return "unsupported_kind";
  if (typeof output !== "string") return "missing_output";
  if (Buffer.byteLength(output) > cacheLimit()) return "oversized_output";
  if (output.includes("\0") || sensitiveCommand(command) || sensitiveOutput(output)) return "sensitive_or_invalid_output";
  return "stored";
}

export function evidenceFromObservation({ operation, command, output, at, session, tool, generations, generationDomains, workspaceGeneration, generation, workspaceId }) {
  const scalars = new Set(["git.head", "git.root", "git.branch.current", "runtime.node.version", "runtime.npm.version", "workspace.pwd"]);
  const normalized = typeof output === "string" ? output : JSON.stringify(output ?? null);
  const domain = evidenceDomain(operation.key, operation.family);
  const cached = cacheableOutput(operation, command, normalized);
  const scalar = scalars.has(operation.key) ? redactCommand(normalized.trim().slice(0, 16000)) : null;
  return {
    kind: operation.key,
    ...(scalar != null ? { value: scalar, valueBytes: Buffer.byteLength(scalar) }
      : cached ?? { valueFingerprint: fingerprint(normalized), valueBytes: Buffer.byteLength(normalized) }),
    timestamp: at, session,
    provenance: {
      tool, family: operation.family, commandKey: operation.key,
      commandHash: fingerprint(command), responseFingerprint: fingerprint(normalized),
    },
    generationDomain: domain,
    generation: generations?.[domain] ?? workspaceGeneration ?? generation ?? 0,
    ...(Array.isArray(generationDomains) && generationDomains.length > 0
      ? { generations: Object.fromEntries(generationDomains.map((item) => [item, generations?.[item] ?? workspaceGeneration ?? generation ?? 0])) }
      : {}),
    workspaceGeneration: workspaceGeneration ?? generation ?? 0,
    workspace: { id: workspaceId },
    repo: operation.family === "git" ? { id: workspaceId } : null,
  };
}
