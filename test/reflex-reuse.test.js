import test from "node:test";
import assert from "node:assert/strict";
import { fingerprint } from "../src/reflex/privacy.js";
import { preToolUseRewrite, safePlanActualReuse } from "../src/reflex/reuse.js";

const session = "session";
const workspaceId = "workspace";

function operation(command, key, family = key.startsWith("git.") ? "git" : "filesystem") {
  return { command, key, family, access: "read-only", eligible: true };
}

function stateWith(command, key, value, { domain = key.startsWith("git.status") || key.startsWith("git.diff") || key.startsWith("fs.") ? "workspace" : "identity", current = 2, observed = current } = {}) {
  return {
    schema: 2, workspaceGeneration: 2, generations: { identity: 2, workspace: 2, external: 0 },
    workspaceId,
    evidence: [{
      kind: key, value, timestamp: "2026-09-21T10:00:00.000Z", session,
      provenance: { commandHash: fingerprint(command), family: key.startsWith("git.") ? "git" : "filesystem" },
      generationDomain: domain, generation: observed,
      workspace: { id: workspaceId }, repo: key.startsWith("git.") ? { id: workspaceId } : null,
    }],
  };
}

function plan(command, key, state, family) {
  return safePlanActualReuse(state, { operation: operation(command, key, family), session, commandHash: fingerprint(command), platform: "win32" });
}

test("first HEAD read has no evidence and executes normally", () => {
  assert.deepEqual(plan("git rev-parse HEAD", "git.head", { workspaceGeneration: 0, workspaceId, evidence: [] }), { outcome: "fallback", reason: "missing_evidence" });
});

test("second identical HEAD read reuses fresh evidence", () => {
  const result = plan("git rev-parse HEAD", "git.head", stateWith("git rev-parse HEAD", "git.head", "4b6018d0d061882760a2625e8946abc9e38db228"));
  assert.equal(result.outcome, "actual_reuse");
  assert.match(result.updatedCommand, /^try \{ \[Console\]::Out\.Write/);
  assert.equal(preToolUseRewrite(result.updatedCommand).hookSpecificOutput.permissionDecision, "allow");
});

test("workspace edits do not invalidate identity facts", () => {
  const state = stateWith("git rev-parse HEAD", "git.head", "4b6018d0d061882760a2625e8946abc9e38db228");
  state.workspaceGeneration = 3;
  state.generations.workspace = 3;
  assert.equal(plan("git rev-parse HEAD", "git.head", state).outcome, "actual_reuse");
});

test("identity mutation invalidates HEAD", () => {
  const state = stateWith("git rev-parse HEAD", "git.head", "4b6018d0d061882760a2625e8946abc9e38db228");
  state.generations.identity = 3;
  assert.equal(plan("git rev-parse HEAD", "git.head", state).reason, "stale_after_mutation");
});

for (const [name, command, key, value] of [
  ["status", "git status --short", "git.status.short", " M README.md\n"],
  ["porcelain", "git status --porcelain=v1", "git.status.porcelain", "?? new.txt\n"],
  ["full status", "git status", "git.status.full", "On branch main\n"],
  ["diff", "git diff", "git.diff.worktree", "diff --git a/a b/a\n"],
  ["cached diff", "git diff --cached", "git.diff.cached", ""],
  ["file read", "Get-Content -Raw README.md", "fs.read", "# model-switch\n"],
  ["search", "rg -n hooks src", "fs.search", "src/a.js:1:hooks\n"],
  ["simple listing", "Get-ChildItem src", "fs.list", "a.js\n"],
]) {
  test(`${name} reuses exact fresh output`, () => assert.equal(plan(command, key, stateWith(command, key, value)).outcome, "actual_reuse"));
  test(`${name} is invalidated by a workspace mutation`, () => {
    const state = stateWith(command, key, value);
    state.generations.workspace = 3;
    assert.equal(plan(command, key, state).reason, "stale_after_mutation");
  });
}

test("partial file reads and ineligible operations report explicit rejection reasons", () => {
  const partial = plan("Get-Content README.md -TotalCount 5", "fs.read", stateWith("Get-Content README.md -TotalCount 5", "fs.read", "x"));
  assert.deepEqual(partial, { outcome: "not_candidate", reason: "partial_file_read" });
  assert.equal(plan("Get-ChildItem -Recurse src", "fs.list", stateWith("Get-ChildItem -Recurse src", "fs.list", "x")).reason, "complex_listing");
  const compound = operation("git status --short; git diff", "git.status.short");
  compound.eligible = false;
  assert.deepEqual(safePlanActualReuse({ evidence: [] }, { operation: compound, session, commandHash: "x" }), { outcome: "not_candidate", reason: "ineligible_operation" });
});

test("exact read-only compound output is reusable across all recorded dependency generations", () => {
  const command = "git status --short; git rev-parse HEAD";
  const state = stateWith(command, "shell.compound.readonly", " M README.md\nabc\n", { domain: "workspace" });
  state.evidence[0].generations = { workspace: 2, identity: 2 };
  assert.equal(plan(command, "shell.compound.readonly", state, "compound").outcome, "actual_reuse");
  state.generations.identity = 3;
  assert.equal(plan(command, "shell.compound.readonly", state, "compound").reason, "stale_after_mutation");
});

test("missing cached output and internal errors fail open", () => {
  const command = "git status --short";
  const fingerprintOnly = stateWith(command, "git.status.short", undefined);
  delete fingerprintOnly.evidence[0].value;
  fingerprintOnly.evidence[0].valueFingerprint = "abc";
  assert.equal(plan(command, "git.status.short", fingerprintOnly).reason, "invalid_evidence");
  assert.equal(plan("git rev-parse HEAD", "git.head", { workspaceGeneration: 0, workspaceId, evidence: null }).reason, "internal_error");
});
