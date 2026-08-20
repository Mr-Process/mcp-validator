import assert from "node:assert/strict";
import { createCapabilityEvidence, isTraceId, sha256 } from "./evidence.js";
import { buildReport } from "./reporter.js";

const report = buildReport("https://example.test/mcp", {
  toolResults: [],
  resourceResults: [],
  promptResults: [],
});

const evidence = createCapabilityEvidence({
  target: report.server,
  trace: {
    schema_version: "operation-envelope/v1",
    trace_id: "trc_01ARZ3NDEKTSV4RRFFQ69G5FAV",
    environment: "staging",
    risk_tier: "read_only",
    policy_version: "policy-1",
  },
  tools: [{ name: "read_status", inputSchema: { type: "object", properties: { b: { type: "string" }, a: { type: "number" } } } }],
  report,
  now: new Date("2026-08-20T00:00:00.000Z"),
  ttlHours: 24,
});

assert.equal(evidence.validation_state, "discovered_only");
assert.equal(evidence.valid_until, "2026-08-21T00:00:00.000Z");
assert.equal(evidence.trace.trace_id, "trc_01ARZ3NDEKTSV4RRFFQ69G5FAV");
assert.ok(isTraceId(evidence.trace.trace_id));
assert.equal(isTraceId("not-a-trace"), false);
assert.equal(sha256({ b: 2, a: 1 }), sha256({ a: 1, b: 2 }));
assert.match(evidence.tool_schemas[0].input_schema_sha256, /^sha256:[a-f0-9]{64}$/);

console.log("PASS: capability-evidence tests completed");
