export type TestCategory =
  | "valid_minimal"
  | "valid_full"
  | "edge_empty_string"
  | "edge_zero"
  | "edge_max"
  | "edge_boundary"
  | "invalid_missing_required"
  | "invalid_wrong_type"
  | "invalid_null"
  | "fuzz_sql_injection"
  | "fuzz_path_traversal"
  | "fuzz_xss"
  | "fuzz_overflow_string"
  | "fuzz_format_string"
  | "fuzz_deep_nesting";

export type TestStatus = "pass" | "fail" | "crash" | "schema_mismatch";

export interface TestCase {
  category: TestCategory;
  description: string;
  input: Record<string, unknown>;
  expectSuccess: boolean;
}

export interface TestResult {
  toolName: string;
  category: TestCategory;
  description: string;
  input: Record<string, unknown>;
  status: TestStatus;
  output: unknown;
  error: string | null;
  durationMs: number;
}

export interface DiscoveredResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface ResourceTestResult {
  uri: string;
  name: string;
  status: TestStatus;
  mimeType?: string;
  contentLength?: number;
  error: string | null;
  durationMs: number;
}

export interface PromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}

export interface DiscoveredPrompt {
  name: string;
  description?: string;
  arguments?: PromptArgument[];
}

export interface PromptTestResult {
  promptName: string;
  description: string;
  input: Record<string, string>;
  status: TestStatus;
  output: unknown;
  error: string | null;
  durationMs: number;
}
