import test from "node:test";
import assert from "node:assert/strict";
import { buildUpstreamUrl } from "../src/upstream.js";

test("preserves the Codex backend base path", () => {
  const url = buildUpstreamUrl(
    "https://chatgpt.com/backend-api/codex",
    "/responses",
  );

  assert.equal(
    url.toString(),
    "https://chatgpt.com/backend-api/codex/responses",
  );
});

test("preserves request query parameters", () => {
  const url = buildUpstreamUrl(
    "https://chatgpt.com/backend-api/codex",
    "/v1/responses?foo=bar",
  );

  assert.equal(
    url.toString(),
    "https://chatgpt.com/backend-api/codex/v1/responses?foo=bar",
  );
});
