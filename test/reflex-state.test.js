import test from "node:test";
import assert from "node:assert/strict";
import { advanceGeneration, consumePendingGeneration, emptyState, evidenceFromObservation, exactEvidence, recordPending } from "../src/reflex/state.js";

test("workspace generation advances only for potentially mutating operations", () => {
  const state = emptyState("workspace");
  assert.equal(advanceGeneration(state, false), 0);
  assert.equal(advanceGeneration(state, true), 1);
  assert.equal(advanceGeneration(state, false), 1);
});

test("preserves the generation from PreToolUse across a concurrent mutation", () => {
  const state = emptyState("workspace");
  recordPending(state, "read-call");
  advanceGeneration(state, true);
  assert.equal(state.workspaceGeneration, 1);
  assert.equal(consumePendingGeneration(state, "read-call"), 0);
  assert.equal("read-call" in state.pending, false);
});

test("stores normalized evidence with provenance and safe fingerprints", () => {
  const state = emptyState("workspace");
  const item = evidenceFromObservation({ operation: { key: "git.status.short", family: "git" }, command: "git status --short", output: " M README.md", at: "2026-09-21T10:00:00.000Z", session: "session", tool: "Bash", generation: 2, workspaceId: "workspace" });
  state.evidence.push(item);
  assert.equal(item.kind, "git.status.short");
  assert.equal(item.workspaceGeneration, 2);
  assert.equal(typeof item.valueFingerprint, "string");
  assert.equal("value" in item, false);
  assert.equal(exactEvidence(state, { session: "session", commandHash: item.provenance.commandHash }), item);
});
