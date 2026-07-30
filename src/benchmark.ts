import { RawMcpClient } from "./client.js";
import { generateTestCases } from "./generator.js";
import { runTests } from "./runner.js";
import { buildReport } from "./reporter.js";

interface TargetServer {
  name: string;
  url: string;
  category: string;
}

const PUBLIC_MCP_SERVERS: TargetServer[] = [
  {
    name: "Autonomous-ACP-Bridge",
    url: "https://acp-bridge-mcp.jonathonpowell.workers.dev/mcp",
    category: "Payment & Escrow Bridge",
  },
];

export async function runBenchmark(servers = PUBLIC_MCP_SERVERS): Promise<string> {
  const lines: string[] = [];
  lines.push("# 🏆 MCP Server Ecosystem Compatibility Matrix");
  lines.push("");
  lines.push(`*Generated on ${new Date().toISOString().split("T")[0]} by MCP Validator*`);
  lines.push("");
  lines.push("| Server Name | Category | Tools | Tests Run | Pass Rate | Fuzzing Passed | Latency (avg) | Status |");
  lines.push("|-------------|----------|-------|-----------|-----------|----------------|---------------|--------|");

  for (const s of servers) {
    try {
      const client = new RawMcpClient(s.url, 20000);
      const tools = await client.discoverTools();

      const testCases = new Map();
      for (const tool of tools) {
        testCases.set(tool.name, generateTestCases(tool.inputSchema as any));
      }

      const suite = await runTests(client, tools, testCases);
      const report = buildReport(s.url, suite);

      const passRate = report.testsRun > 0 ? `${Math.round((report.summary.pass / report.testsRun) * 100)}%` : "0%";
      const avgDuration = report.results.length > 0
        ? `${Math.round(report.results.reduce((acc, r) => acc + r.durationMs, 0) / report.results.length)}ms`
        : "N/A";
      const statusIcon = report.summary.fail === 0 && report.summary.crash === 0 ? "🟢 Compliant" : "🔴 Issues Detected";

      lines.push(
        `| **${s.name}** | ${s.category} | ${report.toolsDiscovered} | ${report.testsRun} | ${passRate} | ${report.summary.fuzzingPassed} | ${avgDuration} | ${statusIcon} |`
      );
    } catch (e) {
      lines.push(
        `| **${s.name}** | ${s.category} | N/A | 0 | 0% | 0 | N/A | 🔴 Offline / Error |`
      );
    }
  }

  lines.push("");
  return lines.join("\n");
}

if (process.argv[1]?.includes("benchmark")) {
  runBenchmark().then((md) => console.log(md)).catch(console.error);
}
