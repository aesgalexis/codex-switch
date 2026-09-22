import path from "node:path";
import { statSync } from "node:fs";
import { fingerprint } from "./privacy.js";

function insideWorkspace(filename, cwd) {
  const root = path.resolve(cwd);
  const absolute = path.resolve(root, filename);
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return { absolute, key: fingerprint(absolute.toLowerCase()) };
}

export function fullFileReadKey(command, cwd) {
  return fullFileReadInfo(command, cwd)?.key ?? null;
}

export function fullFileReadInfo(command, cwd) {
  if (typeof command !== "string" || /[|><;&`$\r\n{}*?]/.test(command)) return null;
  const match = /^(?:cat|type|get-content|gc)\s+(?:(?:-raw|-force)\s+)*(?:(?:-literalpath|-path)\s+)?(?:'([^']+)'|"([^"]+)"|(\S+))$/i.exec(command.trim());
  if (!match) return null;
  const filename = match[1] ?? match[2] ?? match[3];
  if (filename.startsWith("-")) return null;
  const resolved = insideWorkspace(filename, cwd);
  if (!resolved) return null;
  return { key: resolved.key, path: resolved.absolute };
}

export function fileFreshness(filename) {
  try {
    const info = statSync(filename, { bigint: true });
    if (!info.isFile()) return null;
    return { size: Number(info.size), mtimeNs: info.mtimeNs.toString() };
  } catch {
    return null;
  }
}

export function sameFileFreshness(left, right) {
  return Boolean(left && right && left.size === right.size && left.mtimeNs === right.mtimeNs);
}

export function editedFileKeys(toolName, toolInput, cwd) {
  if (!["apply_patch", "Edit", "Write"].includes(toolName)) return null;
  if (toolName === "Edit" || toolName === "Write") {
    const filename = toolInput?.file_path ?? toolInput?.filePath ?? toolInput?.path;
    if (typeof filename !== "string") return null;
    const resolved = insideWorkspace(filename, cwd);
    return resolved ? [resolved.key] : null;
  }
  const patch = toolInput?.patch ?? toolInput?.input ?? toolInput?.command;
  if (typeof patch !== "string" || !patch.includes("*** Begin Patch")) return null;
  const filenames = [...patch.matchAll(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/gm)].map((match) => match[1].trim());
  if (filenames.length === 0) return null;
  const keys = filenames.map((filename) => insideWorkspace(filename, cwd)?.key ?? null);
  return keys.every(Boolean) ? [...new Set(keys)] : null;
}
