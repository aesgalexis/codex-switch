import test from "node:test";
import assert from "node:assert/strict";
import { classifyBashCommand } from "../src/reflex/classify.js";

test("recognizes initial read-only orientation checks", () => {
  assert.deepEqual(classifyBashCommand("git rev-parse HEAD"), {
    eligible: true,
    kind: "read-only-check",
    key: "git.head",
    compound: false,
  });

  assert.equal(classifyBashCommand("  git   status   --short  ").key, "git.status.short");
});

test("rejects compound and unknown commands", () => {
  assert.deepEqual(classifyBashCommand("git rev-parse HEAD && git status --short"), {
    eligible: false,
    kind: "compound",
    key: null,
    compound: true,
  });

  assert.equal(classifyBashCommand("git log -1").eligible, false);
});
