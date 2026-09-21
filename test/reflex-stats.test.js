import test from "node:test";
import assert from "node:assert/strict";
import { summarizeReflexEvents } from "../src/reflex/stats.js";

test("counts repeated eligible checks within a session", () => {
  const events = [
    {
      event: "PreToolUse",
      at: "2026-09-21T10:00:00.000Z",
      session: "abc",
      eligible: true,
      commandKey: "git.head",
    },
    {
      event: "PostToolUse",
      at: "2026-09-21T10:00:00.100Z",
      session: "abc",
      eligible: true,
      commandKey: "git.head",
    },
    {
      event: "PreToolUse",
      at: "2026-09-21T10:00:05.000Z",
      session: "abc",
      eligible: true,
      commandKey: "git.head",
    },
    {
      event: "PreToolUse",
      at: "2026-09-21T10:00:06.000Z",
      session: "different",
      eligible: true,
      commandKey: "git.head",
    }
  ];

  assert.deepEqual(summarizeReflexEvents(events), {
    totalEvents: 4,
    preToolUseEvents: 3,
    eligibleChecks: 3,
    repeatedEligibleChecks: 1,
    repeatRate: 0.3333,
    byCommand: { "git.head": 3 },
    repeatIntervals: {
      count: 1,
      minMs: 5000,
      avgMs: 5000,
      maxMs: 5000
    }
  });
});
