import { copyFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const START = "# >>> model-switch global hooks >>>";
const END = "# <<< model-switch global hooks <<<";
export const engineRoot = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
export const engineScript = path.join(engineRoot, "src", "hooks", "reflex-hook.js");

export function codexHome(env = process.env) {
  return path.resolve(env.CODEX_HOME?.trim() || path.join(os.homedir(), ".codex"));
}

export function globalConfigPath(env = process.env) {
  return path.join(codexHome(env), "config.toml");
}

function tomlLiteral(value) { return `'${value.replaceAll("'", "''")}'`; }

export function managedHookBlock(root = engineRoot) {
  const script = path.join(root, "src", "hooks", "reflex-hook.js");
  const envFile = path.join(root, ".env");
  const command = `node "--env-file-if-exists=${envFile}" "${script}"`;
  const hook = `{ type = "command", command = ${tomlLiteral(command)}, timeout = 5 }`;
  return [START,
    `user_prompt_submit = [{ hooks = [${hook}] }]`,
    `pre_tool_use = [{ matcher = "^(Bash|apply_patch|Edit|Write)$", hooks = [${hook}] }]`,
    `post_tool_use = [{ matcher = "^(Bash|apply_patch|Edit|Write)$", hooks = [${hook}] }]`,
    END].join("\n");
}

export function removeManagedHooks(text) {
  const pattern = new RegExp(`(?:\\r?\\n)?${START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\r?\\n)?`, "g");
  return text.replace(pattern, "\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

export function installIntoConfig(text, root = engineRoot) {
  if (inspectIntegration(text, root).installed && inspectIntegration(text, root).occurrences === 1) return text;
  const clean = removeManagedHooks(text || "");
  const block = managedHookBlock(root);
  const hooksHeader = /^\[hooks\]\s*$/m;
  if (hooksHeader.test(clean)) return clean.replace(hooksHeader, (match) => `${match}\n${block}`);
  const childHeader = /^\[hooks\./m;
  if (childHeader.test(clean)) return clean.replace(childHeader, `[hooks]\n${block}\n\n$&`);
  return `${clean.trimEnd()}\n\n[hooks]\n${block}\n`;
}

export function inspectIntegration(text, root = engineRoot) {
  const occurrences = text.split(START).length - 1;
  const script = path.join(root, "src", "hooks", "reflex-hook.js");
  return { installed: occurrences === 1 && text.includes(script), occurrences,
    conflict: occurrences > 1 || (occurrences === 1 && !text.includes(path.join(root, "src", "hooks", "reflex-hook.js"))) };
}

async function exists(filename) { try { await stat(filename); return true; } catch { return false; } }

async function atomicWrite(filename, content) {
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.model-switch-${process.pid}.tmp`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, filename);
}

export async function installCodexIntegration({ env = process.env, root = engineRoot, now = new Date() } = {}) {
  const script = path.join(root, "src", "hooks", "reflex-hook.js");
  if (!await exists(script)) throw new Error(`model-switch engine missing: ${script}`);
  const config = globalConfigPath(env);
  const original = await readFile(config, "utf8").catch((error) => error?.code === "ENOENT" ? "" : Promise.reject(error));
  const updated = installIntoConfig(original, root);
  if (updated === original) return { changed: false, config, backup: null, engine: script };
  let backup = null;
  if (original) {
    backup = `${config}.model-switch-backup-${now.toISOString().replace(/[:.]/g, "-")}`;
    await copyFile(config, backup);
  }
  await atomicWrite(config, updated);
  return { changed: true, config, backup, engine: script };
}

export async function uninstallCodexIntegration({ env = process.env } = {}) {
  const config = globalConfigPath(env);
  const original = await readFile(config, "utf8").catch((error) => error?.code === "ENOENT" ? "" : Promise.reject(error));
  const updated = removeManagedHooks(original);
  if (!original || updated === original) return { changed: false, config };
  await atomicWrite(config, updated);
  return { changed: true, config };
}
