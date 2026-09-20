function textFromContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      if (typeof item.text === "string") return item.text;
      if (typeof item.input_text === "string") return item.input_text;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

export function inspectRequest(body, maxChars = 12000) {
  const input = Array.isArray(body?.input) ? body.input : [];
  let latestUserText = "";
  let lastItemKind = "unknown";

  for (let i = input.length - 1; i >= 0; i -= 1) {
    const item = input[i];
    if (!item || typeof item !== "object") continue;

    if (lastItemKind === "unknown") {
      if (item.role === "user") lastItemKind = "user";
      else if (item.type === "function_call_output" || item.type === "custom_tool_call_output") {
        lastItemKind = "tool";
      } else if (item.role) {
        lastItemKind = item.role;
      } else if (item.type) {
        lastItemKind = item.type;
      }
    }

    if (item.role === "user") {
      latestUserText = textFromContent(item.content);
      if (!latestUserText && typeof item.text === "string") latestUserText = item.text;
      break;
    }
  }

  if (!latestUserText && typeof body?.input === "string") {
    latestUserText = body.input;
    lastItemKind = "user";
  }

  const sessionKey =
    body?.client_metadata?.turn_id ??
    body?.client_metadata?.root_turn_id ??
    body?.prompt_cache_key ??
    "global";

  return {
    currentModel: typeof body?.model === "string" ? body.model : "unknown",
    currentEffort: body?.reasoning?.effort ?? null,
    latestUserText: latestUserText.slice(-maxChars),
    isNewUserStep: lastItemKind === "user" && Boolean(latestUserText),
    sessionKey: String(sessionKey),
    toolCount: Array.isArray(body?.tools) ? body.tools.length : 0,
  };
}
