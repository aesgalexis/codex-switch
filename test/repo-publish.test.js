import test from "node:test";
import assert from "node:assert/strict";
import { commitMessage, isForbiddenPublishPath, npmCheckInvocation, pushArguments } from "../scripts/repo-publish.mjs";

test("uses an optional publish message or the neutral default", () => {
  assert.equal(commitMessage([]), "Update model-switch");
  assert.equal(commitMessage(["Expand", "reflex observation"]), "Expand reflex observation");
});

test("rejects local environment, telemetry, and log paths", () => {
  for (const file of [".env", ".env.local", ".model-switch/reflex-events.jsonl", "debug.log"]) {
    assert.equal(isForbiddenPublishPath(file), true, file);
  }
  for (const file of [".env.example", "README.md", "src/reflex/events.js"]) {
    assert.equal(isForbiddenPublishPath(file), false, file);
  }
});

test("pushes normally with upstream and configures origin without one", () => {
  assert.deepEqual(pushArguments("feature/reflex", true), ["push"]);
  assert.deepEqual(pushArguments("feature/reflex", false), ["push", "-u", "origin", "feature/reflex"]);
});

test("runs npm through Node when npm exposes its CLI path", () => {
  const invocation = npmCheckInvocation({ npm_execpath: "C:\\node\\npm-cli.js" }, "win32");
  assert.equal(invocation.command, process.execPath);
  assert.deepEqual(invocation.args, ["C:\\node\\npm-cli.js", "run", "check"]);
});
