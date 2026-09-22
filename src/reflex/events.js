import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { resolveWorkspace } from "./workspace.js";

export function eventLogPath(cwd = process.cwd()) {
  return process.env.MODEL_SWITCH_REFLEX_LOG
    ? path.resolve(process.env.MODEL_SWITCH_REFLEX_LOG)
    : resolveWorkspace(cwd)?.events ?? null;
}

export function hashIdentifier(value) {
  if (typeof value !== "string" || value === "") return null;
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

export async function appendReflexEvent(event, cwd = process.cwd()) {
  const target = eventLogPath(cwd);
  if (!target) return;
  await mkdir(path.dirname(target), { recursive: true });
  await appendFile(target, JSON.stringify(event) + "\n", "utf8");
}

export async function readReflexEvents(log = eventLogPath()) {
  if (!log) return [];
  try {
    const raw = await readFile(log, "utf8");
    return raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return [];
    throw error;
  }
}
