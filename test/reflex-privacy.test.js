import test from "node:test";
import assert from "node:assert/strict";
import { redactCommand } from "../src/reflex/privacy.js";

test("redacts common credentials from locally recorded commands", () => {
  const redacted = redactCommand("TOKEN=\"abc 123\" curl --token abc123 -H 'Authorization: Bearer secret-token' https://user:pass@example.test");
  assert.equal(redacted.includes("abc123"), false);
  assert.equal(redacted.includes("secret-token"), false);
  assert.equal(redacted.includes("user:pass"), false);
  assert.equal(redacted.includes("abc 123"), false);
  assert.match(redacted, /\[REDACTED\]/);
});
