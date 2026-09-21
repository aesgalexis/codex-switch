const MUTATING_GIT = new Set([
  "add", "apply", "checkout", "cherry-pick", "clean", "clone", "commit",
  "fetch", "gc", "init", "merge", "mv", "pull", "push", "rebase", "reset",
  "restore", "revert", "rm", "stash", "switch", "tag", "worktree",
]);

const SHELL_READ_ONLY = new Map([
  ["pwd", "workspace.pwd"], ["get-location", "workspace.pwd"],
  ["ls", "fs.list"], ["dir", "fs.list"], ["get-childitem", "fs.list"], ["gci", "fs.list"],
  ["cat", "fs.read"], ["type", "fs.read"], ["get-content", "fs.read"], ["gc", "fs.read"],
  ["findstr", "fs.search"], ["select-string", "fs.search"], ["rg", "fs.search"],
  ["test-path", "fs.exists"], ["get-item", "fs.metadata"], ["get-itemproperty", "fs.metadata"],
  ["stat", "fs.metadata"], ["resolve-path", "fs.metadata"], ["where", "fs.search"],
  ["where.exe", "fs.search"], ["head", "fs.read"], ["tail", "fs.read"], ["wc", "fs.read"],
]);

const SHELL_MUTATING = new Set([
  "rm", "remove-item", "del", "erase", "rmdir", "rd", "mv", "move-item",
  "cp", "copy-item", "new-item", "set-content", "add-content", "out-file",
  "mkdir", "md", "touch", "chmod", "chown", "invoke-webrequest", "curl",
]);

function normalize(command) {
  return command.trim().replace(/\s+/g, " ");
}

function tokenize(command) {
  const tokens = [];
  let token = "";
  let quote = null;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (quote) {
      token += char;
      if (char === quote && command[index - 1] !== "\\") quote = null;
    } else if (char === "'" || char === '"') {
      quote = char;
      token += char;
    } else if (/\s/.test(char)) {
      if (token) {
        tokens.push(token);
        token = "";
      }
    } else token += char;
  }
  if (token) tokens.push(token);
  return tokens;
}

function operation(command, { key = null, family, access, reason = null }) {
  return {
    command: normalize(command),
    eligible: access === "read-only" && Boolean(key),
    kind: access === "read-only" ? "read-only-check" : access,
    key,
    family,
    access,
    reason,
  };
}

function classifyGit(command, tokens) {
  const sub = tokens[1];
  if (!sub) return operation(command, { family: "git", access: "unknown" });
  if (["--version", "-v"].includes(sub)) return operation(command, { key: "git.version", family: "git", access: "read-only" });
  if (tokens.includes("--output") || tokens.some((token) => token.startsWith("--output="))) {
    return operation(command, { family: "git", access: "mutating", reason: "git.output" });
  }
  if (MUTATING_GIT.has(sub)) {
    if (sub === "tag" && tokens.some((token) => token === "-l" || token === "--list")) {
      return operation(command, { key: "git.tag.list", family: "git", access: "read-only" });
    }
    return operation(command, { family: "git", access: "mutating", reason: `git.${sub}` });
  }

  if (sub === "status") {
    const suffix = tokens.includes("--short") || tokens.includes("-s")
      ? "short"
      : tokens.some((token) => token.startsWith("--porcelain")) ? "porcelain" : "full";
    return operation(command, { key: `git.status.${suffix}`, family: "git", access: "read-only" });
  }
  if (sub === "diff") {
    const suffix = tokens.includes("--cached") || tokens.includes("--staged") ? "cached" : "worktree";
    return operation(command, { key: `git.diff.${suffix}`, family: "git", access: "read-only" });
  }
  if (sub === "branch") {
    const args = tokens.slice(2);
    const valueFlags = new Set(["--contains", "--merged", "--no-merged", "--format"]);
    let consumesValue = false;
    let hasPositional = false;
    for (const arg of args) {
      if (consumesValue) {
        consumesValue = false;
        continue;
      }
      if (valueFlags.has(arg)) {
        consumesValue = true;
        continue;
      }
      if (!arg.startsWith("-")) hasPositional = true;
    }
    if (!hasPositional) {
      const key = tokens.includes("--show-current") ? "git.branch.current" : "git.branch.list";
      return operation(command, { key, family: "git", access: "read-only" });
    }
    return operation(command, { family: "git", access: "mutating", reason: "git.branch.change" });
  }
  if (sub === "remote") {
    if (tokens.length === 2 || tokens.includes("-v") || ["show", "get-url"].includes(tokens[2])) {
      return operation(command, { key: "git.remote", family: "git", access: "read-only" });
    }
    return operation(command, { family: "git", access: "mutating", reason: "git.remote.change" });
  }
  if (sub === "config") {
    const mutating = tokens.some((token) => ["--add", "--unset", "--unset-all", "--rename-section", "--remove-section", "--edit", "-e"].includes(token));
    const readOnly = tokens.some((token) => token.startsWith("--get") || ["--list", "-l", "--show-origin", "--show-scope"].includes(token));
    return operation(command, { key: readOnly && !mutating ? "git.config.read" : null, family: "git", access: readOnly && !mutating ? "read-only" : "mutating", reason: mutating ? "git.config.change" : null });
  }

  const readOnly = new Map([
    ["rev-parse", "git.rev-parse"], ["log", "git.log"], ["show", "git.show"],
    ["ls-files", "git.ls-files"], ["ls-tree", "git.ls-tree"], ["describe", "git.describe"],
    ["grep", "git.grep"], ["reflog", "git.reflog"], ["count-objects", "git.count-objects"],
    ["cat-file", "git.cat-file"], ["name-rev", "git.name-rev"], ["merge-base", "git.merge-base"],
    ["diff-tree", "git.diff-tree"], ["for-each-ref", "git.for-each-ref"],
    ["show-ref", "git.show-ref"], ["shortlog", "git.shortlog"], ["blame", "git.blame"],
  ]);
  if (readOnly.has(sub)) {
    let key = readOnly.get(sub);
    if (sub === "rev-parse" && tokens.length === 3) {
      if (tokens[2] === "head") key = "git.head";
      if (tokens[2] === "--show-toplevel") key = "git.root";
    }
    return operation(command, { key, family: "git", access: "read-only" });
  }
  return operation(command, { family: "git", access: "unknown" });
}

function classifyNpm(command, tokens) {
  const sub = tokens[1];
  if (["--version", "-v"].includes(sub)) return operation(command, { key: "runtime.npm.version", family: "npm", access: "read-only" });
  if (sub === "run" && tokens[2] === "reflex:stats" && tokens.length === 3) return operation(command, { key: "model-switch.reflex.stats", family: "npm", access: "read-only" });
  if (["ls", "list", "view", "info", "explain", "outdated", "doctor", "help"].includes(sub)) {
    return operation(command, { key: `npm.${sub}`, family: "npm", access: "read-only" });
  }
  if (sub === "config" && ["get", "list", "ls"].includes(tokens[2])) return operation(command, { key: "npm.config.read", family: "npm", access: "read-only" });
  if (sub === "pkg" && tokens[2] === "get") return operation(command, { key: "npm.pkg.get", family: "npm", access: "read-only" });
  return operation(command, { family: "npm", access: "mutating", reason: "project-command" });
}

function classifyGh(command, tokens) {
  const noun = tokens[1];
  const verb = tokens[2];
  const safe = new Set(["list", "view", "status", "checks", "diff", "watch"]);
  if (noun === "api") {
    const methodIndex = tokens.indexOf("--method");
    const method = tokens.find((token) => token.startsWith("--method="))?.split("=")[1] ?? (methodIndex >= 0 ? tokens[methodIndex + 1] : "get");
    const hasBody = tokens.some((token) => ["-f", "--raw-field", "-f", "--field", "--input"].includes(token));
    if (method?.toLowerCase() === "get" && !hasBody) return operation(command, { key: "gh.api.get", family: "gh", access: "read-only" });
    return operation(command, { family: "gh", access: "mutating", reason: "gh.api.write" });
  }
  if ((noun === "auth" && verb === "status") || safe.has(verb)) return operation(command, { key: `gh.${noun}.${verb}`, family: "gh", access: "read-only" });
  return operation(command, { family: "gh", access: "mutating", reason: "gh.command" });
}

function classifyFirebase(command, tokens) {
  const sub = tokens[1];
  if (!sub || (sub === "use" && tokens.length === 2) || /(^|:)(list|get)$/.test(sub) || sub === "--version") {
    return operation(command, { key: `firebase.${sub ?? "info"}`, family: "firebase", access: "read-only" });
  }
  return operation(command, { family: "firebase", access: "mutating", reason: "firebase.command" });
}

function classifyGcloud(command, tokens) {
  const joined = tokens.slice(1).join(" ");
  const readOnly = /(^| )(list|describe|get-value|versions)( |$)/.test(joined) && !/( add-| set| delete| deploy| update| create| remove)/.test(` ${joined}`);
  return operation(command, { key: readOnly ? "gcloud.read" : null, family: "gcloud", access: readOnly ? "read-only" : "mutating", reason: readOnly ? null : "gcloud.command" });
}

export function classifySimpleCommand(command) {
  const normalized = normalize(command);
  const tokens = tokenize(normalized).map((token) => token.toLowerCase());
  const executable = tokens[0]?.replace(/\.cmd$/, "");
  if (!executable) return operation(command, { family: "unknown", access: "unknown" });
  if (executable === "git") return classifyGit(normalized, tokens);
  if (executable === "npm") return classifyNpm(normalized, tokens);
  if (executable === "node" && ["--version", "-v"].includes(tokens[1])) return operation(command, { key: "runtime.node.version", family: "node", access: "read-only" });
  if (executable === "node" && tokens[1] === "--check" && tokens.length === 3) return operation(command, { key: "runtime.node.check", family: "node", access: "read-only" });
  if (executable === "gh") return classifyGh(normalized, tokens);
  if (executable === "firebase") return classifyFirebase(normalized, tokens);
  if (executable === "gcloud") return classifyGcloud(normalized, tokens);
  if (executable === "find") {
    const mutating = tokens.some((token) => ["-delete", "-exec", "-execdir", "-ok", "-okdir"].includes(token));
    return operation(command, { key: mutating ? null : "fs.search", family: "filesystem", access: mutating ? "mutating" : "read-only", reason: mutating ? "find.action" : null });
  }
  if (SHELL_READ_ONLY.has(executable)) return operation(command, { key: SHELL_READ_ONLY.get(executable), family: executable === "rg" ? "search" : "filesystem", access: "read-only" });
  if (SHELL_MUTATING.has(executable)) return operation(command, { family: "filesystem", access: "mutating", reason: "filesystem.write" });
  return operation(command, { family: executable, access: "unknown" });
}

function splitSafeSemicolons(command) {
  const parts = [];
  let current = "";
  let quote = null;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (quote) {
      current += char;
      if (char === quote && command[index - 1] !== "\\") quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      continue;
    }
    if (char === "\r" || char === "\n" || char === "|" || char === ">" || char === "<" || char === "`" || char === "&" || char === "$" || char === "{" || char === "}") {
      return { safe: false, parts: [] };
    }
    if (char === ";") {
      if (current.trim()) parts.push(current.trim());
      current = "";
    } else current += char;
  }
  if (quote) return { safe: false, parts: [] };
  if (current.trim()) parts.push(current.trim());
  if (parts.some((part) => /^(if|else|elseif|for|foreach|while|switch|try|catch|finally)\b/i.test(part))) return { safe: false, parts: [] };
  return { safe: true, parts };
}

export function classifyBashCommand(command) {
  if (typeof command !== "string" || command.trim() === "") {
    return { eligible: false, kind: "invalid", compound: false, safeCompound: false, operations: [], potentiallyMutating: true };
  }
  const normalized = normalize(command);
  const compoundHint = /[;\r\n|><`&${}]/.test(command) || /&&|\|\|/.test(command);
  if (!compoundHint) {
    const classified = classifySimpleCommand(normalized);
    return { ...classified, compound: false, safeCompound: false, operations: [classified], potentiallyMutating: classified.access !== "read-only" };
  }
  const split = splitSafeSemicolons(command);
  if (!split.safe || split.parts.length < 2) {
    return { eligible: false, kind: "compound-unsafe", key: null, family: "compound", access: "unknown", compound: true, safeCompound: false, operations: [], potentiallyMutating: true };
  }
  const operations = split.parts.map(classifySimpleCommand);
  return {
    eligible: operations.every((item) => item.eligible), kind: "compound", key: null,
    family: "compound", access: operations.every((item) => item.access === "read-only") ? "read-only" : "mixed",
    compound: true, safeCompound: true, operations,
    potentiallyMutating: operations.some((item) => item.access !== "read-only"),
  };
}

export const recognizedReadOnlyChecks = Object.freeze({
  git: "explicit Git inspections", filesystem: "location, listing, reading, search, existence, and metadata",
  runtime: "Node/npm versions and npm inspections", external: "bounded gh, Firebase, and gcloud queries",
});
