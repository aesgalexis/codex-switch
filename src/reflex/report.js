import path from "node:path";
import { fileURLToPath } from "node:url";
import { eventLogPath, readReflexEvents } from "./events.js";
import { summarizeReflexEvents } from "./stats.js";
import { knownWorkspaces, resolveWorkspace } from "./workspace.js";

const additive = ["totalEvents", "totalToolCalls", "totalReadOnlyCalls", "readOnlyRecognized", "mutatingToolCalls",
  "unknownToolCalls", "compoundToolCalls", "actualReuse", "operationsServedFromCache", "filesystemReadsAvoided",
  "statusDiffOperationsAvoided", "compoundExecutionsAvoided", "bytesServedFromEvidence", "falseReuseErrors"];

export async function buildReport({ cwd = process.cwd(), workspace = null, all = false } = {}) {
  if (!all) {
    const resolved = resolveWorkspace(workspace ? path.resolve(workspace) : cwd);
    if (!resolved) throw new Error("workspace path is missing or cannot be resolved safely");
    return { scope: "workspace", workspaceId: resolved.id, workspace: resolved.canonical,
      statePath: resolved.state, eventLog: resolved.events,
      stats: summarizeReflexEvents(await readReflexEvents(eventLogPath(resolved.canonical))) };
  }
  const entries = await knownWorkspaces();
  const workspaces = {};
  const aggregate = Object.fromEntries(additive.map((key) => [key, 0]));
  for (const entry of entries) {
    const stats = summarizeReflexEvents(await readReflexEvents(entry.events));
    workspaces[entry.id] = stats;
    for (const key of additive) aggregate[key] += stats[key] ?? 0;
  }
  return { scope: "all", workspaceCount: entries.length, aggregate, workspaces };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2); const all = args.includes("--all");
  const index = args.indexOf("--workspace"); const workspace = index >= 0 ? args[index + 1] : null;
  try { process.stdout.write(JSON.stringify(await buildReport({ all, workspace }), null, 2) + "\n"); }
  catch (error) { process.stderr.write(`reflex:stats: ${error.message}\n`); process.exitCode = 1; }
}
