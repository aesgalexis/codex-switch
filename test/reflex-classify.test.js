import test from "node:test";
import assert from "node:assert/strict";
import { classifyBashCommand, classifySimpleCommand } from "../src/reflex/classify.js";

test("recognizes broad read-only Git, filesystem, runtime, and external queries", () => {
  const cases = [
    ["git rev-parse HEAD", "git.head"], ["git status", "git.status.full"],
    ["git diff --cached", "git.diff.cached"], ["git log -5 --oneline", "git.log"],
    ["git remote -v", "git.remote"], ["git config --get user.name", "git.config.read"],
    ["Get-ChildItem -Force", "fs.list"], ["rg -n hooks src", "fs.search"],
    ["Test-Path package.json", "fs.exists"], ["Get-FileHash package.json -Algorithm SHA256", "fs.hash"],
    ["node --version", "runtime.node.version"],
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
  for (const command of ["git log | Invoke-Expression", "git status > out.txt", "git show $env:REF", "git rev-parse $(git branch --show-current)", "if (Test-Path x) { git status; }"]) {
    const classified = classifyBashCommand(command);
    assert.equal(classified.safeCompound, false, command);
    assert.equal(classified.operations.length, 0, command);
    assert.equal(classified.potentiallyMutating, true, command);
  }
});

test("allows bounded PowerShell read-only Select-Object pipelines", () => {
  const cases = [
    ["Get-Item package.json | Select-Object Name,Length", ["fs.metadata", "powershell.select-object"]],
    ["Get-FileHash package.json -Algorithm SHA256 | Select-Object -ExpandProperty Hash", ["fs.hash", "powershell.select-object"]],
    ["Get-Content src/reflex/classify.js | Select-Object -Skip 10 -First 20", ["fs.read", "powershell.select-object"]],
  ];
  for (const [command, keys] of cases) {
    const classified = classifyBashCommand(command);
    assert.equal(classified.safeCompound, true, command);
    assert.equal(classified.access, "read-only", command);
    assert.equal(classified.potentiallyMutating, false, command);
    assert.deepEqual(classified.operations.map((item) => item.key), keys, command);
  }
});

test("does not mistake shell metacharacters inside quoted arguments for compounds", () => {
  const classified = classifyBashCommand('rg -n "unknown|unsafe_compound" src test');
  assert.equal(classified.compound, false);
  assert.equal(classified.access, "read-only");
  assert.equal(classified.key, "fs.search");
});

test("rejects mutating, ambiguous, dynamic, and redirected PowerShell pipelines", () => {
  for (const command of [
    "Get-Content package.json | Set-Content copy.json",
    "Get-Content package.json | ForEach-Object Length",
    "Get-Content package.json | Select-Object @{n='x';e={$_.Length}}",
    "Get-Content package.json | Select-Object Name > output.txt",
    "Get-Item Env:API_TOKEN | Select-Object Name,Value",
  ]) {
    const classified = classifyBashCommand(command);
    assert.notEqual(classified.access, "read-only", command);
    assert.equal(classified.safeCompound, false, command);
  }
});
