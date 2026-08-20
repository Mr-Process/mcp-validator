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
    timeout: number;
    schemaMismatch: number;
    skipped: number;
    outputLimited: number;
    fuzzingPassed: number;
  };
  results: TestResult[];
  resources: ResourceTestResult[];
  prompts: PromptTestResult[];
}

export function buildReport(server: string, suite: SuiteResults): ValidationReport {
  const { toolResults, resourceResults, promptResults } = suite;
  const summary = {
    pass: toolResults.filter((result) => result.status === "pass").length,
    fail: toolResults.filter((result) => result.status === "fail").length,
    crash: toolResults.filter((result) => result.status === "crash").length,
    timeout: toolResults.filter((result) => result.status === "timeout").length,
    schemaMismatch: toolResults.filter((result) => result.status === "schema_mismatch").length,
    skipped: toolResults.filter((result) => result.status === "skipped").length,
    outputLimited: toolResults.filter((result) => result.status === "output_limited").length,
    fuzzingPassed: toolResults.filter((result) => result.category.startsWith("fuzz_") && result.status === "pass").length,
  };

  return {
    server,
    timestamp: new Date().toISOString(),
    toolsDiscovered: new Set(toolResults.map((result) => result.toolName)).size,
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
  lines.push("# MCP Server Validation Report", "");
  lines.push(`**Server / Command:** \`${report.server}\``);
  lines.push(`**Date:** ${report.timestamp}`);
  lines.push(`**Tools Discovered:** ${report.toolsDiscovered}`);
  lines.push(`**Resources Discovered:** ${report.resourcesDiscovered}`);
  lines.push(`**Prompts Discovered:** ${report.promptsDiscovered}`);
  lines.push(`**Total Cases Reported:** ${report.testsRun}`, "");
  lines.push("## Summary", "", "| Status | Count |", "|--------|-------|");
  lines.push(`| Pass | ${report.summary.pass} |`);
  lines.push(`| Fail | ${report.summary.fail} |`);
  lines.push(`| Crash | ${report.summary.crash} |`);
  lines.push(`| Timeout | ${report.summary.timeout} |`);
  lines.push(`| Schema Mismatch | ${report.summary.schemaMismatch} |`);
  lines.push(`| Skipped by Policy / Budget | ${report.summary.skipped} |`);
  lines.push(`| Output Limited | ${report.summary.outputLimited} |`);
  lines.push(`| Security Fuzzing Passed | ${report.summary.fuzzingPassed} |`, "");

  appendToolResults(lines, report.results);
  appendResourceResults(lines, report.resources);
  appendPromptResults(lines, report.prompts);
  return lines.join("\n");
}

function appendToolResults(lines: string[], results: TestResult[]): void {
  if (results.length === 0) return;
  lines.push("## Tool Validation Results", "");
  const byTool = new Map<string, TestResult[]>();
  for (const result of results) {
    byTool.set(result.toolName, [...(byTool.get(result.toolName) ?? []), result]);
  }
  for (const [toolName, toolResults] of byTool) {
    lines.push(`### Tool: \`${toolName}\``, "");
    lines.push("| Category | Description | Status | Duration | Error |", "|----------|-------------|--------|----------|-------|");
    for (const result of toolResults) {
      lines.push(`| ${result.category} | ${result.description} | ${result.status} | ${result.durationMs}ms | ${escapeTable(result.error)} |`);
    }
    lines.push("");
  }
}

function appendResourceResults(lines: string[], results: ResourceTestResult[]): void {
  if (results.length === 0) return;
  lines.push("## Resource Validation Results", "");
  lines.push("| Resource Name | URI | MIME Type | Status | Duration | Error |", "|---------------|-----|-----------|--------|----------|-------|");
  for (const result of results) {
    lines.push(`| ${result.name} | \`${result.uri}\` | ${result.mimeType || "N/A"} | ${result.status} | ${result.durationMs}ms | ${escapeTable(result.error)} |`);
  }
  lines.push("");
}

function appendPromptResults(lines: string[], results: PromptTestResult[]): void {
  if (results.length === 0) return;
  lines.push("## Prompt Validation Results", "");
  lines.push("| Prompt Name | Description | Status | Duration | Error |", "|-------------|-------------|--------|----------|-------|");
  for (const result of results) {
    lines.push(`| ${result.promptName} | ${result.description} | ${result.status} | ${result.durationMs}ms | ${escapeTable(result.error)} |`);
  }
  lines.push("");
}

function escapeTable(value: string | null): string {
  return value ? value.replace(/\|/g, "\\|").substring(0, 120) : "";
}

/** Output SARIF v2.1.0 for code-scanning integration. */
export function reportAsSarif(report: ValidationReport): string {
  const rules: Array<Record<string, unknown>> = [];
  const results: Array<Record<string, unknown>> = [];
  const ruleMap = new Map<string, number>();
  const reportable = new Set(["fail", "crash", "timeout", "schema_mismatch", "output_limited"]);

  for (const result of report.results) {
    if (!reportable.has(result.status)) continue;
    const ruleId = `MCP-${result.category.toUpperCase()}`;
    if (!ruleMap.has(ruleId)) {
      ruleMap.set(ruleId, rules.length);
      rules.push({
        id: ruleId,
        shortDescription: { text: `MCP validation issue: ${result.category}` },
        fullDescription: { text: `Validation reported ${result.status} for ${result.category}` },
        defaultConfiguration: { level: result.status === "crash" || result.status === "timeout" ? "error" : "warning" },
      });
    }
    results.push({
      ruleId,
      ruleIndex: ruleMap.get(ruleId),
      message: { text: `[Tool: ${result.toolName}] ${result.description}: ${result.error || result.status}` },
      locations: [{ physicalLocation: { artifactLocation: { uri: `mcp://${report.server}/${result.toolName}` } } }],
    });
  }

  return JSON.stringify({
    $schema: "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json",
    version: "2.1.0",
    runs: [{ tool: { driver: { name: "MCP Validator", version: "1.1.0", rules } }, results }],
  }, null, 2);
}

/** Output JUnit XML, preserving policy skips as skipped test cases. */
export function reportAsJunit(report: ValidationReport): string {
  const xmlLines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuite name="MCP Validation" tests="${report.testsRun}" failures="${report.summary.fail + report.summary.schemaMismatch}" errors="${report.summary.crash + report.summary.timeout}" skipped="${report.summary.skipped}" timestamp="${report.timestamp}">`,
  ];

  for (const result of report.results) {
    xmlLines.push(`  <testcase classname="${escapeXml(result.toolName)}" name="${escapeXml(result.description)}" time="${(result.durationMs / 1000).toFixed(3)}">`);
    if (result.status === "fail" || result.status === "schema_mismatch" || result.status === "output_limited") {
      xmlLines.push(`    <failure message="${escapeXml(result.error || result.status)}">${escapeXml(JSON.stringify(result.input))}</failure>`);
    } else if (result.status === "crash" || result.status === "timeout") {
      xmlLines.push(`    <error message="${escapeXml(result.error || result.status)}">${escapeXml(JSON.stringify(result.input))}</error>`);
    } else if (result.status === "skipped") {
      xmlLines.push(`    <skipped message="${escapeXml(result.error || "Skipped by policy")}" />`);
    }
    xmlLines.push("  </testcase>");
  }

  xmlLines.push("</testsuite>");
  return xmlLines.join("\n");
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
