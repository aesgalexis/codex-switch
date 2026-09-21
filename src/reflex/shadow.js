import { choice, TypeSafeClient } from "@typesafe-ai/sdk";
import { exactEvidence, familyEvidence } from "./state.js";

const CRITERIA = {
  reuse: "The prior observation is sufficient for the new inspection despite the commands not being exactly identical.",
  refresh: "The new inspection can materially reveal information absent from the prior observation.",
  uncertain: "The bounded metadata is insufficient to decide safely.",
};

export function deterministicShadow(state, { operation, session, commandHash }) {
  if (!operation.eligible) return { decision: operation.access === "unknown" ? "unknown" : "not_eligible", source: "code", confidence: 1 };
  const evidence = exactEvidence(state, { session, commandHash });
  if (!evidence) return { decision: "would_refresh", source: "code", confidence: 1 };
  if (evidence.workspaceGeneration !== state.workspaceGeneration) return { decision: "stale_after_mutation", source: "code", confidence: 1, evidenceGeneration: evidence.workspaceGeneration };
  return { decision: "would_reuse", source: "code", confidence: 1, evidenceGeneration: evidence.workspaceGeneration };
}

export async function semanticShadow(state, { operation, session, commandHash }) {
  if (!operation.eligible || exactEvidence(state, { session, commandHash })) return null;
  const related = familyEvidence(state, { session, family: operation.family });
  if (!related || related.workspaceGeneration !== state.workspaceGeneration) return null;
  if (!process.env.TYPESAFE_API_KEY || process.env.MODEL_SWITCH_REFLEX_JEV_SHADOW === "off") {
    return { decision: "uncertain", source: "jev-disabled", confidence: null };
  }
  const timeout = Number(process.env.MODEL_SWITCH_REFLEX_JEV_TIMEOUT_MS ?? 2000);
  const threshold = Number(process.env.MODEL_SWITCH_REFLEX_JEV_MIN_CONFIDENCE ?? 0.85);
  try {
    const client = new TypeSafeClient({ timeout, retry: { maxRetries: 0 }, logLevel: "off" });
    const response = await client.systemOne({
      state: {
        requested_kind: operation.key,
        requested_family: operation.family,
        prior_kind: related.kind,
        same_workspace_generation: true,
        prior_age_ms: Math.max(0, Date.now() - Date.parse(related.timestamp)),
      },
      questions: {
        sufficiency: choice("Judge whether the bounded prior observation is sufficient for this related read-only inspection. Prefer refresh or uncertain unless reuse is clearly justified.", CRITERIA),
      },
    });
    const answer = response.answers.sufficiency;
    const suggested = answer.choice;
    return { decision: answer.confidence >= threshold ? suggested : "uncertain", suggested, source: "jev", confidence: answer.confidence, threshold };
  } catch (error) {
    return { decision: "uncertain", source: "jev-error", confidence: null, errorKind: error instanceof Error ? error.name : "UnknownError" };
  }
}
