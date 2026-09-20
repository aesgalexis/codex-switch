import test from "node:test";
import assert from "node:assert/strict";
import { inspectRequest } from "../src/request.js";

test("extracts the latest user request and routing metadata", () => {
  const inspected = inspectRequest({
    model: "gpt-5.6-sol",
    reasoning: { effort: "high" },
    prompt_cache_key: "session-123",
    tools: [{ type: "function" }],
    input: [
      {
        role: "user",
        content: [{ type: "input_text", text: "Fix this small typo." }],
      },
    ],
  });

  assert.equal(inspected.currentModel, "gpt-5.6-sol");
  assert.equal(inspected.currentEffort, "high");
  assert.equal(inspected.latestUserText, "Fix this small typo.");
  assert.equal(inspected.isNewUserStep, true);
  assert.equal(inspected.sessionKey, "session-123");
  assert.equal(inspected.toolCount, 1);
});

test("does not invent a global session key", () => {
  const inspected = inspectRequest({
    model: "gpt-5.6-sol",
    input: [{ type: "function_call_output", output: "done" }],
  });

  assert.equal(inspected.sessionKey, null);
  assert.equal(inspected.isNewUserStep, false);
});
