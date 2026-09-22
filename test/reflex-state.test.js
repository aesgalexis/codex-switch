import test from "node:test";
import assert from "node:assert/strict";
import { advanceGeneration, advanceGenerations, cacheableOutput, consumePendingGeneration, emptyState, evidenceFromObservation, exactEvidence, recordPending } from "../src/reflex/state.js";

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

test("domain generations invalidate workspace evidence without invalidating identity", () => {
  const state = emptyState("workspace");
  advanceGenerations(state, ["workspace"]);
  assert.deepEqual(state.generations, { identity: 0, workspace: 1, external: 0 });
  advanceGenerations(state, ["identity", "workspace"]);
  assert.deepEqual(state.generations, { identity: 1, workspace: 2, external: 0 });
});

test("stores normalized evidence with provenance and safe fingerprints", () => {
  const state = emptyState("workspace");
  const item = evidenceFromObservation({ operation: { key: "git.status.short", family: "git" }, command: "git status --short", output: " M README.md", at: "2026-09-21T10:00:00.000Z", session: "session", tool: "Bash", generation: 2, workspaceId: "workspace" });
  state.evidence.push(item);
  assert.equal(item.kind, "git.status.short");
  assert.equal(item.workspaceGeneration, 2);
  assert.equal(item.value, " M README.md");
  assert.equal(item.generationDomain, "workspace");
  assert.equal(exactEvidence(state, { session: "session", commandHash: item.provenance.commandHash }), item);
});

test("oversized and sensitive outputs are fingerprinted instead of cached", () => {
  const operation = { key: "fs.read", family: "filesystem" };
  assert.equal(cacheableOutput(operation, "Get-Content README.md", "x".repeat(32769)), null);
  for (const file of [".env", ".env.local", ".npmrc", ".pypirc", ".netrc", "id_ed25519", "client.pem", "credentials.json", "service-account.json"]) {
    assert.equal(cacheableOutput(operation, `Get-Content ${file}`, "otherwise harmless"), null, file);
  }
  assert.equal(cacheableOutput(operation, "Get-Content config.txt", "token=private"), null);
});
