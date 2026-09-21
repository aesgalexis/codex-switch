function intervalSummary(values) {
  if (values.length === 0) {
    return { count: 0, minMs: null, avgMs: null, maxMs: null };
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    count: values.length,
    minMs: Math.min(...values),
    avgMs: Math.round(total / values.length),
    maxMs: Math.max(...values),
  };
}

export function summarizeReflexEvents(events) {
  const preEvents = events.filter((event) => event?.event === "PreToolUse");
  const eligible = preEvents.filter((event) => event?.eligible && event?.commandKey);
  const byCommand = {};
  const lastSeen = new Map();
  const repeatIntervals = [];
  let repeatedEligibleChecks = 0;

  for (const event of eligible) {
    byCommand[event.commandKey] = (byCommand[event.commandKey] ?? 0) + 1;

    const scope = (event.session ?? "unknown") + ":" + event.commandKey;
    const atMs = Date.parse(event.at);
    const previous = lastSeen.get(scope);

    if (previous != null && Number.isFinite(atMs)) {
      repeatedEligibleChecks += 1;
      repeatIntervals.push(Math.max(0, atMs - previous));
    }

    if (Number.isFinite(atMs)) lastSeen.set(scope, atMs);
  }

  return {
    totalEvents: events.length,
    preToolUseEvents: preEvents.length,
    eligibleChecks: eligible.length,
    repeatedEligibleChecks,
    repeatRate:
      eligible.length === 0 ? 0 : Number((repeatedEligibleChecks / eligible.length).toFixed(4)),
    byCommand,
    repeatIntervals: intervalSummary(repeatIntervals),
  };
}
