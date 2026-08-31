import type { ToolAnnotations } from "./interface.js";

export interface ToolDiagnostic {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: object;
  readonly annotations?: ToolAnnotations;
  readonly maxOutputBytes?: number;
}
type Schema = Record<string, unknown>;

const readVerbs = new Set(["find", "get", "list", "read", "search", "show"]);

/** Fast, deterministic checks for tool-definition mistakes that hurt agents. */
export function checkToolReadiness(
  tool: ToolDefinition,
): readonly ToolDiagnostic[] {
  const diagnostics: ToolDiagnostic[] = [];
  if (!/^[a-z][a-z0-9]*_[a-z0-9_]+$/.test(tool.name)) {
    add(
      diagnostics,
      "name",
      "name",
      "Use a lower_snake_case verb_noun name so agents can distinguish the action.",
    );
  }
  if (tool.description.trim().split(/\s+/).length < 4) {
    add(
      diagnostics,
      "description",
      "description",
      "Describe the action, returned result, and important constraint.",
    );
  }
  const schema = tool.inputSchema as Schema;
  if (schema.additionalProperties !== false) {
    add(
      diagnostics,
      "closed_input",
      "inputSchema.additionalProperties",
      "Set additionalProperties to false to catch invented arguments.",
    );
  }
  inspectSchema(schema, "inputSchema", diagnostics);

  const verb = tool.name.split("_")[0] ?? "";
  if (readVerbs.has(verb) && tool.annotations?.readOnlyHint !== true) {
    add(
      diagnostics,
      "read_only_hint",
      "annotations.readOnlyHint",
      "Mark read-only tools so agents can plan safely.",
    );
  }
  if (
    tool.maxOutputBytes !== undefined &&
    (!Number.isSafeInteger(tool.maxOutputBytes) || tool.maxOutputBytes <= 0)
  ) {
    add(
      diagnostics,
      "output_limit",
      "maxOutputBytes",
      "Use a positive integer byte ceiling.",
    );
  }
  return diagnostics;
}

/** Throws one readable error, making readiness checks portable across test runners. */
export function assertToolReady(tool: ToolDefinition): void {
  const diagnostics = checkToolReadiness(tool);
  if (diagnostics.length === 0) return;
  throw new Error(
    `Tool "${tool.name}" is not agent-ready:\n` +
      diagnostics
        .map(({ path, message }) => `- ${path}: ${message}`)
        .join("\n"),
  );
}

function inspectSchema(
  schema: Schema,
  path: string,
  diagnostics: ToolDiagnostic[],
): void {
  const properties = schema.properties;
  if (isSchemaMap(properties)) {
    for (const [name, property] of Object.entries(properties)) {
      const propertyPath = `${path}.properties.${name}`;
      if (typeof property.description !== "string") {
        add(
          diagnostics,
          "argument_description",
          `${propertyPath}.description`,
          "Describe what the agent should provide.",
        );
      }
      inspectSchema(property, propertyPath, diagnostics);
    }
  }
  if (
    schema.type === "string" &&
    schema.maxLength === undefined &&
    schema.enum === undefined
  ) {
    add(
      diagnostics,
      "unbounded_string",
      path,
      "Add maxLength to bound agent-controlled text.",
    );
  }
  if (schema.type === "array" && schema.maxItems === undefined) {
    add(
      diagnostics,
      "unbounded_array",
      path,
      "Add maxItems to bound agent-controlled lists.",
    );
  }
}

function isSchemaMap(value: unknown): value is Record<string, Schema> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function add(
  diagnostics: ToolDiagnostic[],
  code: string,
  path: string,
  message: string,
): void {
  diagnostics.push({ code, path, message });
}
