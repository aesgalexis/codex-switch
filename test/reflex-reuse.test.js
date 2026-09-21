import test from "node:test";
import assert from "node:assert/strict";
import { fingerprint } from "../src/reflex/privacy.js";
import { preToolUseRewrite, safePlanActualReuse } from "../src/reflex/reuse.js";

const session = "session";
const workspaceId = "workspace";

function operation(command, key) {
  return { command, key, family: "git", access: "read-only", eligible: true };
}

function stateWith(command, key, value, { generation = 2, evidenceGeneration = generation } = {}) {
  return {
    workspaceGeneration: generation,
    workspaceId,
    evidence: [{
      kind: key,
      value,
      timestamp: "2026-09-21T10:00:00.000Z",
      session,
      provenance: { commandHash: fingerprint(command), family: "git" },
      workspaceGeneration: evidenceGeneration,
      workspace: { id: workspaceId },
      repo: { id: workspaceId },
    }],
  };
}

test("first HEAD read has no evidence and executes normally", () => {
  const command = "git rev-parse HEAD";
  const plan = safePlanActualReuse({ workspaceGeneration: 0, workspaceId, evidence: [] }, {
    operation: operation(command, "git.head"), session, commandHash: fingerprint(command), platform: "win32",
  });
  assert.deepEqual(plan, { outcome: "fallback", reason: "missing_evidence" });
});

test("second identical HEAD read reuses fresh evidence", () => {
  const command = "git rev-parse HEAD";
  const plan = safePlanActualReuse(stateWith(command, "git.head", "4b6018d0d061882760a2625e8946abc9e38db228"), {
    operation: operation(command, "git.head"), session, commandHash: fingerprint(command), platform: "win32",
  });
  assert.equal(plan.outcome, "actual_reuse");
  assert.match(plan.updatedCommand, /^try \{ Write-Output/);
  assert.equal(preToolUseRewrite(plan.updatedCommand).hookSpecificOutput.permissionDecision, "allow");
});

test("mutation between HEAD reads makes evidence stale", () => {
  const command = "git rev-parse HEAD";
  const plan = safePlanActualReuse(stateWith(command, "git.head", "4b6018d0d061882760a2625e8946abc9e38db228", { generation: 3, evidenceGeneration: 2 }), {
    operation: operation(command, "git.head"), session, commandHash: fingerprint(command),
  });
  assert.equal(plan.outcome, "fallback");
  assert.equal(plan.reason, "stale_after_mutation");
});

test("repeated branch query reuses a safe branch value", () => {
  const command = "git branch --show-current";
  const plan = safePlanActualReuse(stateWith(command, "git.branch.current", "reflex-phase1-observe"), {
    operation: operation(command, "git.branch.current"), session, commandHash: fingerprint(command), platform: "win32",
  });
  assert.equal(plan.outcome, "actual_reuse");
});

test("repeated repo root query reuses the exact root", () => {
  const command = "git rev-parse --show-toplevel";
  const plan = safePlanActualReuse(stateWith(command, "git.root", "C:/proyectos/model-switch"), {
    operation: operation(command, "git.root"), session, commandHash: fingerprint(command), platform: "win32",
  });
  assert.equal(plan.outcome, "actual_reuse");
});

test("absent, stale, mismatched, or invalid evidence fails open", () => {
  const command = "git rev-parse HEAD";
  const invalid = stateWith(command, "git.head", "not-a-commit");
  assert.equal(safePlanActualReuse(invalid, { operation: operation(command, "git.head"), session, commandHash: fingerprint(command) }).reason, "invalid_evidence");
  invalid.evidence[0].workspace.id = "other";
  assert.equal(safePlanActualReuse(invalid, { operation: operation(command, "git.head"), session, commandHash: fingerprint(command) }).reason, "missing_evidence");
});

test("non-eligible and compound-like commands are never rewritten", () => {
  const plan = safePlanActualReuse({ workspaceGeneration: 0, workspaceId, evidence: [] }, {
    operation: operation("git status --short", "git.status.short"), session, commandHash: fingerprint("git status --short"),
  });
  assert.deepEqual(plan, { outcome: "not_candidate" });
});

test("internal errors become fallback and leave the original tool path available", () => {
  const command = "git rev-parse HEAD";
  const plan = safePlanActualReuse({ workspaceGeneration: 0, workspaceId, evidence: null }, {
    operation: operation(command, "git.head"), session, commandHash: fingerprint(command),
  });
  assert.equal(plan.outcome, "fallback");
  assert.equal(plan.reason, "internal_error");
});
