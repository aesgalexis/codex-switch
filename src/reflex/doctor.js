import { spawnSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eventLogPath } from "./events.js";
import { promptHintMode } from "./hints.js";
import { statePath } from "./state.js";
import { REFLEX_RUNTIME } from "./runtime.js";

const projectRoot = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const hookEvents = ["UserPromptSubmit", "PreToolUse", "PostToolUse"];

async function fileInfo(filename) {
  try { return { exists: true, bytes: (await stat(filename)).size }; }
  catch (error) {
    if (error?.code === "ENOENT") return { exists: false, bytes: 0 };
    throw error;
  }
}

function commandVersion(executable, args) {
  const windowsBatch = process.platform === "win32" && executable.toLowerCase().endsWith(".cmd");
  const result = windowsBatch
    ? spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `${executable} ${args.join(" ")}`], { cwd: projectRoot, encoding: "utf8", windowsHide: true, timeout: 3000 })
    : spawnSync(executable, args, { cwd: projectRoot, encoding: "utf8", windowsHide: true, timeout: 3000 });
  return result.status === 0 ? result.stdout.trim() || result.stderr.trim() : null;
}

export async function diagnoseReflex({ root = projectRoot, log = eventLogPath(), stateFile = statePath(), env = process.env } = {}) {
  const warnings = [];
  const hooksFile = path.join(root, ".codex", "hooks.json");
  const hookScript = path.join(root, "src", "hooks", "reflex-hook.js");
  const hookScriptExists = (await fileInfo(hookScript)).exists;
  if (!hookScriptExists) warnings.push("Project hook script missing: src/hooks/reflex-hook.js");
  let hooks = null;
  try { hooks = JSON.parse(await readFile(hooksFile, "utf8")); }
  catch { warnings.push("Project hooks missing or invalid: .codex/hooks.json"); }
  const hookStatus = Object.fromEntries(hookEvents.map((name) => {
    const configured = Array.isArray(hooks?.hooks?.[name]) && hooks.hooks[name].some((entry) =>
      Array.isArray(entry.hooks) && entry.hooks.some((hook) =>
        hook.type === "command" && typeof (process.platform === "win32" ? hook.commandWindows : hook.command) === "string" &&
        (process.platform === "win32" ? hook.commandWindows : hook.command).includes("reflex-hook.js")));
    if (!configured) warnings.push(`${name} hook not configured`);
    return [name, configured];
  }));
  const logInfo = await fileInfo(log);
  const stateInfo = await fileInfo(stateFile);
  let stateReadable = false;
  let generation = null;
  let evidence = null;
  if (stateInfo.exists) {
    try {
      const parsed = JSON.parse(await readFile(stateFile, "utf8"));
      if (![1, 2].includes(parsed?.schema) || !Number.isInteger(parsed.workspaceGeneration) || !Array.isArray(parsed.evidence)) throw new Error("invalid state shape");
      stateReadable = true;
      generation = parsed.workspaceGeneration;
      evidence = parsed.evidence.length;
    } catch { warnings.push("Evidence state cannot be read correctly"); }
  } else warnings.push("Evidence state does not exist yet");
  if (!logInfo.exists) warnings.push("Event log does not exist yet");
  const codex = commandVersion(process.platform === "win32" ? "codex.cmd" : "codex", ["--version"]);
  if (!codex) warnings.push("Codex CLI not found or did not respond");
  const branch = commandVersion("git", ["branch", "--show-current"]);
  if (branch == null) warnings.push("Git branch could not be read");
  const jevKey = Boolean(env.TYPESAFE_API_KEY?.trim());
  const jevShadow = env.MODEL_SWITCH_REFLEX_JEV_SHADOW !== "off";
  return { runtime: REFLEX_RUNTIME, codex, branch: branch || "(detached/unknown)", hooksFile, hookScriptExists,
    hooks: hookStatus, promptHints: promptHintMode(env.MODEL_SWITCH_PROMPT_HINT_MODE),
    jev: jevKey ? (jevShadow ? "configured (shadow only)" : "key present, shadow off") : "unavailable (no API key)",
    log: { path: log, ...logInfo }, state: { path: stateFile, ...stateInfo, readable: stateReadable, generation, evidence }, warnings };
}

export function formatDoctor(report) {
  const size = (file) => file.exists ? `${(file.bytes / 1024).toFixed(1)} KiB` : "missing";
  return [
    `model-switch ${report.runtime} | Codex ${report.codex ?? "missing"} | branch ${report.branch}`,
    `Hooks: script ${report.hookScriptExists ? "✓" : "MISSING"} · ${Object.entries(report.hooks).map(([name, ok]) => `${name} ${ok ? "✓" : "MISSING"}`).join(" · ")}`,
    `Prompt hints: ${report.promptHints} | Jev: ${report.jev} | reuse: enabled (exact, bounded)`,
    `Event log: ${report.log.path} (${size(report.log)})`,
    `State: ${report.state.path} (${size(report.state)}, ${report.state.readable ? "readable" : "unreadable"})`,
    `Workspace generation: ${report.state.generation ?? "—"} | evidence: ${report.state.evidence ?? "—"}`,
    ...(report.warnings.length ? report.warnings.map((warning) => `WARNING: ${warning}`) : ["OK: no local warnings (Codex project trust is not checked)."]),
  ].join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(formatDoctor(await diagnoseReflex()) + "\n");
}
