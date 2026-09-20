import test from "node:test";
import assert from "node:assert/strict";
import { createStats } from "../src/stats.js";

test("tracks recommendations without storing prompt content", () => {
  const stats = createStats();

  stats.request();
  stats.responseRequest();
  stats.decision({
    source: "jev",
    model: "gpt-5.6-luna",
    effort: "low",
  });
  stats.passthrough();

  const snapshot = stats.snapshot();

  assert.equal(snapshot.requests, 1);
  assert.equal(snapshot.responseRequests, 1);
  assert.equal(snapshot.jevDecisions, 1);
  assert.equal(snapshot.passthrough, 1);
  assert.deepEqual(snapshot.recommendations.models, {
    "gpt-5.6-luna": 1,
  });
  assert.deepEqual(snapshot.recommendations.efforts, {
    low: 1,
  });
  assert.equal("prompt" in snapshot, false);
});
