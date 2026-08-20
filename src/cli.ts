import { writeFile } from "node:fs/promises";
import { RawMcpClient, StdioMcpClient, McpClientInterface } from "./client.js";
import { createCapabilityEvidence, createTraceId, isTraceId, type RiskTier } from "./evidence.js";
import { generateTestCases } from "./generator.js";
import { runTests, type RunOptions } from "./runner.js";
import { buildReport, reportAsJson, reportAsMarkdown, reportAsSarif, reportAsJunit } from "./reporter.js";

const RISK_TIERS: readonly RiskTier[] = [
  "unclassified",
  "read_only",
  "reversible",
  "external_write",
  "financial_or_irreversible",
];

function readPositiveInteger(value: string | undefined, option: string, maximum = Number.MAX_SAFE_INTEGER): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`${option} requires an integer from 1 to ${maximum}.`);
  }
  return parsed;
}

function readRiskTier(value: string | undefined): RiskTier {
  if (!value || !RISK_TIERS.includes(value as RiskTier)) {
    throw new Error(`--risk-tier must be one of: ${RISK_TIERS.join(", ")}.`);
  }
  return value as RiskTier;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    console.log(`Usage: npx mcp-validate <target> [options]

Target:
  <url>                         HTTP/Streamable MCP server URL
  --command <cmd>               Local stdio MCP command; requires --allow-stdio

Safety defaults:
  Discovery-only mode is the default. It does not call discovered tools, read
  resources, execute prompts, launch stdio, or send fuzz cases.

Execution options (each requires an explicit bounded budget):
  --allow-tool-execution         Permit generated non-fuzz tool calls
  --allow-fuzzing                Permit generated fuzz cases; requires --allow-tool-execution
  --max-tests <n>                Maximum tool calls
  --allow-resource-reads         Permit resource reads
  --max-resources <n>            Maximum resource reads
  --allow-prompt-execution       Permit prompt invocation
  --max-prompts <n>              Maximum prompt invocations
  --allow-stdio                  Permit launching the supplied local stdio command

Capability evidence:
  --trace-id <id>                Trace ID; generated when omitted (format: trc_...)
  --environment <name>           Environment label (default: development)
  --risk-tier <tier>             unclassified|read_only|reversible|external_write|financial_or_irreversible
  --policy-version <value>       Optional policy version reference
  --evidence-ttl-hours <n>       Evidence freshness period, 1–720 hours (default: 24)
  --write-evidence <path>        Write the capability-evidence JSON artifact

Other options:
  --header, -H <header>          Custom HTTP header (avoid passing secrets in shared shell history)
  --format <json|md|sarif|junit> Output format (default: json)
  --timeout <ms>                 Per-operation timeout in milliseconds (default: 30000)
  --max-output-bytes <n>         Maximum serialized output retained per result (default: 262144)
  --help, -h                     Show this help
`);
    return;
  }

  let serverTarget = "";
  let stdioCommand = "";
  let format = "json";
  let timeout = 30_000;
  let allowStdio = false;
  let traceId = createTraceId();
  let environment = "development";
  let riskTier: RiskTier = "unclassified";
  let policyVersion: string | undefined;
  let evidencePath: string | undefined;
  let evidenceTtlHours = 24;
  const customHeaders: Record<string, string> = {};
  const runOptions: RunOptions = {};

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const next = args[index + 1];

    switch (argument) {
      case "--command":
      case "--stdio":
        stdioCommand = next || "";
        index += 1;
        break;
      case "--allow-stdio":
        allowStdio = true;
        break;
      case "--header":
      case "-H": {
        const separator = (next || "").indexOf(":");
        if (separator <= 0) throw new Error("--header expects 'Name: value'.");
        customHeaders[next.slice(0, separator).trim()] = next.slice(separator + 1).trim();
        index += 1;
        break;
      }
      case "--format":
        format = next || "";
        index += 1;
        break;
      case "--timeout":
        timeout = readPositiveInteger(next, "--timeout", 300_000);
        runOptions.operationTimeoutMs = timeout;
        index += 1;
        break;
      case "--max-output-bytes":
        runOptions.maxOutputBytes = readPositiveInteger(next, "--max-output-bytes", 10 * 1024 * 1024);
        index += 1;
        break;
      case "--max-tests":
        runOptions.maxToolTests = readPositiveInteger(next, "--max-tests", 10_000);
        index += 1;
        break;
      case "--max-resources":
        runOptions.maxResourceReads = readPositiveInteger(next, "--max-resources", 10_000);
        index += 1;
        break;
      case "--max-prompts":
        runOptions.maxPromptGets = readPositiveInteger(next, "--max-prompts", 10_000);
        index += 1;
        break;
      case "--trace-id":
        traceId = next || "";
        index += 1;
        break;
      case "--environment":
        environment = (next || "").trim();
        index += 1;
        break;
      case "--risk-tier":
        riskTier = readRiskTier(next);
        index += 1;
        break;
      case "--policy-version":
        policyVersion = (next || "").trim() || undefined;
        index += 1;
        break;
      case "--evidence-ttl-hours":
        evidenceTtlHours = readPositiveInteger(next, "--evidence-ttl-hours", 24 * 30);
        index += 1;
        break;
      case "--write-evidence":
        evidencePath = next || "";
        index += 1;
        break;
      case "--allow-tool-execution":
        runOptions.allowToolExecution = true;
        break;
      case "--allow-fuzzing":
        runOptions.allowFuzzing = true;
        break;
      case "--allow-resource-reads":
        runOptions.allowResourceReads = true;
        break;
      case "--allow-prompt-execution":
        runOptions.allowPromptExecution = true;
        break;
      default:
        if (!argument.startsWith("-") && !serverTarget) serverTarget = argument;
        else if (argument.startsWith("-")) throw new Error(`Unknown option: ${argument}`);
    }
  }

  if (!isTraceId(traceId)) throw new Error("--trace-id must use the trc_ prefix and contain 12–128 URL-safe characters.");
  if (!/^[A-Za-z0-9._:@/-]{1,128}$/.test(environment)) throw new Error("--environment contains unsupported characters.");
  if (policyVersion && !/^[A-Za-z0-9._:@/-]{1,128}$/.test(policyVersion)) throw new Error("--policy-version contains unsupported characters.");
  if (evidencePath !== undefined && !evidencePath) throw new Error("--write-evidence requires a file path.");
  if (runOptions.allowToolExecution && !runOptions.maxToolTests) throw new Error("--allow-tool-execution requires --max-tests <n>.");
  if (runOptions.allowFuzzing && !runOptions.allowToolExecution) throw new Error("--allow-fuzzing requires --allow-tool-execution.");
  if (runOptions.allowResourceReads && !runOptions.maxResourceReads) throw new Error("--allow-resource-reads requires --max-resources <n>.");
  if (runOptions.allowPromptExecution && !runOptions.maxPromptGets) throw new Error("--allow-prompt-execution requires --max-prompts <n>.");

  let client: McpClientInterface;
  let targetLabel: string;
  if (stdioCommand) {
    if (!allowStdio) throw new Error("--command requires --allow-stdio.");
    targetLabel = "Local stdio command (redacted)";
    console.error("Starting explicitly approved local stdio server...");
    client = new StdioMcpClient(stdioCommand, timeout);
  } else if (serverTarget) {
    targetLabel = serverTarget;
    console.error(`Connecting to ${serverTarget}...`);
    client = new RawMcpClient(serverTarget, timeout, customHeaders);
  } else {
    throw new Error("Specify an HTTP URL or --command with --allow-stdio.");
  }

  const tools = await client.discoverTools();
  console.error(`Discovered ${tools.length} tools; trace=${traceId}.`);
  const testCases = new Map(tools.map((tool) => [tool.name, generateTestCases(tool.inputSchema as Record<string, unknown>)]));
  const totalCases = Array.from(testCases.values()).reduce((sum, cases) => sum + cases.length, 0);
  console.error(`Generated ${totalCases} candidate cases; execution follows the explicit policy flags.`);

  const suiteResults = await runTests(client, tools, testCases, runOptions);
  const report = buildReport(targetLabel, suiteResults);
  report.capability_evidence = createCapabilityEvidence({
    target: targetLabel,
    trace: {
      schema_version: "operation-envelope/v1",
      trace_id: traceId,
      environment,
      risk_tier: riskTier,
      ...(policyVersion ? { policy_version: policyVersion } : {}),
    },
    tools,
    report,
    options: runOptions,
    ttlHours: evidenceTtlHours,
  });

  if (evidencePath) {
    await writeFile(evidencePath, JSON.stringify(report.capability_evidence, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
    console.error(`Wrote capability evidence to ${evidencePath}.`);
  }

  if (format === "md") console.log(reportAsMarkdown(report));
  else if (format === "sarif") console.log(reportAsSarif(report));
  else if (format === "junit") console.log(reportAsJunit(report));
  else if (format === "json") console.log(reportAsJson(report));
  else throw new Error("--format must be one of json, md, sarif, or junit.");
}

main().catch((error: unknown) => {
  console.error("Error:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
