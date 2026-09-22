import { mkdir, rename, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { knownWorkspaces, resolveWorkspace } from "./workspace.js";

export async function rotateReflexLog({ log, directory = log ? path.dirname(log) : null, now = new Date() } = {}) {
  if (!log || !directory) throw new Error("a resolved workspace event log is required");
  const source = path.resolve(log);
  const base = path.resolve(directory);
  if (path.dirname(source) !== base || path.basename(source) !== "events.jsonl") throw new Error("Refusing to rotate outside a workspace storage directory");
  try { await stat(source); }
  catch (error) {
    if (error?.code === "ENOENT") return { rotated: false, source, destination: null };
    throw error;
  }
  await mkdir(base, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  for (let index = 0; index < 100; index += 1) {
    const destination = path.join(base, `events-${stamp}${index ? `-${index}` : ""}.jsonl`);
    try { await stat(destination); continue; }
    catch (error) { if (error?.code !== "ENOENT") throw error; }
    await rename(source, destination);
    return { rotated: true, source, destination };
  }
  throw new Error("Could not find an unused rotation filename");
}

export async function rotateSelected({ cwd = process.cwd(), workspace = null, all = false } = {}) {
  const targets = all ? await knownWorkspaces() : [resolveWorkspace(workspace ? path.resolve(workspace) : cwd)].filter(Boolean);
  if (!all && targets.length === 0) throw new Error("workspace path is missing or cannot be resolved safely");
  return Promise.all(targets.map((target) => rotateReflexLog({ log: target.events, directory: target.directory })));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2); const all = args.includes("--all");
    const index = args.indexOf("--workspace"); const workspace = index >= 0 ? args[index + 1] : null;
    const results = await rotateSelected({ all, workspace });
    for (const result of results) process.stdout.write(result.rotated ? `Rotated ${result.source} -> ${result.destination}\nEvidence state preserved.\n` : `No event log to rotate: ${result.source}\nEvidence state preserved.\n`);
  } catch (error) {
    process.stderr.write(`reflex:rotate: ${error.message}\n`);
    process.exitCode = 1;
  }
}
