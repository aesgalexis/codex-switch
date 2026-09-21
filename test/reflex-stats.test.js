import test from "node:test";
import assert from "node:assert/strict";
import { summarizeReflexEvents } from "../src/reflex/stats.js";

test("summarizes operations, repeats, compounds, mutations, and shadow savings", () => {
  const base = { event: "PreToolUse", session: "abc", family: "git", access: "read-only", potentiallyMutating: false };
  const events = [
    { ...base, at: "2026-09-21T10:00:00.000Z", operations: [{ key: "git.head", family: "git", access: "read-only", eligible: true, commandHash: "head", shadow: { decision: "would_refresh" } }] },
    { ...base, at: "2026-09-21T10:00:05.000Z", operations: [{ key: "git.head", family: "git", access: "read-only", eligible: true, commandHash: "head", shadow: { decision: "would_reuse" }, actualReuse: { outcome: "actual_reuse" } }] },
    { ...base, at: "2026-09-21T10:00:06.000Z", compound: true, operations: [{ key: "git.status.short", family: "git", access: "read-only", eligible: true, commandHash: "status", shadow: { decision: "would_refresh" } }] },
    { event: "PreToolUse", at: "2026-09-21T10:00:07.000Z", session: "abc", access: "unknown", potentiallyMutating: true, commandPattern: "mystery <value>", operations: [{ family: "mystery", access: "unknown", eligible: false, shadow: { decision: "unknown" } }] },
    { event: "PostToolUse", at: "2026-09-21T10:00:05.100Z", actualReuseDelivery: { key: "git.head", success: true } },
  ];
  const summary = summarizeReflexEvents(events);
  assert.equal(summary.totalToolCalls, 4);
  assert.equal(summary.readOnlyRecognized, 3);
  assert.equal(summary.compoundToolCalls, 1);
  assert.equal(summary.recognizedInsideCompounds, 1);
  assert.equal(summary.mutatingToolCalls, 1);
  assert.equal(summary.unknownToolCalls, 1);
  assert.equal(summary.repeatedChecks, 1);
  assert.equal(summary.shadowDecisions.would_reuse, 1);
  assert.equal(summary.shadowWouldReuse, 1);
  assert.equal(summary.actualReuse, 1);
  assert.equal(summary.actualToolCallsSaved, 1);
  assert.equal(summary.reuseFallbacks, 0);
  assert.equal(summary.falseReuseErrors, 0);
  assert.equal(summary.potentialSavings.toolCalls, 1);
  assert.equal(summary.potentialSavings.reusableOperations, 1);
  assert.deepEqual(summary.repeatIntervals, { count: 1, minMs: 5000, avgMs: 5000, maxMs: 5000 });
});
