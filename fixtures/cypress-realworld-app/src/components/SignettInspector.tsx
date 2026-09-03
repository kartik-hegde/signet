import React, { useEffect, useState } from "react";
import { Box, Chip, Divider, Paper, Typography } from "@mui/material";

type InspectorEvent = {
  name?: string;
  stage: string;
  invocationId: string;
  durationMs: number;
};

type ToolSummary = {
  name: string;
  description: string;
};

const panel = {
  position: "fixed",
  right: 16,
  bottom: 16,
  width: 360,
  maxHeight: "70vh",
  overflow: "auto",
  zIndex: 1400,
  padding: 2,
  border: "1px solid",
  borderColor: "divider",
  boxShadow: 8,
};

const SignettInspector: React.FC = () => {
  const [tools, setTools] = useState<ToolSummary[]>([]);
  const [events, setEvents] = useState<InspectorEvent[]>([]);
  const supported = Boolean(document.modelContext);

  useEffect(() => {
    let active = true;

    const refreshTools = async () => {
      const discovered = await document.modelContext?.getTools();
      if (!active || !discovered) return;
      setTools(
        discovered.map(({ name, description }) => ({
          name,
          description,
        })),
      );
    };

    const record = (event: Event) => {
      const detail = (event as CustomEvent<InspectorEvent>).detail;
      setEvents((current) => [...current.slice(-7), detail]);
      void refreshTools();
    };

    void refreshTools();
    window.addEventListener("signett:event", record);
    document.modelContext?.addEventListener("toolchange", refreshTools);

    return () => {
      active = false;
      window.removeEventListener("signett:event", record);
      document.modelContext?.removeEventListener("toolchange", refreshTools);
    };
  }, []);

  return (
    <Paper sx={panel} data-testid="signett-inspector">
      <Box display="flex" justifyContent="space-between" alignItems="center">
        <Typography variant="h6">Signett Inspector</Typography>
        <Chip
          size="small"
          color={supported ? "success" : "default"}
          label={supported ? "WebMCP connected" : "WebMCP unavailable"}
        />
      </Box>

      <Typography variant="overline" display="block" mt={1}>
        Exposed tools
      </Typography>
      {tools.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No tools observed.
        </Typography>
      ) : (
        tools.map((tool) => (
          <Box key={tool.name} mb={1}>
            <Typography variant="subtitle2">{tool.name}</Typography>
            <Typography variant="caption" color="text.secondary">
              {tool.description}
            </Typography>
          </Box>
        ))
      )}

      <Divider sx={{ my: 1 }} />
      <Typography variant="overline" display="block">
        Live trace
      </Typography>
      {events.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Waiting for an agent tool call.
        </Typography>
      ) : (
        events.map((event, index) => (
          <Box
            key={event.invocationId + ":" + event.stage + ":" + index}
            display="flex"
            justifyContent="space-between"
            gap={1}
          >
            <Typography variant="caption" noWrap>
              {event.name ?? "tool"}
            </Typography>
            <Box display="flex" gap={1}>
              <Typography
                variant="caption"
                color={
                  event.stage === "failed" ||
                  event.stage === "registration_failed"
                    ? "error"
                    : "text.secondary"
                }
              >
                {event.stage}
              </Typography>
              <Typography variant="caption" color="text.disabled">
                {Math.round(event.durationMs)}ms
              </Typography>
            </Box>
          </Box>
        ))
      )}
    </Paper>
  );
};

export default SignettInspector;
