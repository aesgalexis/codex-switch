import test from "node:test";
import assert from "node:assert/strict";
import { promptHintMode, selectPromptHint, userPromptHookOutput } from "../src/reflex/hints.js";

const now = Date.parse("2026-09-21T10:05:00.000Z");
const workspaceId = "workspace";
const session = "session";

function evidence(kind, value, { generation = 4, timestamp = "2026-09-21T10:04:00.000Z" } = {}) {
  return { kind, value, timestamp, session, workspaceGeneration: generation, workspace: { id: workspaceId }, repo: { id: workspaceId } };
}

function state(items) {
  return { workspaceGeneration: 4, workspaceId, evidence: items };
}

test("selects only fresh deterministic facts for a workspace-relevant prompt", () => {
  const hint = selectPromptHint(state([
    evidence("git.root", "C:/proyectos/model-switch"),
    evidence("git.branch.current", "reflex-phase1-observe"),
    evidence("git.head", "4b6018d0d061882760a2625e8946abc9e38db228"),
  ]), { session, prompt: "Review the project tests", nowMs: now, maxAgeMs: 300000 });
  assert.deepEqual(hint.facts.map((fact) => fact.kind), ["git.root", "git.branch.current", "git.head"]);
  assert.match(hint.text, /repo_root: C:\/proyectos\/model-switch/);
});

test("uses repo root alone for a prompt without workspace intent", () => {
  const hint = selectPromptHint(state([
    evidence("git.root", "C:/proyectos/model-switch"),
    evidence("git.head", "4b6018d0d061882760a2625e8946abc9e38db228"),
  ]), { session, prompt: "Hola", nowMs: now, maxAgeMs: 300000 });
  assert.deepEqual(hint.facts.map((fact) => fact.kind), ["git.root"]);
});

test("rejects stale, wrong-generation, wrong-session, and invalid evidence", () => {
  const hint = selectPromptHint(state([
    evidence("git.root", "C:/old", { timestamp: "2026-09-21T09:00:00.000Z" }),
    evidence("git.branch.current", "main", { generation: 3 }),
    { ...evidence("git.head", "4b6018d0d061882760a2625e8946abc9e38db228"), session: "other" },
    evidence("git.head", "secret\nleak"),
  ]), { session, prompt: "Review project code", nowMs: now, maxAgeMs: 300000 });
  assert.deepEqual(hint, { facts: [], text: null });
});

test("does not copy prompt text or secrets into the hint", () => {
  const secret = "TOKEN=do-not-copy-this";
  const hint = selectPromptHint(state([evidence("git.root", "C:/proyectos/model-switch")]), {
    session, prompt: `Review project ${secret}`, nowMs: now, maxAgeMs: 300000,
  });
  assert.equal(hint.text.includes(secret), false);
  assert.equal(hint.text.includes("TOKEN"), false);
});

test("produces the documented UserPromptSubmit output and conservative mode defaults", () => {
  assert.deepEqual(userPromptHookOutput("facts"), {
    hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: "facts" },
  });
  assert.equal(promptHintMode("inject"), "inject");
  assert.equal(promptHintMode("invalid"), "observe");
});

test("missing or malformed evidence produces no hint", () => {
  assert.deepEqual(selectPromptHint({ workspaceGeneration: 0, workspaceId, evidence: null }, { session, prompt: "Review code" }), { facts: [], text: null });
});
