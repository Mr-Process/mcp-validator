import { RawMcpClient, StdioMcpClient, McpClientInterface } from "./client.js";
import { generateTestCases } from "./generator.js";
import { runTests, type RunOptions } from "./runner.js";
import { buildReport, reportAsJson, reportAsMarkdown, reportAsSarif, reportAsJunit } from "./reporter.js";

function readPositiveInteger(value: string | undefined, option: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${option} requires a positive integer.`);
  }
  return parsed;
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

Other options:
  --header, -H <header>          Custom HTTP header (avoid passing secrets in shared shell history)
  --format <json|md|sarif|junit> Output format (default: json)
  --timeout <ms>                 Per-operation timeout in milliseconds (default: 30000)
  --max-output-bytes <n>         Maximum serialized output retained per result (default: 262144)
  --help, -h                     Show this help

Examples:
  npx mcp-validate https://example.com/mcp
  npx mcp-validate https://example.com/mcp --allow-tool-execution --max-tests 5
  npx mcp-validate https://example.com/mcp --allow-resource-reads --max-resources 2
`);
    return;
  }

  let serverTarget = "";
  let stdioCommand = "";
  let format = "json";
  let timeout = 30_000;
  let allowStdio = false;
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
        timeout = readPositiveInteger(next, "--timeout");
        runOptions.operationTimeoutMs = timeout;
        index += 1;
        break;
      case "--max-output-bytes":
        runOptions.maxOutputBytes = readPositiveInteger(next, "--max-output-bytes");
        index += 1;
        break;
      case "--max-tests":
        runOptions.maxToolTests = readPositiveInteger(next, "--max-tests");
        index += 1;
        break;
      case "--max-resources":
        runOptions.maxResourceReads = readPositiveInteger(next, "--max-resources");
        index += 1;
        break;
      case "--max-prompts":
        runOptions.maxPromptGets = readPositiveInteger(next, "--max-prompts");
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
        if (!argument.startsWith("-") && !serverTarget) {
          serverTarget = argument;
        } else if (argument.startsWith("-")) {
          throw new Error(`Unknown option: ${argument}`);
        }
    }
  }

  if (runOptions.allowToolExecution && !runOptions.maxToolTests) {
    throw new Error("--allow-tool-execution requires --max-tests <n>.");
  }
  if (runOptions.allowFuzzing && !runOptions.allowToolExecution) {
    throw new Error("--allow-fuzzing requires --allow-tool-execution.");
  }
  if (runOptions.allowResourceReads && !runOptions.maxResourceReads) {
    throw new Error("--allow-resource-reads requires --max-resources <n>.");
  }
  if (runOptions.allowPromptExecution && !runOptions.maxPromptGets) {
    throw new Error("--allow-prompt-execution requires --max-prompts <n>.");
  }

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
  console.error(`Discovered ${tools.length} tools.`);
  const testCases = new Map(tools.map((tool) => [tool.name, generateTestCases(tool.inputSchema as Record<string, unknown>)]));
  const totalCases = Array.from(testCases.values()).reduce((sum, cases) => sum + cases.length, 0);
  console.error(`Generated ${totalCases} candidate cases; execution follows the explicit policy flags.`);

  const suiteResults = await runTests(client, tools, testCases, runOptions);
  const report = buildReport(targetLabel, suiteResults);
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
