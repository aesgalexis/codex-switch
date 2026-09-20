export function buildUpstreamUrl(upstreamBase, requestUrl = "/") {
  const base = new URL(upstreamBase.endsWith("/") ? upstreamBase : `${upstreamBase}/`);
  const incoming = new URL(requestUrl, "http://codex-switch.local");
  const relativePath = incoming.pathname.replace(/^\/+/, "");
  const target = new URL(relativePath, base);
  target.search = incoming.search;
  return target;
}
