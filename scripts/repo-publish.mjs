import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_MESSAGE = "Update model-switch";

export function commitMessage(args) {
  const message = args.join(" ").trim();
  return message || DEFAULT_MESSAGE;
}

export function isForbiddenPublishPath(file) {
  const normalized = file.replaceAll("\\", "/").toLowerCase();
  return normalized === ".env" ||
    (normalized.startsWith(".env.") && normalized !== ".env.example") ||
    normalized === ".model-switch" ||
    normalized.startsWith(".model-switch/") ||
    normalized.endsWith(".log");
}

export function pushArguments(branch, hasUpstream) {
  return hasUpstream ? ["push"] : ["push", "-u", "origin", branch];
}

export function npmCheckInvocation(env = process.env, platform = process.platform) {
  if (env.npm_execpath) {
    return { command: process.execPath, args: [env.npm_execpath, "run", "check"] };
  }
  return { command: platform === "win32" ? "npm.cmd" : "npm", args: ["run", "check"] };
}

function execute(command, args, { capture = false, allowFailure = false, cwd } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) {
    const detail = capture ? (result.stderr || result.stdout).trim() : "";
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}${detail ? `: ${detail}` : ""}`);
  }
  return result;
}

function output(command, args, cwd) {
  return execute(command, args, { capture: true, cwd }).stdout.trim();
}

function assertPublishIgnores(root) {
  for (const candidate of [".env", ".model-switch/reflex-events.jsonl", "repo-publish-check.log"]) {
    const result = execute("git", ["check-ignore", "--quiet", "--no-index", "--", candidate], {
      allowFailure: true,
      capture: true,
      cwd: root,
    });
    if (result.status !== 0) throw new Error(`Safety check failed: ${candidate} is not ignored by Git.`);
  }
}

function assertNoSensitiveTrackedFiles(root) {
  const tracked = output("git", ["ls-files", "-z"], root).split("\0").filter(Boolean);
  const forbidden = tracked.filter(isForbiddenPublishPath);
  if (forbidden.length > 0) {
    throw new Error(`Refusing to publish tracked sensitive/local files: ${forbidden.join(", ")}`);
  }
}

function stagedPaths(root) {
  return output("git", ["diff", "--cached", "--name-only", "-z"], root).split("\0").filter(Boolean);
}

export async function publish(args = process.argv.slice(2)) {
  const initialCwd = process.cwd();
  const root = output("git", ["rev-parse", "--show-toplevel"], initialCwd);
  if (!root) throw new Error("Not inside a Git repository.");

  const check = npmCheckInvocation();
  execute(check.command, check.args, { cwd: root });
  process.stdout.write("✓ Checks OK\n");

  const branch = output("git", ["branch", "--show-current"], root);
  if (!branch) throw new Error("Refusing to publish from a detached HEAD.");
  output("git", ["remote", "get-url", "origin"], root);
  process.stdout.write(`Branch: ${branch}\n`);

  const status = output("git", ["status", "--short", "--branch"], root);
  if (status) process.stdout.write(`${status}\n`);

  assertPublishIgnores(root);
  assertNoSensitiveTrackedFiles(root);
  execute("git", ["add", "-A"], { cwd: root });

  const staged = stagedPaths(root);
  const forbiddenStaged = staged.filter(isForbiddenPublishPath);
  if (forbiddenStaged.length > 0) {
    throw new Error(`Refusing to commit sensitive/local files: ${forbiddenStaged.join(", ")}`);
  }

  if (staged.length > 0) {
    const message = commitMessage(args);
    execute("git", ["commit", "-m", message], { cwd: root });
    process.stdout.write(`Commit: ${message}\n`);
  } else {
    process.stdout.write("Commit: no staged changes\n");
  }

  const upstream = execute(
    "git",
    ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
    { allowFailure: true, capture: true, cwd: root },
  );
  execute("git", pushArguments(branch, upstream.status === 0), { cwd: root });
  process.stdout.write(`Push: completed for ${branch}\n`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  publish().catch((error) => {
    process.stderr.write(`repo:publish aborted: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
