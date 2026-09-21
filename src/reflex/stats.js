function intervalSummary(values) {
  if (values.length === 0) return { count: 0, minMs: null, avgMs: null, maxMs: null };
  const total = values.reduce((sum, value) => sum + value, 0);
  return { count: values.length, minMs: Math.min(...values), avgMs: Math.round(total / values.length), maxMs: Math.max(...values) };
}

function bump(bucket, key) {
  if (!key) return;
  bucket[key] = (bucket[key] ?? 0) + 1;
}

function top(bucket, limit = 10) {
  return Object.fromEntries(Object.entries(bucket).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit));
}

function eventOperations(event) {
  if (Array.isArray(event.operations) && event.operations.length > 0) return event.operations;
  if (event.commandKey) {
    return [{ key: event.commandKey, family: event.commandKey.split(".")[0], access: "read-only", eligible: true, commandHash: event.commandKey }];
  }
  return [];
}

export function summarizeReflexEvents(events) {
  const preEvents = events.filter((event) => event?.event === "PreToolUse");
  const byCommand = {};
  const families = {};
  const unknownPatterns = {};
  const lastSeen = new Map();
  const repeatIntervals = [];
  const decisions = { would_reuse: 0, would_refresh: 0, not_eligible: 0, stale_after_mutation: 0, unknown: 0 };
  const jev = { reuse: 0, refresh: 0, uncertain: 0, disabled: 0, errors: 0 };
  let readOnlyRecognized = 0;
  let mutatingToolCalls = 0;
  let unknownToolCalls = 0;
  let compoundToolCalls = 0;
  let recognizedInsideCompounds = 0;
  let repeatedChecks = 0;
  let potentiallyReusableCalls = 0;

  for (const event of preEvents) {
    const operations = eventOperations(event);
    if (event.compound) compoundToolCalls += 1;
    if (event.potentiallyMutating || event.access === "mutating") mutatingToolCalls += 1;
    const hasUnknown = operations.some((item) => item.access === "unknown") || operations.length === 0;
    if (hasUnknown) {
      unknownToolCalls += 1;
      bump(unknownPatterns, event.commandPattern ?? `${event.tool ?? "unknown"}:${event.commandKind ?? "unknown"}`);
    }
    if (operations.length === 0) bump(families, event.family ?? event.tool ?? "unknown");

    for (const operation of operations) {
      bump(families, operation.family ?? "unknown");
      if (operation.eligible) {
        readOnlyRecognized += 1;
        bump(byCommand, operation.key);
        if (event.compound) recognizedInsideCompounds += 1;
        const scope = `${event.session ?? "unknown"}:${operation.commandHash ?? operation.key}`;
        const atMs = Date.parse(event.at);
        const previous = lastSeen.get(scope);
        if (previous != null && Number.isFinite(atMs)) {
          repeatedChecks += 1;
          repeatIntervals.push(Math.max(0, atMs - previous));
        }
        if (Number.isFinite(atMs)) lastSeen.set(scope, atMs);
      }
      if (operation.shadow?.decision && operation.shadow.decision in decisions) decisions[operation.shadow.decision] += 1;
      const semantic = operation.semanticShadow;
      if (semantic) {
        if (semantic.source === "jev-disabled") jev.disabled += 1;
        else if (semantic.source === "jev-error") jev.errors += 1;
        if (semantic.decision in jev) jev[semantic.decision] += 1;
      }
    }
    if (operations.length > 0 && operations.every((operation) =>
      operation.eligible && (operation.shadow?.decision === "would_reuse" || operation.semanticShadow?.decision === "reuse")
    )) potentiallyReusableCalls += 1;
  }

  return {
    totalEvents: events.length,
    totalToolCalls: preEvents.length,
    readOnlyRecognized,
    mutatingToolCalls,
    unknownToolCalls,
    compoundToolCalls,
    recognizedInsideCompounds,
    repeatedChecks,
    repeatRate: readOnlyRecognized === 0 ? 0 : Number((repeatedChecks / readOnlyRecognized).toFixed(4)),
    shadowDecisions: decisions,
    jevShadow: jev,
    potentialSavings: {
      toolCalls: potentiallyReusableCalls,
      reusableOperations: decisions.would_reuse + jev.reuse,
      percentOfObservedCalls: preEvents.length === 0 ? 0 : Number(((potentiallyReusableCalls / preEvents.length) * 100).toFixed(2)),
    },
    byCommand: top(byCommand),
    topCommandFamilies: top(families),
    topUnknownPatterns: top(unknownPatterns),
    repeatIntervals: intervalSummary(repeatIntervals),
  };
}
