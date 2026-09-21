const READ_ONLY_CHECKS = new Map([
  ["pwd", "workspace.pwd"],
  ["git rev-parse --show-toplevel", "git.root"],
  ["git branch --show-current", "git.branch"],
  ["git rev-parse HEAD", "git.head"],
  ["git status --short", "git.status.short"],
  ["git status --porcelain", "git.status.porcelain"],
  ["git status --porcelain=v1", "git.status.porcelain"],
]);

function normalize(command) {
  return command.trim().replace(/\s+/g, " ");
}

function hasCompoundShellSyntax(command) {
  return /[\r\n;&|><`]/.test(command) || command.includes("$(");
}

export function classifyBashCommand(command) {
  if (typeof command !== "string" || command.trim() === "") {
    return {
      eligible: false,
      kind: "invalid",
      key: null,
      compound: false,
    };
  }

  const normalized = normalize(command);
  const compound = hasCompoundShellSyntax(normalized);

  if (compound) {
    return {
      eligible: false,
      kind: "compound",
      key: null,
      compound: true,
    };
  }

  const key = READ_ONLY_CHECKS.get(normalized) ?? null;

  return {
    eligible: Boolean(key),
    kind: key ? "read-only-check" : "other",
    key,
    compound: false,
  };
}

export const recognizedReadOnlyChecks = Object.freeze(
  Object.fromEntries(READ_ONLY_CHECKS),
);
