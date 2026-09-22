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

test("adds bounded working-tree state from fresh status evidence", () => {
  const hint = selectPromptHint(state([
    evidence("git.root", "C:/proyectos/model-switch"),
    evidence("git.status.short", " M README.md\n?? notes.txt\n"),
  ]), { session, prompt: "Review project code", nowMs: now, maxAgeMs: 300000 });
  assert.match(hint.text, /working_tree: dirty/);
  assert.match(hint.text, /modified: README.md, notes.txt/);
});

test("selects only fresh deterministic facts for a workspace-relevant prompt", () => {
  const hint = selectPromptHint(state([
    evidence("git.root", "C:/proyectos/model-switch"),
    evidence("git.branch.current", "reflex-phase1-observe"),
    evidence("git.head", "4b6018d0d061882760a2625e8946abc9e38db228"),
  ]), { session, prompt: "Review the project tests", nowMs: now, maxAgeMs: 300000 });
  assert.deepEqual(hint.facts.map((fact) => fact.kind), ["git.root", "git.branch.current", "git.head"]);
  assert.match(hint.text, /repo_root: C:\/proyectos\/model-switch/);
});

test("omits workspace facts for a prompt without workspace intent", () => {
  const hint = selectPromptHint(state([
    evidence("git.root", "C:/proyectos/model-switch"),
    evidence("git.head", "4b6018d0d061882760a2625e8946abc9e38db228"),
  ]), { session, prompt: "Hola", nowMs: now, maxAgeMs: 300000 });
  assert.deepEqual(hint.facts.map((fact) => fact.kind), []);
});

test("provides a bounded workspace location before any command evidence exists", () => {
  const hint = selectPromptHint(state([]), { session, prompt: "Review the repo", cwd: "C:/proyectos/model-switch", nowMs: now });
  assert.deepEqual(hint.facts.map((fact) => fact.kind), ["workspace.cwd"]);
  assert.match(hint.text, /workspace_cwd: C:\/proyectos\/model-switch/);
});

test("reuses fresh workspace evidence across sessions and bounds changed files", () => {
  const status = [" M one.js", " M two.js", " M three.js", " M four.js", " M five.js", " M six.js"].join("\n");
  const hint = selectPromptHint(state([
    { ...evidence("git.branch.current", "feature/hints"), session: "earlier-session" },
    { ...evidence("git.status.short", status), session: "earlier-session" },
  ]), { session: "new-session", prompt: "Implement the project change", nowMs: now, maxAgeMs: 300000 });
  assert.match(hint.text, /branch: feature\/hints/);
  assert.match(hint.text, /modified: one.js, two.js, three.js, four.js, five.js \(\+1 more\)/);
  assert.equal(hint.text.includes("six.js"), false);
});

test("omits sensitive changed filenames from prompt context", () => {
  const hint = selectPromptHint(state([
    evidence("git.status.short", " M src/app.js\n?? .env.local\n?? credentials.json\n"),
  ]), { session, prompt: "Review project files", nowMs: now, maxAgeMs: 300000 });
  assert.match(hint.text, /modified: src\/app.js/);
  assert.equal(hint.text.includes(".env"), false);
  assert.equal(hint.text.includes("credentials"), false);
});

test("rejects stale, wrong-generation, and invalid evidence while allowing the same workspace across sessions", () => {
  const hint = selectPromptHint(state([
    evidence("git.root", "C:/old", { timestamp: "2026-09-21T09:00:00.000Z" }),
    evidence("git.branch.current", "main", { generation: 3 }),
    { ...evidence("git.head", "4b6018d0d061882760a2625e8946abc9e38db228"), session: "other" },
    evidence("git.head", "secret\nleak"),
  ]), { session, prompt: "Review project code", nowMs: now, maxAgeMs: 300000 });
  assert.deepEqual(hint.facts.map((fact) => fact.kind), ["git.head"]);
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
  assert.equal(promptHintMode("invalid"), "inject");
});

test("missing or malformed evidence produces no hint", () => {
  assert.deepEqual(selectPromptHint({ workspaceGeneration: 0, workspaceId, evidence: null }, { session, prompt: "Review code" }), { facts: [], text: null });
});
