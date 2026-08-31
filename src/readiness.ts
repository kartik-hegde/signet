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
  readonly outputBudgetBytes?: number;
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
  inspectSchema(schema, "inputSchema", diagnostics, new WeakSet(), true);

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
    tool.outputBudgetBytes !== undefined &&
    (!Number.isSafeInteger(tool.outputBudgetBytes) ||
      tool.outputBudgetBytes <= 0)
  ) {
    add(
      diagnostics,
      "output_limit",
      "outputBudgetBytes",
      "Use a positive integer byte budget.",
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
  seen: WeakSet<object>,
  root = false,
): void {
  if (seen.has(schema)) return;
  seen.add(schema);
  if (
    (root || schema.type === "object" || isSchemaMap(schema.properties)) &&
    schema.additionalProperties !== false
  ) {
    add(
      diagnostics,
      "closed_input",
      `${path}.additionalProperties`,
      "Set additionalProperties to false to catch invented arguments.",
    );
  }
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
      inspectSchema(property, propertyPath, diagnostics, seen);
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
  inspectChild(schema.items, `${path}.items`, diagnostics, seen);
  inspectChildren(schema.prefixItems, `${path}.prefixItems`, diagnostics, seen);
  for (const keyword of ["allOf", "anyOf", "oneOf"] as const) {
    inspectChildren(schema[keyword], `${path}.${keyword}`, diagnostics, seen);
  }
  for (const keyword of ["not", "if", "then", "else"] as const) {
    inspectChild(schema[keyword], `${path}.${keyword}`, diagnostics, seen);
  }
  for (const keyword of ["$defs", "definitions"] as const) {
    const definitions = schema[keyword];
    if (!isSchemaMap(definitions)) continue;
    for (const [name, definition] of Object.entries(definitions)) {
      inspectSchema(
        definition,
        `${path}.${keyword}.${name}`,
        diagnostics,
        seen,
      );
    }
  }
}

function inspectChild(
  value: unknown,
  path: string,
  diagnostics: ToolDiagnostic[],
  seen: WeakSet<object>,
): void {
  if (isSchema(value)) inspectSchema(value, path, diagnostics, seen);
}

function inspectChildren(
  value: unknown,
  path: string,
  diagnostics: ToolDiagnostic[],
  seen: WeakSet<object>,
): void {
  if (!Array.isArray(value)) return;
  value.forEach((child, index) =>
    inspectChild(child, `${path}.${index}`, diagnostics, seen),
  );
}

function isSchema(value: unknown): value is Schema {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSchemaMap(value: unknown): value is Record<string, Schema> {
  return isSchema(value);
}

function add(
  diagnostics: ToolDiagnostic[],
  code: string,
  path: string,
  message: string,
): void {
  diagnostics.push({ code, path, message });
}
