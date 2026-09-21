import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { summarizeReflexEvents } from "../src/reflex/stats.js";

const hookPath = fileURLToPath(new URL("../src/hooks/reflex-hook.js", import.meta.url));

function invokeHook(input, logPath) {
  const env = { ...process.env, MODEL_SWITCH_REFLEX_LOG: logPath, MODEL_SWITCH_REFLEX_JEV_SHADOW: "off" };
  delete env.TYPESAFE_API_KEY;
  const result = spawnSync(process.execPath, [hookPath], {
    input: JSON.stringify(input), encoding: "utf8", env, windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function hookInput(event, command, toolUse, response) {
  return {
    hook_event_name: event,
    tool_name: "Bash",
    tool_input: { command },
    ...(response ? { tool_response: response } : {}),
    session_id: "integration-session",
    turn_id: `turn-${toolUse}`,
    tool_use_id: toolUse,
    cwd: "C:/work/model-switch",
  };
}

test("hook performs deterministic reuse, reports delivery, and invalidates after mutation", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "model-switch-reuse-"));
  const logPath = path.join(directory, "events.jsonl");
  const head = "4b6018d0d061882760a2625e8946abc9e38db228";
  try {
    assert.equal(invokeHook(hookInput("PreToolUse", "git rev-parse HEAD", "head-1"), logPath), "");
    invokeHook(hookInput("PostToolUse", "git rev-parse HEAD", "head-1", { exit_code: 0, output: head }), logPath);

    const rewriteRaw = invokeHook(hookInput("PreToolUse", "git rev-parse HEAD", "head-2"), logPath);
    const rewrite = JSON.parse(rewriteRaw);
    assert.equal(rewrite.hookSpecificOutput.permissionDecision, "allow");
    assert.match(rewrite.hookSpecificOutput.updatedInput.command, /Write-Output/);
    invokeHook(hookInput("PostToolUse", rewrite.hookSpecificOutput.updatedInput.command, "head-2", { exit_code: 0, output: head }), logPath);

    const mutation = hookInput("PostToolUse", "*** Begin Patch", "mutation", { ok: true });
    mutation.tool_name = "apply_patch";
    invokeHook(mutation, logPath);
    assert.equal(invokeHook(hookInput("PreToolUse", "git rev-parse HEAD", "head-3"), logPath), "");

    const events = (await readFile(logPath, "utf8")).trim().split(/\r?\n/).map(JSON.parse);
    const summary = summarizeReflexEvents(events);
    assert.equal(summary.actualReuse, 1);
    assert.equal(summary.actualToolCallsSaved, 1);
    assert.equal(summary.staleAfterMutation, 1);
    assert.equal(summary.falseReuseErrors, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
