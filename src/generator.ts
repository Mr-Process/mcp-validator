import type { TestCase, TestCategory } from "./types.js";

export type JsonSchema = {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
};

function defaultValue(schema: JsonSchema): unknown {
  if (schema.default !== undefined) return schema.default;
  switch (schema.type) {
    case "string":
      return schema.enum ? schema.enum[0] : "test";
    case "number":
    case "integer":
      return schema.enum ? schema.enum[0] : (schema.minimum ?? 1);
    case "boolean":
      return false;
    case "array":
      return [];
    case "object":
      return schema.properties
        ? Object.fromEntries(
            Object.entries(schema.properties).map(([k, v]) => [k, defaultValue(v)])
          )
        : {};
    default:
      return null;
  }
}

function edgeValue(schema: JsonSchema, kind: TestCategory): unknown {
  switch (schema.type) {
    case "string":
      if (kind === "edge_empty_string") return "";
      if (kind === "edge_max") return "x".repeat(10000);
      return "test";
    case "number":
    case "integer":
      if (kind === "edge_zero") return 0;
      if (kind === "edge_max") return Number.MAX_SAFE_INTEGER;
      if (kind === "edge_boundary") return schema.minimum ?? schema.maximum ?? 1;
      return 1;
    case "boolean":
      return true;
    case "array":
      return [];
    case "object":
      return {};
    default:
      return null;
  }
}

export function generateTestCases(inputSchema: JsonSchema): TestCase[] {
  const cases: TestCase[] = [];
  const properties = inputSchema.properties || {};
  const required = inputSchema.required || [];
  const propEntries = Object.entries(properties);

  // Valid minimal: only required fields
  const minimal: Record<string, unknown> = {};
  for (const key of required) {
    if (properties[key]) minimal[key] = defaultValue(properties[key]);
  }
  cases.push({
    category: "valid_minimal",
    description: "Only required fields with default values",
    input: minimal,
    expectSuccess: true,
  });

  // Valid full: all fields populated
  const full: Record<string, unknown> = {};
  for (const [key, schema] of propEntries) {
    full[key] = defaultValue(schema);
  }
  cases.push({
    category: "valid_full",
    description: "All fields populated",
    input: full,
    expectSuccess: true,
  });

  // Edge cases for each field
  for (const [key, schema] of propEntries) {
    for (const kind of ["edge_empty_string", "edge_zero", "edge_max", "edge_boundary"] as TestCategory[]) {
      if (schema.type === "string" && kind === "edge_empty_string") {
        cases.push({
          category: kind,
          description: `${key} = empty string`,
          input: { ...full, [key]: "" },
          expectSuccess: true,
        });
      }
      if ((schema.type === "number" || schema.type === "integer") && 
          (kind === "edge_zero" || kind === "edge_max" || kind === "edge_boundary")) {
        cases.push({
          category: kind,
          description: `${key} = ${kind}`,
          input: { ...full, [key]: edgeValue(schema, kind) },
          expectSuccess: true,
        });
      }
    }
  }

  // Security Fuzzing vectors for string fields
  for (const [key, schema] of propEntries) {
    if (schema.type === "string" || !schema.type) {
      cases.push({
        category: "fuzz_sql_injection",
        description: `Fuzz ${key} with SQL injection vector`,
        input: { ...full, [key]: "' OR '1'='1'; DROP TABLE users; --" },
        expectSuccess: true, // Should handle safely without crashing
      });
      cases.push({
        category: "fuzz_path_traversal",
        description: `Fuzz ${key} with Path Traversal vector`,
        input: { ...full, [key]: "../../../../etc/passwd" },
        expectSuccess: true,
      });
      cases.push({
        category: "fuzz_xss",
        description: `Fuzz ${key} with XSS vector`,
        input: { ...full, [key]: "<script>alert('mcp_xss')</script>" },
        expectSuccess: true,
      });
      cases.push({
        category: "fuzz_format_string",
        description: `Fuzz ${key} with Format String vector`,
        input: { ...full, [key]: "%s%s%s%n%x%d" },
        expectSuccess: true,
      });
      cases.push({
        category: "fuzz_overflow_string",
        description: `Fuzz ${key} with Buffer Overflow (50k chars)`,
        input: { ...full, [key]: "A".repeat(50000) },
        expectSuccess: true,
      });
    }
  }

  // Invalid: missing each required field
  for (const req of required) {
    const { [req]: _, ...without } = full;
    cases.push({
      category: "invalid_missing_required",
      description: `Missing required field: ${req}`,
      input: without,
      expectSuccess: false,
    });
  }

  // Invalid: wrong type for each field
  for (const [key, schema] of propEntries) {
    if (schema.type === "string") {
      cases.push({
        category: "invalid_wrong_type",
        description: `${key} = number instead of string`,
        input: { ...full, [key]: 123 },
        expectSuccess: false,
      });
    } else if (schema.type === "number" || schema.type === "integer") {
      cases.push({
        category: "invalid_wrong_type",
        description: `${key} = string instead of number`,
        input: { ...full, [key]: "not_a_number" },
        expectSuccess: false,
      });
    } else if (schema.type === "boolean") {
      cases.push({
        category: "invalid_wrong_type",
        description: `${key} = string instead of boolean`,
        input: { ...full, [key]: "true" },
        expectSuccess: false,
      });
    }
  }

  // Invalid: null for required non-null fields
  for (const req of required) {
    cases.push({
      category: "invalid_null",
      description: `${req} = null`,
      input: { ...full, [req]: null },
      expectSuccess: false,
    });
  }

  return cases;
}

/**
 * Validates output data against a tool's declared JSON outputSchema.
 */
export function validateOutputSchema(
  data: unknown,
  outputSchema?: JsonSchema
): { valid: boolean; error?: string } {
  if (!outputSchema) return { valid: true };

  if (outputSchema.type === "object" && (typeof data !== "object" || data === null)) {
    return { valid: false, error: `Expected object output, got ${typeof data}` };
  }

  if (outputSchema.required && typeof data === "object" && data !== null) {
    for (const req of outputSchema.required) {
      if (!(req in (data as Record<string, unknown>))) {
        return { valid: false, error: `Output missing required property: ${req}` };
      }
    }
  }

  if (outputSchema.properties && typeof data === "object" && data !== null) {
    const record = data as Record<string, unknown>;
    for (const [key, propSchema] of Object.entries(outputSchema.properties)) {
      if (key in record && record[key] !== undefined) {
        const val = record[key];
        if (propSchema.type === "string" && typeof val !== "string") {
          return { valid: false, error: `Property '${key}' expected string, got ${typeof val}` };
        }
        if ((propSchema.type === "number" || propSchema.type === "integer") && typeof val !== "number") {
          return { valid: false, error: `Property '${key}' expected number, got ${typeof val}` };
        }
        if (propSchema.type === "boolean" && typeof val !== "boolean") {
          return { valid: false, error: `Property '${key}' expected boolean, got ${typeof val}` };
        }
        if (propSchema.type === "array" && !Array.isArray(val)) {
          return { valid: false, error: `Property '${key}' expected array, got ${typeof val}` };
        }
      }
    }
  }

  return { valid: true };
}
