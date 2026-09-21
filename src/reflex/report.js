import { readReflexEvents } from "./events.js";
import { summarizeReflexEvents } from "./stats.js";

const events = await readReflexEvents();
process.stdout.write(JSON.stringify(summarizeReflexEvents(events), null, 2) + "\n");
