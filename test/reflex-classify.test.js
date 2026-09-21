import test from "node:test";
import assert from "node:assert/strict";
import { classifyBashCommand, classifySimpleCommand } from "../src/reflex/classify.js";

test("recognizes broad read-only Git, filesystem, runtime, and external queries", () => {
  const cases = [
    ["git rev-parse HEAD", "git.head"], ["git status", "git.status.full"],
    ["git diff --cached", "git.diff.cached"], ["git log -5 --oneline", "git.log"],
    ["git remote -v", "git.remote"], ["git config --get user.name", "git.config.read"],
    ["Get-ChildItem -Force", "fs.list"], ["rg -n hooks src", "fs.search"],
    ["Test-Path package.json", "fs.exists"], ["node --version", "runtime.node.version"],
    ["npm ls", "npm.ls"], ["npm run reflex:stats", "model-switch.reflex.stats"],
    ["node --check src/server.js", "runtime.node.check"], ["gh pr list", "gh.pr.list"],
    ["firebase projects:list", "firebase.projects:list"],
  ];
  for (const [command, key] of cases) {
    const classified = classifySimpleCommand(command);
    assert.equal(classified.access, "read-only", command);
    assert.equal(classified.key, key, command);
  }
});

test("keeps mutating and ambiguous commands out", () => {
  for (const command of ["git add README.md", "git branch new-name", "git config user.name x", "git show --output=result.txt HEAD", "npm install", "gh pr merge 1", "find . -delete"]) {
    assert.notEqual(classifySimpleCommand(command).access, "read-only", command);
  }
});

test("splits only safe semicolon compounds and recognizes internal operations", () => {
  const classified = classifyBashCommand("git rev-parse HEAD; git status --short");
  assert.equal(classified.compound, true);
  assert.equal(classified.safeCompound, true);
  assert.equal(classified.potentiallyMutating, false);
  assert.deepEqual(classified.operations.map((item) => item.key), ["git.head", "git.status.short"]);
});

test("does not interpret pipes, redirects, variables, conditionals, or subshells", () => {
  for (const command of ["git log | Select-String fix", "git status > out.txt", "git show $env:REF", "git rev-parse $(git branch --show-current)", "if (Test-Path x) { git status; }"]) {
    const classified = classifyBashCommand(command);
    assert.equal(classified.safeCompound, false, command);
    assert.equal(classified.operations.length, 0, command);
    assert.equal(classified.potentiallyMutating, true, command);
  }
});
