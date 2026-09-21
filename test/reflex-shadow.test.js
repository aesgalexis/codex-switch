import test from "node:test";
import assert from "node:assert/strict";
import { deterministicShadow, semanticShadow } from "../src/reflex/shadow.js";

const operation = { eligible: true, access: "read-only", key: "git.head", family: "git" };

test("makes deterministic reuse, refresh, stale, and unknown decisions", () => {
  const evidence = { workspaceGeneration: 3, session: "s", provenance: { commandHash: "h", family: "git" } };
  const state = { workspaceGeneration: 3, evidence: [evidence] };
  assert.equal(deterministicShadow(state, { operation, session: "s", commandHash: "missing" }).decision, "would_refresh");
  assert.equal(deterministicShadow(state, { operation, session: "s", commandHash: "h" }).decision, "would_reuse");
  state.workspaceGeneration = 4;
  assert.equal(deterministicShadow(state, { operation, session: "s", commandHash: "h" }).decision, "stale_after_mutation");
  assert.equal(deterministicShadow(state, { operation: { eligible: false, access: "unknown" }, session: "s", commandHash: "x" }).decision, "unknown");
});

test("semantic shadow stays bounded and fail-open when Jev is disabled", async () => {
  const previous = process.env.MODEL_SWITCH_REFLEX_JEV_SHADOW;
  process.env.MODEL_SWITCH_REFLEX_JEV_SHADOW = "off";
  try {
    const state = {
      workspaceGeneration: 3,
      evidence: [{ kind: "git.head", timestamp: new Date().toISOString(), workspaceGeneration: 3, session: "s", provenance: { commandHash: "head", family: "git" } }],
    };
    const decision = await semanticShadow(state, { operation: { eligible: true, access: "read-only", key: "git.log", family: "git" }, session: "s", commandHash: "log" });
    assert.deepEqual(decision, { decision: "uncertain", source: "jev-disabled", confidence: null });
  } finally {
    if (previous === undefined) delete process.env.MODEL_SWITCH_REFLEX_JEV_SHADOW;
    else process.env.MODEL_SWITCH_REFLEX_JEV_SHADOW = previous;
  }
});
