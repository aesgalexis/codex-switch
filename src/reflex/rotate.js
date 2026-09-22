import { mkdir, rename, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eventLogPath } from "./events.js";

const telemetryDir = path.resolve(fileURLToPath(new URL("../../.model-switch/", import.meta.url)));

export async function rotateReflexLog({ log = eventLogPath(), directory = telemetryDir, now = new Date() } = {}) {
  const source = path.resolve(log);
  const base = path.resolve(directory);
  if (path.dirname(source) !== base) throw new Error("Event log must be directly inside .model-switch/ to rotate safely");
  try { await stat(source); }
  catch (error) {
    if (error?.code === "ENOENT") return { rotated: false, source, destination: null };
    throw error;
  }
  await mkdir(base, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const extension = path.extname(source);
  const stem = path.basename(source, extension);
  for (let index = 0; index < 100; index += 1) {
    const destination = path.join(base, `${stem}-${stamp}${index ? `-${index}` : ""}${extension}`);
    try { await stat(destination); continue; }
    catch (error) { if (error?.code !== "ENOENT") throw error; }
    await rename(source, destination);
    return { rotated: true, source, destination };
  }
  throw new Error("Could not find an unused rotation filename");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await rotateReflexLog();
    process.stdout.write(result.rotated ? `Rotated ${result.source} -> ${result.destination}\nEvidence state preserved.\n` : `No event log to rotate: ${result.source}\nEvidence state preserved.\n`);
  } catch (error) {
    process.stderr.write(`reflex:rotate: ${error.message}\n`);
    process.exitCode = 1;
  }
}
