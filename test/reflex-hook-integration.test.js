import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { summarizeReflexEvents } from "../src/reflex/stats.js";

const hookPath = fileURLToPath(new URL("../src/hooks/reflex-hook.js", import.meta.url));

function invokeHook(input, logPath, overrides = {}) {
  const env = { ...process.env, MODEL_SWITCH_REFLEX_LOG: logPath, MODEL_SWITCH_REFLEX_JEV_SHADOW: "off", ...overrides };
  delete env.TYPESAFE_API_KEY;
  const result = spawnSync(process.execPath, [hookPath], {
    input: JSON.stringify(input), encoding: "utf8", env, windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function invokeHookAsync(input, logPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [hookPath], {
      env: { ...process.env, MODEL_SWITCH_REFLEX_LOG: logPath, MODEL_SWITCH_REFLEX_JEV_SHADOW: "off" },
      windowsHide: true,
    });
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(`hook exit ${code}`)));
    child.stdin.end(JSON.stringify(input));
  });
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
    cwd: process.cwd(),
  };
}

test("hook preserves identity reuse across a working-tree mutation", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "model-switch-reuse-"));
  const logPath = path.join(directory, "events.jsonl");
  const head = "4b6018d0d061882760a2625e8946abc9e38db228";
  try {
    assert.equal(invokeHook(hookInput("PreToolUse", "git rev-parse HEAD", "head-1"), logPath), "");
    invokeHook(hookInput("PostToolUse", "git rev-parse HEAD", "head-1", { exit_code: 0, output: head }), logPath);

    const rewriteRaw = invokeHook(hookInput("PreToolUse", "git rev-parse HEAD", "head-2"), logPath);
    const rewrite = JSON.parse(rewriteRaw);
    assert.equal(rewrite.hookSpecificOutput.permissionDecision, "allow");
    assert.match(rewrite.hookSpecificOutput.updatedInput.command, /Console.*Out.*Write/);
    invokeHook(hookInput("PostToolUse", rewrite.hookSpecificOutput.updatedInput.command, "head-2", { exit_code: 0, output: head }), logPath);

    const mutation = hookInput("PostToolUse", "*** Begin Patch", "mutation", { ok: true });
    mutation.tool_name = "apply_patch";
    invokeHook(mutation, logPath);
    assert.notEqual(invokeHook(hookInput("PreToolUse", "git rev-parse HEAD", "head-3"), logPath), "");

    const events = (await readFile(logPath, "utf8")).trim().split(/\r?\n/).map(JSON.parse);
    const summary = summarizeReflexEvents(events);
    assert.equal(summary.plannedReuse, 2);
    assert.equal(summary.actualReuse, 1);
    assert.equal(summary.gitSubprocessesAvoided, 1);
    assert.equal(summary.toolCallsAvoidedByPreToolReuse, 0);
    assert.equal(summary.staleAfterMutation, 0);
    assert.equal(summary.falseReuseErrors, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Git branch mutations invalidate cached current-branch identity", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "model-switch-branch-invalidation-"));
  const logPath = path.join(directory, "events.jsonl");
  try {
    invokeHook(hookInput("PreToolUse", "git branch --show-current", "branch-1"), logPath);
    invokeHook(hookInput("PostToolUse", "git branch --show-current", "branch-1", { exit_code: 0, output: "before" }), logPath);
    assert.notEqual(invokeHook(hookInput("PreToolUse", "git branch --show-current", "branch-2"), logPath), "");

    invokeHook(hookInput("PreToolUse", "git branch -m after", "rename"), logPath);
    invokeHook(hookInput("PostToolUse", "git branch -m after", "rename", { exit_code: 0, output: "" }), logPath);
    assert.equal(invokeHook(hookInput("PreToolUse", "git branch --show-current", "branch-3"), logPath), "");

    const events = (await readFile(logPath, "utf8")).trim().split(/\r?\n/).map(JSON.parse);
    const rename = events.find((event) => event.event === "PostToolUse" && event.command === "git branch -m after");
    assert.deepEqual(rename.invalidationDomains.sort(), ["identity", "workspace"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("hook learns and reuses an exact read-only compound until a dependency changes", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "model-switch-compound-"));
  const logPath = path.join(directory, "events.jsonl");
  const command = "git status --short; git diff";
  const output = " M README.md\ndiff --git a/README.md b/README.md\n";
  try {
    assert.equal(invokeHook(hookInput("PreToolUse", command, "compound-1"), logPath), "");
    invokeHook(hookInput("PostToolUse", command, "compound-1", { exit_code: 0, output }), logPath);

    const rewrite = JSON.parse(invokeHook(hookInput("PreToolUse", command, "compound-2"), logPath));
    assert.equal(rewrite.hookSpecificOutput.permissionDecision, "allow");
    assert.match(rewrite.hookSpecificOutput.updatedInput.command, /Console.*Out.*Write/);
    invokeHook(hookInput("PostToolUse", rewrite.hookSpecificOutput.updatedInput.command, "compound-2", { exit_code: 0, output }), logPath);

    const mutation = hookInput("PostToolUse", "*** Begin Patch", "compound-edit", { ok: true });
    mutation.tool_name = "apply_patch";
    invokeHook(mutation, logPath);
    assert.equal(invokeHook(hookInput("PreToolUse", command, "compound-3"), logPath), "");

    const events = (await readFile(logPath, "utf8")).trim().split(/\r?\n/).map(JSON.parse);
    const pre = events.filter((event) => event.event === "PreToolUse" && event.command === command);
    assert.equal(pre[0].compoundReuse.reason, "missing_evidence");
    assert.equal(pre[1].compoundReuse.outcome, "actual_reuse");
    assert.equal(pre[2].compoundReuse.reason, "stale_after_mutation");
    const summary = summarizeReflexEvents(events);
    assert.equal(summary.actualReuseByCommand["shell.compound.readonly"], 1);
    assert.equal(summary.reuseRejectionsByReason.missing_evidence, 1);
    assert.equal(summary.reuseRejectionsByReason.stale_after_mutation, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("safe compound spacing is equivalent, while order and arguments remain distinct", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "model-switch-compound-identity-"));
  const logPath = path.join(directory, "events.jsonl");
  const command = "git status --short; git diff --stat";
  try {
    invokeHook(hookInput("PreToolUse", command, "identity-first"), logPath);
    invokeHook(hookInput("PostToolUse", command, "identity-first", { exit_code: 0, output: " M README.md\n README.md | 1 +\n" }), logPath);
    assert.notEqual(invokeHook(hookInput("PreToolUse", "git  status --short ;git diff --stat", "identity-spaces"), logPath), "");
    assert.equal(invokeHook(hookInput("PreToolUse", "git diff --stat; git status --short", "identity-order"), logPath), "");
    assert.equal(invokeHook(hookInput("PreToolUse", "git status --short; git diff --check", "identity-args"), logPath), "");
    assert.equal(invokeHook(hookInput("PreToolUse", "git status --short | git diff --stat", "identity-pipe"), logPath), "");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("parallel observations preserve both cached reads", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "model-switch-parallel-"));
  const logPath = path.join(directory, "events.jsonl");
  try {
    const status = "git status --short";
    const diff = "git diff --stat";
    await Promise.all([
      invokeHookAsync(hookInput("PostToolUse", status, "parallel-status", { exit_code: 0, output: " M README.md\n" }), logPath),
      invokeHookAsync(hookInput("PostToolUse", diff, "parallel-diff", { exit_code: 0, output: " README.md | 1 +\n" }), logPath),
    ]);
    assert.notEqual(invokeHook(hookInput("PreToolUse", status, "status-hit"), logPath), "");
    assert.notEqual(invokeHook(hookInput("PreToolUse", diff, "diff-hit"), logPath), "");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("local and external reads do not invalidate cached status", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "model-switch-status-read-"));
  const logPath = path.join(directory, "events.jsonl");
  try {
    const status = hookInput("PostToolUse", "git status --short", "status-observe", { exit_code: 0, output: " M README.md\n" });
    status.cwd = directory;
    invokeHook(status, logPath);

    const metadata = hookInput("PostToolUse", "Get-Item package.json", "metadata-read", { exit_code: 0, output: "package.json\n" });
    metadata.cwd = directory;
    invokeHook(metadata, logPath);
    const afterLocalRead = hookInput("PreToolUse", "git status --short", "status-after-local", null);
    afterLocalRead.cwd = directory;
    assert.notEqual(invokeHook(afterLocalRead, logPath), "");

    const external = hookInput("PostToolUse", "gh pr view 123", "external-read", { exit_code: 0, output: "PR 123\n" });
    external.cwd = directory;
    invokeHook(external, logPath);
    const afterExternalRead = hookInput("PreToolUse", "git status --short", "status-after-external", null);
    afterExternalRead.cwd = directory;
    assert.notEqual(invokeHook(afterExternalRead, logPath), "");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("editing another file preserves a complete read; editing the file invalidates it", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "model-switch-file-generation-"));
  const logPath = path.join(directory, "events.jsonl");
  const readCommand = "Get-Content src/foo.js";
  const edit = (name, id) => {
    const patch = `*** Begin Patch\n*** Update File: ${name}\n@@\n-old\n+new\n*** End Patch`;
    const input = hookInput("PostToolUse", patch, id, { exit_code: 0, output: "Success" });
    input.tool_name = "apply_patch";
    input.cwd = directory;
    return input;
  };
  try {
    await mkdir(path.join(directory, "src"));
    await writeFile(path.join(directory, "src", "foo.js"), "export const x = 1;\n", "utf8");
    const input = (event, command, id, response) => {
      const value = hookInput(event, command, id, response);
      value.cwd = directory;
      return value;
    };
    invokeHook(input("PreToolUse", readCommand, "read-first"), logPath);
    invokeHook(input("PostToolUse", readCommand, "read-first", { exit_code: 0, output: "export const x = 1;\n" }), logPath);
    invokeHook(edit("README.md", "other-edit"), logPath);
    assert.notEqual(invokeHook(input("PreToolUse", readCommand, "read-after-other"), logPath), "");
    invokeHook(edit("src/foo.js", "same-edit"), logPath);
    assert.equal(invokeHook(input("PreToolUse", readCommand, "read-after-same"), logPath), "");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("hook does not widen reuse through a compound with unsupported operations", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "model-switch-compound-scope-"));
  const logPath = path.join(directory, "events.jsonl");
  const command = "gh pr view; git status --short";
  try {
    assert.equal(invokeHook(hookInput("PreToolUse", command, "scope-1"), logPath), "");
    invokeHook(hookInput("PostToolUse", command, "scope-1", { exit_code: 0, output: "PR data\n" }), logPath);
    assert.equal(invokeHook(hookInput("PreToolUse", command, "scope-2"), logPath), "");
    const events = (await readFile(logPath, "utf8")).trim().split(/\r?\n/).map(JSON.parse);
    const pre = events.filter((event) => event.event === "PreToolUse");
    assert.equal(pre[0].compoundReuse.reason, "compound_has_unsupported_operation");
    assert.equal(pre[1].compoundReuse.reason, "compound_has_unsupported_operation");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("UserPromptSubmit injects only fresh facts and records no prompt text", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "model-switch-hint-"));
  const logPath = path.join(directory, "events.jsonl");
  const head = "4b6018d0d061882760a2625e8946abc9e38db228";
  try {
    invokeHook(hookInput("PostToolUse", "git rev-parse --show-toplevel", "root", { exit_code: 0, output: "C:/work/model-switch" }), logPath);
    invokeHook(hookInput("PostToolUse", "git branch --show-current", "branch", { exit_code: 0, output: "feature/hints" }), logPath);
    invokeHook(hookInput("PostToolUse", "git rev-parse HEAD", "head", { exit_code: 0, output: head }), logPath);
    invokeHook(hookInput("PostToolUse", "git status --short", "status", { exit_code: 0, output: " M README.md\n?? notes.txt\n" }), logPath);
    const prompt = {
      hook_event_name: "UserPromptSubmit", prompt: "Review the project tests TOKEN=private",
      session_id: "integration-session", turn_id: "hint-turn", cwd: process.cwd(),
    };
    const output = JSON.parse(invokeHook(prompt, logPath, { MODEL_SWITCH_PROMPT_HINT_MODE: "inject" }));
    const context = output.hookSpecificOutput.additionalContext;
    assert.match(context, /repo_root: C:\/work\/model-switch/);
    assert.match(context, /branch: feature\/hints/);
    assert.match(context, new RegExp(`head: ${head}`));
    assert.match(context, /working_tree: dirty/);
    assert.match(context, /modified: README\.md, notes\.txt/);
    assert.equal(context.includes("TOKEN"), false);

    const events = (await readFile(logPath, "utf8")).trim().split(/\r?\n/).map(JSON.parse);
    const promptEvent = events.find((event) => event.event === "UserPromptSubmit");
    assert.equal(promptEvent.hintInjected, true);
    assert.equal("prompt" in promptEvent, false);

    const mutation = hookInput("PostToolUse", "*** Begin Patch", "edit", { ok: true });
    mutation.tool_name = "apply_patch";
    invokeHook(mutation, logPath);
    const afterEdit = JSON.parse(invokeHook({ ...prompt, turn_id: "stale-turn" }, logPath, { MODEL_SWITCH_PROMPT_HINT_MODE: "inject" }));
    assert.match(afterEdit.hookSpecificOutput.additionalContext, /head:/);
    assert.doesNotMatch(afterEdit.hookSpecificOutput.additionalContext, /working_tree:/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
