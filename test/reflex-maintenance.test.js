import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { diagnoseReflex, formatDoctor } from "../src/reflex/doctor.js";
import { rotateReflexLog } from "../src/reflex/rotate.js";
import { REFLEX_RUNTIME } from "../src/reflex/runtime.js";
import { summarizeReflexEvents } from "../src/reflex/stats.js";

test("doctor reports configured hooks and readable state without exposing Jev key", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reflex-doctor-"));
  const directory = path.join(root, ".model-switch");
  const log = path.join(directory, "reflex-events.jsonl");
  const stateFile = path.join(directory, "reflex-state.json");
  try {
    await mkdir(path.join(root, ".codex"));
    await mkdir(path.join(root, "src", "hooks"), { recursive: true });
    await writeFile(path.join(root, "src", "hooks", "reflex-hook.js"), "// hook\n");
    await mkdir(directory);
    await writeFile(path.join(root, ".codex", "hooks.json"), JSON.stringify({ hooks: Object.fromEntries(
      ["UserPromptSubmit", "PreToolUse", "PostToolUse"].map((name) => [name, [{ hooks: [{ type: "command", command: "node reflex-hook.js", commandWindows: "node reflex-hook.js" }] }]])
    ) }));
    await writeFile(log, "{}\n");
    await writeFile(stateFile, JSON.stringify({ schema: 2, workspaceGeneration: 7, evidence: [{}, {}] }));
    const report = await diagnoseReflex({ root, log, stateFile, env: { TYPESAFE_API_KEY: "do-not-print", MODEL_SWITCH_PROMPT_HINT_MODE: "inject" } });
    const output = formatDoctor(report);
    assert.equal(report.runtime, REFLEX_RUNTIME);
    assert.deepEqual(Object.values(report.hooks), [true, true, true]);
    assert.equal(report.hookScriptExists, true);
    assert.equal(report.state.generation, 7);
    assert.equal(report.state.evidence, 2);
    assert.match(output, /Prompt hints: inject/);
    assert.doesNotMatch(output, /do-not-print/);
    await writeFile(stateFile, "{broken");
    const broken = await diagnoseReflex({ root, log, stateFile });
    assert.equal(broken.state.readable, false);
    assert.match(formatDoctor(broken), /WARNING: Evidence state cannot be read correctly/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("doctor warns when hooks and telemetry have not been initialized", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reflex-doctor-empty-"));
  try {
    const report = await diagnoseReflex({ root, log: path.join(root, "missing.jsonl"), stateFile: path.join(root, "missing.json") });
    assert.equal(report.hooks.PreToolUse, false);
    assert.equal(report.state.readable, false);
    assert.match(formatDoctor(report), /WARNING: Event log does not exist yet/);
    assert.match(formatDoctor(report), /WARNING: PreToolUse hook not configured/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("rotate retains the event history and evidence state, including absent-log case", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reflex-rotate-"));
  const directory = path.join(root, ".model-switch");
  const log = path.join(directory, "reflex-events.jsonl");
  const stateFile = path.join(directory, "reflex-state.json");
  try {
    await mkdir(directory);
    await writeFile(stateFile, "evidence-state");
    assert.equal((await rotateReflexLog({ log, directory })).rotated, false);
    await writeFile(log, "history\n");
    const rotated = await rotateReflexLog({ log, directory, now: new Date("2026-09-22T10:00:00.000Z") });
    assert.equal(rotated.rotated, true);
    assert.match(path.basename(rotated.destination), /^reflex-events-2026-09-22T10-00-00-000Z\.jsonl$/);
    assert.equal(await readFile(rotated.destination, "utf8"), "history\n");
    assert.equal(await readFile(stateFile, "utf8"), "evidence-state");
    assert.deepEqual((await readdir(directory)).sort(), [path.basename(rotated.destination), "reflex-state.json"].sort());
    await assert.rejects(rotateReflexLog({ log: path.join(root, "outside.jsonl"), directory }), /inside .model-switch/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("stats distinguish unmarked history from the current runtime", () => {
  const summary = summarizeReflexEvents([{ event: "PreToolUse" }, { event: "PreToolUse", reflexRuntime: REFLEX_RUNTIME }]);
  assert.equal(summary.byReflexRuntime["legacy-unmarked"], 1);
  assert.equal(summary.byReflexRuntime[REFLEX_RUNTIME], 1);
});
