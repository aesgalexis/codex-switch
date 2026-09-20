export function createStats() {
  const startedAt = new Date().toISOString();
  const state = {
    startedAt,
    requests: 0,
    responseRequests: 0,
    jevDecisions: 0,
    routed: 0,
    passthrough: 0,
    routingErrors: 0,
    recommendations: {
      models: {},
      efforts: {},
    },
  };

  function bump(bucket, key) {
    if (!key) return;
    bucket[key] = (bucket[key] ?? 0) + 1;
  }

  return {
    request() {
      state.requests += 1;
    },
    responseRequest() {
      state.responseRequests += 1;
    },
    decision(decision) {
      if (decision?.source !== "jev") return;
      state.jevDecisions += 1;
      bump(state.recommendations.models, decision.model);
      bump(state.recommendations.efforts, decision.effort);
    },
    routed() {
      state.routed += 1;
    },
    passthrough() {
      state.passthrough += 1;
    },
    routingError() {
      state.routingErrors += 1;
    },
    snapshot() {
      return {
        ...state,
        recommendations: {
          models: { ...state.recommendations.models },
          efforts: { ...state.recommendations.efforts },
        },
      };
    },
  };
}
