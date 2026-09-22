import { createRequire } from "node:module";

const { version } = createRequire(import.meta.url)("../../package.json");

// Increment this when the meaning or available decisions in reflex events changes.
export const REFLEX_RUNTIME = `${version}/reflex-4`;
