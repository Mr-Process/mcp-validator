import { RawMcpClient, StdioMcpClient, McpClientInterface } from "./client.js";
import { generateTestCases } from "./generator.js";
import { runTests } from "./runner.js";
import { buildReport, reportAsJson, reportAsMarkdown, reportAsSarif, reportAsJunit } from "./reporter.js";

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    console.log(`Usage: npx mcp-validate <target> [options]

Target:
  <url>                    HTTP/Streamable MCP server URL (e.g. https://example.com/mcp)
  --command <cmd>          Local command to run stdio MCP server (e.g. --command "node server.js")

Options:
  --header, -H <header>    Custom HTTP header (e.g. -H "Authorization: Bearer token")
  --format <json|md|sarif|junit> Output format (default: json)
  --timeout <ms>           Request timeout in milliseconds (default: 30000)
  --max-tests <n>          Maximum number of tool test cases to execute
  --help, -h               Show this help

Examples:
  npx mcp-validate https://example.com/mcp --format md
  npx mcp-validate https://example.com/mcp -H "Authorization: Bearer secret" --format sarif
  npx mcp-validate --command "node build/index.js" --format junit
`);
    process.exit(0);
  }

  let serverTarget = "";
  let stdioCmd = "";
  let format = "json";
  let timeout = 30000;
  let maxTests: number | undefined = undefined;
  const customHeaders: Record<string, string> = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--command" || args[i] === "--stdio") {
      stdioCmd = args[i + 1] || "";
      i++;
    } else if (args[i] === "--header" || args[i] === "-H") {
      const headerStr = args[i + 1] || "";
      const colonIdx = headerStr.indexOf(":");
      if (colonIdx > 0) {
        const key = headerStr.slice(0, colonIdx).trim();
        const val = headerStr.slice(colonIdx + 1).trim();
        customHeaders[key] = val;
      }
      i++;
    } else if (args[i] === "--format" && args[i + 1]) {
      format = args[i + 1];
      i++;
    } else if (args[i] === "--timeout" && args[i + 1]) {
      timeout = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--max-tests" && args[i + 1]) {
      maxTests = parseInt(args[i + 1], 10);
      i++;
    } else if (!args[i].startsWith("-") && !serverTarget) {
      serverTarget = args[i];
    }
  }

  let client: McpClientInterface;
  let targetLabel = "";

  if (stdioCmd) {
    targetLabel = `Command: ${stdioCmd}`;
    console.error(`Starting local stdio server: ${stdioCmd}...`);
    client = new StdioMcpClient(stdioCmd, timeout);
  } else if (serverTarget) {
    targetLabel = serverTarget;
    console.error(`Connecting to ${serverTarget}...`);
    client = new RawMcpClient(serverTarget, timeout, customHeaders);
  } else {
    console.error("Error: Must specify either an HTTP URL or a local stdio command using --command");
    process.exit(1);
  }

  await client.connect();
  const tools = await client.discoverTools();
  console.error(`Discovered ${tools.length} tools.`);

  const testCases = new Map();
  for (const tool of tools) {
    testCases.set(tool.name, generateTestCases(tool.inputSchema as any));
  }

  const totalCases = Array.from(testCases.values()).reduce((sum: number, c: any) => sum + c.length, 0);
  console.error(`Generated ${totalCases} test cases (including security fuzzing vectors).`);

  const suiteResults = await runTests(client, tools, testCases, maxTests);
  const report = buildReport(targetLabel, suiteResults);

  if (format === "md") {
    console.log(reportAsMarkdown(report));
  } else if (format === "sarif") {
    console.log(reportAsSarif(report));
  } else if (format === "junit") {
    console.log(reportAsJunit(report));
  } else {
    console.log(reportAsJson(report));
  }
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
