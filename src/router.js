import { choice, TypeSafeClient } from "@typesafe-ai/sdk";

const client = new TypeSafeClient();
const pinned = new Map();

const MODEL_CRITERIA = {
  "gpt-5.6-luna":
    "Routine or mechanical coding work: small edits, formatting, straightforward fixes, simple commands, known patterns, or low-risk repetitive work.",
  "gpt-5.6-terra":
    "Normal software engineering work that needs some judgment: moderate debugging, several-file edits, ordinary implementation, or investigation with limited ambiguity.",
  "gpt-5.6-sol":
    "Complex engineering work: architecture, difficult debugging, broad refactors, risky changes, unfamiliar systems, subtle reasoning, or tasks where mistakes are expensive."
};

const EFFORT_CRITERIA = {
  low: "Straightforward task with little ambiguity or reasoning.",
  medium: "Some reasoning, debugging, or multi-step work is useful.",
  high: "Substantial reasoning, ambiguity, architecture, or difficult debugging is required."
};

function fallback(request) {
  return {
    model: request.currentModel,
    effort: request.currentEffort,
    source: "fallback"
  };
}

export async function decideRoute(request, { enabled }) {
  if (!enabled) return fallback(request);

  if (!request.isNewUserStep) {
    return pinned.get(request.sessionKey) ?? fallback(request);
  }

  const response = await client.systemOne({
    state: {
      user_request: request.latestUserText,
      current_model: request.currentModel,
      current_reasoning_effort: request.currentEffort ?? "unspecified",
      available_tools: request.toolCount
    },
    questions: {
      model: choice(
        "Choose the least expensive model that is still appropriate to complete this Codex coding task reliably. Prefer the cheaper option when capability is sufficient.",
        MODEL_CRITERIA
      ),
      effort: choice(
        "Choose the lowest reasoning effort that is still appropriate to complete this task reliably.",
        EFFORT_CRITERIA
      )
    }
  });

  const decision = {
    model: response.answers.model.choice,
    effort: response.answers.effort.choice,
    source: "jev"
  };

  pinned.set(request.sessionKey, decision);

  if (pinned.size > 500) {
    const firstKey = pinned.keys().next().value;
    pinned.delete(firstKey);
  }

  return decision;
}
