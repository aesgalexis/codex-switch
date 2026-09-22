import test from "node:test";
import assert from "node:assert/strict";
import { summarizeReflexEvents } from "../src/reflex/stats.js";

test("labels repeats from old events without a reuse decision as historical", () => {
  const operation = { key: "git.status.short", family: "git", access: "read-only", eligible: true, commandHash: "same" };
  const events = [
    { event: "PreToolUse", at: "2026-09-21T10:00:00Z", session: "s", operations: [operation] },
    { event: "PreToolUse", at: "2026-09-21T10:00:01Z", session: "s", compound: true, operations: [operation] },
    { event: "PreToolUse", at: "2026-09-21T10:00:02Z", session: "s", operations: [operation] },
  ];
  const summary = summarizeReflexEvents(events);
  assert.equal(summary.repeatedChecksByReuseOutcome.legacy_compound_without_lookup, 1);
  assert.equal(summary.compoundCacheMissByCause.legacy_compound_without_lookup, 1);
  assert.equal(summary.repeatedChecksByReuseOutcome.legacy_without_reuse_instrumentation, 1);
  assert.equal(summary.notInstrumentedByCommand["git.status.short:git"], 1);
  assert.equal(summary.repeatedChecksByReuseOutcome.compound_cache_miss, undefined);
});

test("summarizes operations, repeats, compounds, mutations, and shadow savings", () => {
  const base = { event: "PreToolUse", session: "abc", family: "git", access: "read-only", potentiallyMutating: false };
  const events = [
    { ...base, at: "2026-09-21T10:00:00.000Z", operations: [{ key: "git.head", family: "git", access: "read-only", eligible: true, commandHash: "head", shadow: { decision: "would_refresh" }, actualReuse: { outcome: "fallback", reason: "missing_evidence" } }] },
    { ...base, at: "2026-09-21T10:00:05.000Z", operations: [{ key: "git.head", family: "git", access: "read-only", eligible: true, commandHash: "head", shadow: { decision: "would_reuse" }, actualReuse: { outcome: "actual_reuse" } }] },
    { ...base, at: "2026-09-21T10:00:06.000Z", compound: true, operations: [{ key: "git.status.short", family: "git", access: "read-only", eligible: true, commandHash: "status", shadow: { decision: "would_refresh" } }] },
    { event: "PreToolUse", at: "2026-09-21T10:00:07.000Z", session: "abc", access: "unknown", potentiallyMutating: true, commandPattern: "mystery <value>", operations: [{ family: "mystery", access: "unknown", eligible: false, shadow: { decision: "unknown" } }] },
    { event: "PostToolUse", at: "2026-09-21T10:00:05.100Z", actualReuseDelivery: { key: "git.head", success: true } },
  ];
  const summary = summarizeReflexEvents(events);
  assert.equal(summary.totalToolCalls, 4);
  assert.equal(summary.totalReadOnlyCalls, 3);
  assert.equal(summary.readOnlyRecognized, 3);
  assert.equal(summary.compoundToolCalls, 1);
  assert.equal(summary.recognizedInsideCompounds, 1);
  assert.equal(summary.reusableInsideCompounds, 1);
  assert.equal(summary.mutatingToolCalls, 1);
  assert.equal(summary.unknownToolCalls, 1);
  assert.equal(summary.repeatedChecks, 1);
  assert.equal(summary.shadowDecisions.would_reuse, 1);
  assert.equal(summary.shadowWouldReuse, 1);
  assert.equal(summary.plannedReuse, 1);
  assert.equal(summary.actualReuse, 1);
  assert.equal(summary.operationsServedFromCache, 1);
  assert.equal(summary.gitSubprocessesAvoided, 1);
  assert.equal(summary.percentReadOnlyOperationsServedFromCache, 33.33);
  assert.equal(summary.toolCallsAvoidedByPreToolReuse, 0);
  assert.equal(summary.reuseFallbacks, 1);
  assert.equal(summary.reuseRejectionsByReason.missing_evidence, 1);
  assert.equal(summary.repeatedChecksByReuseOutcome.actual_reuse, 1);
  assert.equal(summary.falseReuseErrors, 0);
  assert.equal(summary.potentialSavings.toolCalls, 1);
  assert.equal(summary.potentialSavings.reusableOperations, 1);
  assert.deepEqual(summary.repeatIntervals, { count: 1, minMs: 5000, avgMs: 5000, maxMs: 5000 });
});

test("correlates injected prompt facts with orientation checks in the same turn", () => {
  const events = [
    { event: "UserPromptSubmit", at: "2026-09-21T10:00:00.000Z", session: "s", turn: "t", hintCandidate: true, hintInjected: true, hintFacts: ["git.root", "git.head", "git.working-tree"] },
    { event: "PreToolUse", at: "2026-09-21T10:00:02.000Z", session: "s", turn: "t", operations: [{ key: "git.head", family: "git", access: "read-only", eligible: true, commandHash: "h", actualReuse: { outcome: "actual_reuse" } }] },
    { event: "PreToolUse", at: "2026-09-21T10:00:03.000Z", session: "s", turn: "t", operations: [{ key: "fs.read", family: "filesystem", access: "read-only", eligible: true, commandHash: "f" }] },
    { event: "PreToolUse", at: "2026-09-21T10:00:04.000Z", session: "s", turn: "t", operations: [{ key: "git.status.short", family: "git", access: "read-only", eligible: true, commandHash: "s" }] },
  ];
  const summary = summarizeReflexEvents(events);
  assert.equal(summary.promptHints.userPromptsObserved, 1);
  assert.equal(summary.promptHints.promptsWithStateHint, 1);
  assert.equal(summary.promptHints.factsInjected, 3);
  assert.equal(summary.promptHints.orientationChecksAfterHint.total, 1);
  assert.equal(summary.promptHints.orientationChecksAfterHint.headAfterHeadHint, 1);
  assert.equal(summary.promptHints.orientationChecksAfterHint.fallbackActualReuse, 1);
  assert.equal(summary.promptHints.orientationChecksAfterHint.statusAfterWorkingTreeHint, 1);
  assert.deepEqual(summary.toolCallsPerPromptTurn.withHint, { turns: 1, min: 3, avg: 3, max: 3 });
  assert.equal(summary.promptHints.estimatedChecksAvoided, null);
});
