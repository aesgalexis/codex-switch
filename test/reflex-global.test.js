import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installCodexIntegration, installIntoConfig, inspectIntegration, removeManagedHooks, uninstallCodexIntegration } from "../src/reflex/codex-integration.js";
import { buildReport } from "../src/reflex/report.js";
import { knownWorkspaces, resolveWorkspace } from "../src/reflex/workspace.js";

const hookPath = fileURLToPath(new URL("../src/hooks/reflex-hook.js", import.meta.url));

function invoke(input, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [hookPath], { env: { ...process.env, ...env }, windowsHide: true });
    let output = ""; child.stdout.on("data", (chunk) => { output += chunk; });
    child.on("error", reject); child.on("close", (code) => code === 0 ? resolve(output) : reject(new Error(`hook exit ${code}`)));
    child.stdin.end(JSON.stringify(input));
  });
}

function event(cwd, command, id, phase = "PostToolUse", output = "value\n") {
  return { hook_event_name: phase, tool_name: "Bash", tool_input: { command },
    tool_response: { exit_code: 0, output }, session_id: "global-test", turn_id: `turn-${id}`, tool_use_id: id, cwd };
}

test("global installer is idempotent, preserves foreign hooks, and uninstall removes only model-switch", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "model-switch-install-"));
  const codex = path.join(root, "codex"); const engine = path.join(root, "engine");
  try {
    await mkdir(path.join(engine, "src", "hooks"), { recursive: true });
    await writeFile(path.join(engine, "src", "hooks", "reflex-hook.js"), "// engine\n");
    await mkdir(codex); const config = path.join(codex, "config.toml");
    const foreign = "[hooks]\nsession_start = [{ hooks = [{ type = \"command\", command = \"foreign\" }] }]\n";
    await writeFile(config, foreign);
    const env = { CODEX_HOME: codex };
    const first = await installCodexIntegration({ env, root: engine, now: new Date("2026-01-01T00:00:00Z") });
    assert.equal(first.changed, true); assert.ok(first.backup); assert.ok(await stat(first.backup));
    const installed = await readFile(config, "utf8");
    assert.equal(inspectIntegration(installed, engine).installed, true); assert.match(installed, /foreign/);
    assert.equal((await installCodexIntegration({ env, root: engine })).changed, false);
    assert.equal((await uninstallCodexIntegration({ env })).changed, true);
    assert.match(await readFile(config, "utf8"), /foreign/);
    assert.equal((await uninstallCodexIntegration({ env })).changed, false);
    await assert.rejects(installCodexIntegration({ env, root: path.join(root, "missing") }), /engine missing/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("workspace identity is canonical, isolated, non-Git capable, and malformed cwd fails closed", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "model-switch-global-"));
  const a = path.join(root, "A"); const b = path.join(root, "B"); const data = path.join(root, "data");
  const env = { MODEL_SWITCH_GLOBAL_HOME: data, MODEL_SWITCH_REFLEX_JEV_SHADOW: "off" };
  try {
    await mkdir(a); await mkdir(b);
    const wa = resolveWorkspace(a, env); const wa2 = resolveWorkspace(path.join(a, "."), env); const wb = resolveWorkspace(b, env);
    assert.equal(wa.id, wa2.id); assert.notEqual(wa.id, wb.id); assert.equal(resolveWorkspace("relative", env), null);
    assert.equal(resolveWorkspace(path.join(root, "missing"), env), null);

    await Promise.all([
      invoke(event(a, "Get-Content file.txt", "a-read", "PostToolUse", "A\n"), env),
      invoke(event(b, "Get-Content file.txt", "b-read", "PostToolUse", "B\n"), env),
    ]);
    await invoke(event(a, "Get-Content file.txt", "a-read", "PostToolUse", "A\n"), env);
    const workspaces = await knownWorkspaces(env); assert.equal(workspaces.length, 2);
    const stateA = JSON.parse(await readFile(wa.state, "utf8")); const stateB = JSON.parse(await readFile(wb.state, "utf8"));
    assert.equal(stateA.workspaceId, wa.id); assert.equal(stateB.workspaceId, wb.id);
    assert.equal(stateA.evidence.length, 1, "duplicate logical hook invocation must be suppressed");
    assert.notDeepEqual(stateA.evidence, stateB.evidence);
    assert.notEqual(wa.events, wb.events);
    assert.equal(await invoke(event(path.join(root, "missing"), "git status --short", "bad", "PreToolUse"), env), "");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("global stats stay partitioned by workspace", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "model-switch-report-"));
  const a = path.join(root, "A"); const b = path.join(root, "B"); const data = path.join(root, "data");
  const previous = process.env.MODEL_SWITCH_GLOBAL_HOME;
  try {
    process.env.MODEL_SWITCH_GLOBAL_HOME = data; await mkdir(a); await mkdir(b);
    const wa = resolveWorkspace(a); const wb = resolveWorkspace(b); await mkdir(wa.directory, { recursive: true }); await mkdir(wb.directory, { recursive: true });
    await writeFile(wa.events, JSON.stringify({ event: "PreToolUse", operations: [] }) + "\n");
    await writeFile(wb.events, [1, 2].map(() => JSON.stringify({ event: "PreToolUse", operations: [] })).join("\n") + "\n");
    const one = await buildReport({ workspace: a }); assert.equal(one.workspaceId, wa.id); assert.equal(one.stats.totalToolCalls, 1);
    const all = await buildReport({ all: true }); assert.equal(all.workspaceCount, 2); assert.equal(all.aggregate.totalToolCalls, 3);
  } finally {
    if (previous == null) delete process.env.MODEL_SWITCH_GLOBAL_HOME; else process.env.MODEL_SWITCH_GLOBAL_HOME = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("managed config helpers avoid duplicate logical hook blocks", () => {
  const base = "[hooks.state]\ntrusted_hash = \"foreign\"\n";
  const once = installIntoConfig(base); const twice = installIntoConfig(once);
  assert.equal(once, twice); assert.equal(inspectIntegration(once).occurrences, 1);
  assert.doesNotMatch(removeManagedHooks(once), /model-switch global hooks/);
});
