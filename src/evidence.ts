import { createHash, randomUUID } from "node:crypto";
import type { DiscoveredTool } from "./client.js";
import type { RunOptions } from "./runner.js";
import type { ValidationReport } from "./reporter.js";

export const CAPABILITY_EVIDENCE_SCHEMA_VERSION = "capability-evidence/v1" as const;

export type RiskTier =
  | "unclassified"
  | "read_only"
  | "reversible"
  | "external_write"
  | "financial_or_irreversible";

export interface OperationContext {
  schema_version: "operation-envelope/v1";
  trace_id: string;
  environment: string;
  risk_tier: RiskTier;
  policy_version?: string;
}

export interface CapabilityEvidence {
  schema_version: typeof CAPABILITY_EVIDENCE_SCHEMA_VERSION;
  evidence_id: string;
  trace: OperationContext;
  target: string;
  created_at: string;
  valid_until: string;
  validation_state: "discovered_only" | "passed" | "failed" | "incomplete";
  execution_policy: Required<RunOptions>;
  tool_schemas: Array<{
    name: string;
    input_schema_sha256: string;
    output_schema_sha256?: string;
  }>;
  report_summary: ValidationReport["summary"];
  report_sha256: string;
  advisory: string;
}

const DEFAULT_EXECUTION_POLICY: Required<RunOptions> = {
  maxToolTests: 0,
  maxResourceReads: 0,
  maxPromptGets: 0,
  maxOutputBytes: 256 * 1024,
  operationTimeoutMs: 30_000,
  allowToolExecution: false,
  allowFuzzing: false,
  allowResourceReads: false,
  allowPromptExecution: false,
};

export function createTraceId(): string {
  return `trc_${randomUUID().replace(/-/g, "")}`;
}

export function isTraceId(value: string): boolean {
  return /^trc_[A-Za-z0-9_-]{12,128}$/.test(value);
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`);
  return `{${entries.join(",")}}`;
}

export function sha256(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function validationState(report: ValidationReport): CapabilityEvidence["validation_state"] {
  if (!report.summary.pass && !report.summary.fail && !report.summary.crash && !report.summary.timeout && !report.summary.schemaMismatch) {
    return "discovered_only";
  }
  if (report.summary.fail || report.summary.crash || report.summary.timeout || report.summary.schemaMismatch) {
    return "failed";
  }
  if (report.summary.skipped || report.summary.outputLimited) return "incomplete";
  return "passed";
}

export function createCapabilityEvidence(input: {
  target: string;
  trace: OperationContext;
  tools: DiscoveredTool[];
  report: ValidationReport;
  options?: RunOptions;
  ttlHours?: number;
  now?: Date;
}): CapabilityEvidence {
  const now = input.now ?? new Date();
  const ttlHours = input.ttlHours ?? 24;
  if (!Number.isFinite(ttlHours) || ttlHours < 1 || ttlHours > 24 * 30) {
    throw new Error("Evidence TTL must be between 1 hour and 30 days.");
  }

  return {
    schema_version: CAPABILITY_EVIDENCE_SCHEMA_VERSION,
    evidence_id: `cap_${randomUUID().replace(/-/g, "")}`,
    trace: input.trace,
    target: input.target,
    created_at: now.toISOString(),
    valid_until: new Date(now.getTime() + ttlHours * 60 * 60 * 1_000).toISOString(),
    validation_state: validationState(input.report),
    execution_policy: { ...DEFAULT_EXECUTION_POLICY, ...(input.options ?? {}) },
    tool_schemas: input.tools.map((tool) => ({
      name: tool.name,
      input_schema_sha256: sha256(tool.inputSchema),
      ...(tool.outputSchema ? { output_schema_sha256: sha256(tool.outputSchema) } : {}),
    })),
    report_summary: input.report.summary,
    report_sha256: sha256({
      server: input.report.server,
      summary: input.report.summary,
      results: input.report.results,
      resources: input.report.resources,
      prompts: input.report.prompts,
    }),
    advisory: "Capability evidence records validation context only. Downstream policy must authorize target, tool, risk tier, freshness, and each consequential action separately.",
  };
}
