import { createHash } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export function globalDataRoot(env = process.env) {
  const configured = env.MODEL_SWITCH_GLOBAL_HOME?.trim();
  return path.resolve(configured || path.join(os.homedir(), ".codex", "model-switch-global"));
}

export function resolveWorkspace(cwd, env = process.env) {
  if (typeof cwd !== "string" || !cwd.trim() || !path.isAbsolute(cwd)) return null;
  try {
    const canonical = realpathSync.native(path.resolve(cwd));
    if (!statSync(canonical).isDirectory()) return null;
    const normalized = process.platform === "win32" ? canonical.toLowerCase() : canonical;
    const id = createHash("sha256").update(normalized).digest("hex").slice(0, 24);
    const directory = path.join(globalDataRoot(env), "workspaces", id);
    return { id, canonical, normalized, directory,
      state: path.join(directory, "state.json"), events: path.join(directory, "events.jsonl") };
  } catch {
    return null;
  }
}

export async function knownWorkspaces(env = process.env) {
  const root = path.join(globalDataRoot(env), "workspaces");
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory() && /^[0-9a-f]{24}$/.test(entry.name))
      .map((entry) => ({ id: entry.name, directory: path.join(root, entry.name),
        state: path.join(root, entry.name, "state.json"), events: path.join(root, entry.name, "events.jsonl") }));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}
