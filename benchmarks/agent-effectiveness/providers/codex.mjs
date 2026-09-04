export const providerName = "codex-cli";
export const runtimeVersion = { command: "codex", args: ["--version"] };

export function createAgentRun({
  model,
  reasoning,
  outputSchema,
  workspace,
  mcpServer,
  mcpArgs,
  prompt,
}) {
  return {
    command: "codex",
    args: [
      "exec",
      "--ephemeral",
      "--ignore-user-config",
      "--skip-git-repo-check",
      "--sandbox",
      "read-only",
      "--json",
      "--model",
      model,
      "--output-schema",
      outputSchema,
      "-C",
      workspace,
      "-c",
      `model_reasoning_effort=${JSON.stringify(reasoning)}`,
      "-c",
      'approval_policy="never"',
      "-c",
      `mcp_servers.p1.command=${JSON.stringify(mcpServer.command)}`,
      "-c",
      `mcp_servers.p1.args=${JSON.stringify(mcpArgs)}`,
      "-c",
      "mcp_servers.p1.startup_timeout_sec=30",
      "-c",
      'mcp_servers.p1.tools.click_element.approval_mode="approve"',
      "-c",
      'mcp_servers.p1.tools.fill_element.approval_mode="approve"',
      "-c",
      'mcp_servers.p1.tools.prepare_payment_authorization.approval_mode="approve"',
      "-c",
      'mcp_servers.p1.tools.send_payment.approval_mode="approve"',
      prompt,
    ],
    parse(stdout) {
      const events = parseJsonLines(stdout);
      const usage =
        events.findLast(({ type }) => type === "turn.completed")?.usage ?? {};
      const messages = events
        .filter(
          ({ type, item }) =>
            type === "item.completed" && item?.type === "agent_message",
        )
        .map(({ item }) => item.text);
      return {
        finalText: messages.at(-1) ?? "",
        usage: {
          inputTokens: usage.input_tokens ?? 0,
          cachedInputTokens: usage.cached_input_tokens ?? 0,
          outputTokens: usage.output_tokens ?? 0,
          reasoningOutputTokens: usage.reasoning_output_tokens ?? 0,
          totalTokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
        },
        protocolViolations: events.filter(
          ({ type, item }) =>
            type === "item.completed" && item?.type === "command_execution",
        ).length,
      };
    },
  };
}

function parseJsonLines(value) {
  return value
    .split("\n")
    .filter((line) => line.trim().startsWith("{"))
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { type: "unparseable" };
      }
    });
}
