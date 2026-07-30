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
