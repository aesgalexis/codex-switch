import http from "node:http";
import { Readable } from "node:stream";
import { loadConfig } from "./config.js";
import { inspectRequest } from "./request.js";
import { decideRoute } from "./router.js";
import { createStats } from "./stats.js";
import { buildUpstreamUrl } from "./upstream.js";

const config = loadConfig();
const stats = createStats();

function log(message) {
  process.stdout.write(`[model-switch] ${message}\n`);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function upstreamHeaders(headers) {
  const result = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (["host", "content-length", "connection", "transfer-encoding"].includes(lower)) continue;
    if (value !== undefined) result[key] = value;
  }
  return result;
}

function responseHeaders(headers) {
  const result = {};
  for (const [key, value] of headers.entries()) {
    const lower = key.toLowerCase();
    if (["content-length", "connection", "transfer-encoding"].includes(lower)) continue;
    result[key] = value;
  }
  return result;
}

function confidenceLabel(decision) {
  if (decision.modelConfidence == null || decision.effortConfidence == null) return "";
  return ` confidence=${decision.modelConfidence.toFixed(2)}/${decision.effortConfidence.toFixed(2)}`;
}

async function handle(req, res) {
  stats.request();

  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        name: "model-switch",
        mode: config.mode,
        jev: config.jevEnabled,
        minConfidence: config.minConfidence,
      }),
    );
    return;
  }

  if (req.url === "/stats") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(stats.snapshot(), null, 2));
    return;
  }

  const raw = await readBody(req);
  let outgoing = raw;

  const requestPath = new URL(req.url ?? "/", "http://localhost").pathname;
  const isResponsesRequest =
    req.method === "POST" &&
    (requestPath === "/responses" || requestPath === "/v1/responses");

  if (isResponsesRequest) stats.responseRequest();

  if (isResponsesRequest && raw.length > 0 && config.mode !== "off") {
    try {
      const body = JSON.parse(raw.toString("utf8"));
      const request = inspectRequest(body, config.maxRoutingText);
      const decision = await decideRoute(request, {
        enabled: config.jevEnabled,
        timeoutMs: config.jevTimeoutMs,
        minConfidence: config.minConfidence,
      });

      stats.decision(decision);

      log(
        `${config.mode.padEnd(7)} ${request.currentModel} -> ${decision.model}` +
          (decision.effort ? ` / ${decision.effort}` : "") +
          confidenceLabel(decision) +
          ` [${decision.source}${decision.safeToRoute ? ", routable" : ""}]`,
      );

      if (config.mode === "route" && decision.source === "jev" && decision.safeToRoute) {
        body.model = decision.model;
        if (body.reasoning && decision.effort) {
          body.reasoning.effort = decision.effort;
        }
        outgoing = Buffer.from(JSON.stringify(body));
        stats.routed();
      } else {
        stats.passthrough();
      }
    } catch (error) {
      stats.routingError();
      stats.passthrough();
      log(`routing failed; passthrough: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else if (isResponsesRequest) {
    stats.passthrough();
  }

  const upstreamUrl = buildUpstreamUrl(config.upstream, req.url ?? "/");
  const upstream = await fetch(upstreamUrl, {
    method: req.method,
    headers: upstreamHeaders(req.headers),
    body: ["GET", "HEAD"].includes(req.method ?? "GET") ? undefined : outgoing,
    redirect: "manual",
  });

  res.writeHead(upstream.status, responseHeaders(upstream.headers));

  if (!upstream.body) {
    res.end();
    return;
  }

  Readable.fromWeb(upstream.body).pipe(res);
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((error) => {
    log(`proxy error: ${error instanceof Error ? error.message : String(error)}`);
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "application/json" });
    }
    res.end(JSON.stringify({ error: "model-switch upstream failure" }));
  });
});

server.listen(config.port, config.host, () => {
  log(`listening on http://${config.host}:${config.port}`);
  log(`mode=${config.mode} jev=${config.jevEnabled ? "enabled" : "disabled"}`);
  if (!config.jevEnabled) {
    log("TYPESAFE_API_KEY is not set; proxy is running in passthrough mode");
  }
});
