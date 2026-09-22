import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileFreshness, fullFileReadInfo } from "../src/reflex/files.js";
import { fingerprint } from "../src/reflex/privacy.js";
import { safePlanActualReuse } from "../src/reflex/reuse.js";
import { advanceFileGenerations, evidenceFromObservation, outputStorageReason } from "../src/reflex/state.js";

const session = "file-session";
const workspaceId = "file-workspace";

function operation(command) {
  return { command, key: "fs.read", family: "filesystem", access: "read-only", eligible: true };
}

function observedState(command, cwd, output) {
  const file = fullFileReadInfo(command, cwd);
  const state = {
    schema: 2, workspaceGeneration: 0,
    generations: { identity: 0, workspace: 0, external: 0 },
    fileGenerations: {}, allFilesGeneration: 0, workspaceId, evidence: [],
  };
  state.evidence.push(evidenceFromObservation({
    operation: operation(command), command, output,
    at: new Date().toISOString(), session, tool: "Bash",
    generations: state.generations, workspaceGeneration: 0, workspaceId,
    fileKey: file.key, fileFreshness: fileFreshness(file.path),
    fileGeneration: 0, allFilesGeneration: 0,
  }));
  return state;
}

function plan(state, command, cwd) {
  return safePlanActualReuse(state, {
    operation: operation(command), session, commandHash: fingerprint(command),
    platform: "win32", cwd,
  });
}

test("full file evidence survives unrelated edits but refreshes after same-file edits or deletion", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "model-switch-file-reuse-"));
  try {
    const target = path.join(cwd, "target.txt");
    const unrelated = path.join(cwd, "other.txt");
    const command = "Get-Content -Raw target.txt";
    await writeFile(target, "original\n", "utf8");
    await writeFile(unrelated, "other\n", "utf8");
    const state = observedState(command, cwd, "original\n");

    assert.equal(plan(state, command, cwd).outcome, "actual_reuse");

    await writeFile(unrelated, "changed unrelated\n", "utf8");
    advanceFileGenerations(state, [fullFileReadInfo("Get-Content -Raw other.txt", cwd).key]);
    assert.equal(plan(state, command, cwd).outcome, "actual_reuse");

    await writeFile(target, "changed target and length\n", "utf8");
    assert.equal(plan(state, command, cwd).reason, "file_changed");

    await unlink(target);
    assert.equal(plan(state, command, cwd).reason, "file_changed");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("known edits to the same path invalidate file evidence immediately", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "model-switch-file-generation-"));
  try {
    const command = "Get-Content file.txt";
    await writeFile(path.join(cwd, "file.txt"), "value\n", "utf8");
    const state = observedState(command, cwd, "value\n");
    advanceFileGenerations(state, [fullFileReadInfo(command, cwd).key]);
    assert.equal(plan(state, command, cwd).reason, "stale_after_mutation");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("sensitive and oversized file reads retain no reusable output", () => {
  assert.equal(outputStorageReason(operation("Get-Content .env"), "Get-Content .env", "SAFE=value\n"), "sensitive_or_invalid_output");
  assert.equal(outputStorageReason(operation("Get-Content large.txt"), "Get-Content large.txt", "x".repeat(32769)), "oversized_output");
});
