import type { TestResult, ResourceTestResult, PromptTestResult } from "./types.js";
import type { SuiteResults } from "./runner.js";

export interface ValidationReport {
  server: string;
  timestamp: string;
  toolsDiscovered: number;
  resourcesDiscovered: number;
  promptsDiscovered: number;
  testsRun: number;
  summary: {
    pass: number;
    fail: number;
    crash: number;
    schemaMismatch: number;
    fuzzingPassed: number;
  };
  results: TestResult[];
  resources: ResourceTestResult[];
  prompts: PromptTestResult[];
}

export function buildReport(server: string, suite: SuiteResults): ValidationReport {
  const { toolResults, resourceResults, promptResults } = suite;

  const summary = {
    pass: toolResults.filter((r) => r.status === "pass").length,
    fail: toolResults.filter((r) => r.status === "fail").length,
    crash: toolResults.filter((r) => r.status === "crash").length,
    schemaMismatch: toolResults.filter((r) => r.status === "schema_mismatch").length,
    fuzzingPassed: toolResults.filter((r) => r.category.startsWith("fuzz_") && r.status === "pass").length,
  };

  return {
    server,
    timestamp: new Date().toISOString(),
    toolsDiscovered: new Set(toolResults.map((r) => r.toolName)).size,
    resourcesDiscovered: resourceResults.length,
    promptsDiscovered: promptResults.length,
    testsRun: toolResults.length + resourceResults.length + promptResults.length,
    summary,
    results: toolResults,
    resources: resourceResults,
    prompts: promptResults,
  };
}

export function reportAsJson(report: ValidationReport): string {
  return JSON.stringify(report, null, 2);
}

export function reportAsMarkdown(report: ValidationReport): string {
  const lines: string[] = [];
  lines.push(`# ⚡ MCP Server Validation Report`);
  lines.push("");
  lines.push(`**Server / Command:** \`${report.server}\``);
  lines.push(`**Date:** ${report.timestamp}`);
  lines.push(`**Tools Discovered:** ${report.toolsDiscovered}`);
  lines.push(`**Resources Discovered:** ${report.resourcesDiscovered}`);
  lines.push(`**Prompts Discovered:** ${report.promptsDiscovered}`);
  lines.push(`**Total Tests Run:** ${report.testsRun}`);
  lines.push("");
  lines.push(`## 📊 Summary`);
  lines.push("");
  lines.push(`| Status | Count |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Pass | ${report.summary.pass} |`);
  lines.push(`| Fail | ${report.summary.fail} |`);
  lines.push(`| Crash | ${report.summary.crash} |`);
  lines.push(`| Schema Mismatch | ${report.summary.schemaMismatch} |`);
  lines.push(`| Security Fuzzing Passed | ${report.summary.fuzzingPassed} |`);
  lines.push("");

  // Tools Table
  if (report.results.length > 0) {
    lines.push(`## 🛠️ Tool Validation Results`);
    lines.push("");

    const byTool = new Map<string, TestResult[]>();
    for (const r of report.results) {
      if (!byTool.has(r.toolName)) byTool.set(r.toolName, []);
      byTool.get(r.toolName)!.push(r);
    }

    for (const [toolName, toolResults] of byTool) {
      lines.push(`### Tool: \`${toolName}\``);
      lines.push("");
      lines.push(`| Category | Description | Status | Duration | Error |`);
      lines.push(`|----------|-------------|--------|----------|-------|`);
      for (const r of toolResults) {
        const error = r.error ? r.error.replace(/\|/g, "\\|").substring(0, 80) : "";
        lines.push(`| ${r.category} | ${r.description} | ${r.status} | ${r.durationMs}ms | ${error} |`);
      }
      lines.push("");
    }
  }

  // Resources Table
  if (report.resources.length > 0) {
    lines.push(`## 📄 Resource Validation Results`);
    lines.push("");
    lines.push(`| Resource Name | URI | MIME Type | Status | Duration | Error |`);
    lines.push(`|---------------|-----|-----------|--------|----------|-------|`);
    for (const r of report.resources) {
      const error = r.error ? r.error.replace(/\|/g, "\\|").substring(0, 80) : "";
      lines.push(`| ${r.name} | \`${r.uri}\` | ${r.mimeType || "N/A"} | ${r.status} | ${r.durationMs}ms | ${error} |`);
    }
    lines.push("");
  }

  // Prompts Table
  if (report.prompts.length > 0) {
    lines.push(`## 💬 Prompt Validation Results`);
    lines.push("");
    lines.push(`| Prompt Name | Description | Status | Duration | Error |`);
    lines.push(`|-------------|-------------|--------|----------|-------|`);
    for (const p of report.prompts) {
      const error = p.error ? p.error.replace(/\|/g, "\\|").substring(0, 80) : "";
      lines.push(`| ${p.promptName} | ${p.description} | ${p.status} | ${p.durationMs}ms | ${error} |`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Output report as SARIF v2.1.0 for GitHub Code Scanning / Security Tab integration.
 */
export function reportAsSarif(report: ValidationReport): string {
  const rules: any[] = [];
  const results: any[] = [];

  const ruleMap = new Map<string, number>();

  for (const r of report.results) {
    if (r.status === "fail" || r.status === "crash" || r.status === "schema_mismatch") {
      const ruleId = `MCP-${r.category.toUpperCase()}`;
      if (!ruleMap.has(ruleId)) {
        ruleMap.set(ruleId, rules.length);
        rules.push({
          id: ruleId,
          shortDescription: { text: `MCP Validation Issue: ${r.category}` },
          fullDescription: { text: `Validation failed for category ${r.category}` },
          defaultConfiguration: {
            level: r.status === "crash" ? "error" : "warning",
          },
        });
      }

      results.push({
        ruleId,
        ruleIndex: ruleMap.get(ruleId),
        message: {
          text: `[Tool: ${r.toolName}] ${r.description}: ${r.error || r.status}`,
        },
        locations: [
          {
            physicalLocation: {
              artifactLocation: { uri: `mcp://${report.server}/${r.toolName}` },
            },
          },
        ],
      });
    }
  }

  const sarif = {
    $schema: "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "MCP Validator",
            version: "1.0.0",
            rules,
          },
        },
        results,
      },
    ],
  };

  return JSON.stringify(sarif, null, 2);
}

/**
 * Output report as JUnit XML format for Jenkins, CircleCI, and GitHub Actions test reporting.
 */
export function reportAsJunit(report: ValidationReport): string {
  const xmlLines: string[] = [];
  xmlLines.push('<?xml version="1.0" encoding="UTF-8"?>');
  xmlLines.push(
    `<testsuite name="MCP Validation" tests="${report.testsRun}" failures="${report.summary.fail + report.summary.schemaMismatch}" errors="${report.summary.crash}" timestamp="${report.timestamp}">`
  );

  for (const r of report.results) {
    xmlLines.push(`  <testcase classname="${r.toolName}" name="${escapeXml(r.description)}" time="${(r.durationMs / 1000).toFixed(3)}">`);
    if (r.status === "fail" || r.status === "schema_mismatch") {
      xmlLines.push(`    <failure message="${escapeXml(r.error || r.status)}">${escapeXml(JSON.stringify(r.input))}</failure>`);
    } else if (r.status === "crash") {
      xmlLines.push(`    <error message="${escapeXml(r.error || "Server Crash")}">${escapeXml(JSON.stringify(r.input))}</error>`);
    }
    xmlLines.push(`  </testcase>`);
  }

  xmlLines.push("</testsuite>");
  return xmlLines.join("\n");
}

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
