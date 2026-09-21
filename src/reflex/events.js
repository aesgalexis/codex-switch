import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));

export function eventLogPath() {
  return process.env.MODEL_SWITCH_REFLEX_LOG
    ? path.resolve(process.env.MODEL_SWITCH_REFLEX_LOG)
    : path.join(projectRoot, ".model-switch", "reflex-events.jsonl");
}

export function hashIdentifier(value) {
  if (typeof value !== "string" || value === "") return null;
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

export async function appendReflexEvent(event) {
  const target = eventLogPath();
  await mkdir(path.dirname(target), { recursive: true });
  await appendFile(target, JSON.stringify(event) + "\n", "utf8");
}

export async function readReflexEvents() {
  try {
    const raw = await readFile(eventLogPath(), "utf8");
    return raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return [];
    throw error;
  }
}
