import { RawMcpClient } from "./client.js";
import { generateTestCases } from "./generator.js";
import { runTests } from "./runner.js";
import { buildReport, reportAsJson, reportAsMarkdown, reportAsSarif, reportAsJunit } from "./reporter.js";

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Dynamic SVG Badge Endpoint: GET /badge?url=...
    if (url.pathname === "/badge") {
      const mcpUrl = url.searchParams.get("url");
      if (!mcpUrl) {
        return new Response(generateBadgeSvg("mcp validator", "invalid url", "#e53e3e"), {
          headers: { "Content-Type": "image/svg+xml", "Cache-Control": "no-cache" },
        });
      }

      try {
        const client = new RawMcpClient(mcpUrl, 15000);
        const tools = await client.discoverTools();
        const testCases = new Map();
        for (const tool of tools) {
          testCases.set(tool.name, generateTestCases(tool.inputSchema as any));
        }

        const suite = await runTests(client, tools, testCases, 15000, 20);
        const report = buildReport(mcpUrl, suite);

        const passRate = report.testsRun > 0 ? Math.round((report.summary.pass / report.testsRun) * 100) : 0;
        const badgeColor = report.summary.fail > 0 || report.summary.crash > 0 ? "#e53e3e" : "#38a169";
        const badgeText = `${passRate}% pass (${report.testsRun} tests)`;

        return new Response(generateBadgeSvg("mcp validation", badgeText, badgeColor), {
          headers: { "Content-Type": "image/svg+xml", "Cache-Control": "max-age=300" },
        });
      } catch (e) {
        return new Response(generateBadgeSvg("mcp validation", "unreachable", "#718096"), {
          headers: { "Content-Type": "image/svg+xml", "Cache-Control": "no-cache" },
        });
      }
    }

    // Serve landing page on GET /
    if (request.method === "GET" && !url.searchParams.has("url")) {
      return new Response(LANDING_HTML, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    const mcpUrl = url.searchParams.get("url");
    if (!mcpUrl) {
      return new Response(
        JSON.stringify({ error: "Missing ?url= query parameter" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const format = url.searchParams.get("format") || "md";
    const timeout = parseInt(url.searchParams.get("timeout") || "30000", 10);
    const maxTests = parseInt(url.searchParams.get("maxTests") || "40", 10);

    // Custom headers support via ?headers={"Authorization":"Bearer token"}
    let customHeaders: Record<string, string> | undefined;
    const headersParam = url.searchParams.get("headers");
    if (headersParam) {
      try {
        customHeaders = JSON.parse(headersParam);
      } catch {
        // ignore invalid JSON headers
      }
    }

    try {
      const client = new RawMcpClient(mcpUrl, timeout, customHeaders);
      const tools = await client.discoverTools();
      const testCases = new Map();

      for (const tool of tools) {
        testCases.set(tool.name, generateTestCases(tool.inputSchema as any));
      }

      const suite = await runTests(client, tools, testCases, maxTests);
      const report = buildReport(mcpUrl, suite);

      if (format === "json") {
        return new Response(reportAsJson(report), {
          headers: { "Content-Type": "application/json" },
        });
      } else if (format === "sarif") {
        return new Response(reportAsSarif(report), {
          headers: { "Content-Type": "application/sarif+json" },
        });
      } else if (format === "junit") {
        return new Response(reportAsJunit(report), {
          headers: { "Content-Type": "application/xml" },
        });
      }

      return new Response(reportAsMarkdown(report), {
        headers: { "Content-Type": "text/markdown; charset=utf-8" },
      });
    } catch (e) {
      return new Response(
        JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  },
};

function generateBadgeSvg(label: string, value: string, color: string): string {
  const labelWidth = label.length * 7 + 12;
  const valueWidth = value.length * 7 + 12;
  const totalWidth = labelWidth + valueWidth;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20">
    <linearGradient id="b" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
    <clipPath id="a"><rect width="${totalWidth}" height="20" rx="3" fill="#fff"/></clipPath>
    <g clip-path="url(#a)">
      <rect width="${labelWidth}" height="20" fill="#555"/>
      <rect x="${labelWidth}" width="${valueWidth}" height="20" fill="${color}"/>
      <rect width="${totalWidth}" height="20" fill="url(#b)"/>
    </g>
    <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
      <text x="${labelWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${label}</text>
      <text x="${labelWidth / 2}" y="14">${label}</text>
      <text x="${labelWidth + valueWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${value}</text>
      <text x="${labelWidth + valueWidth / 2}" y="14">${value}</text>
    </g>
  </svg>`;
}

const LANDING_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MCP Validator</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0a0a0f;
      color: #e0e0e8;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .card {
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 16px;
      padding: 48px;
      max-width: 520px;
      width: 100%;
      backdrop-filter: blur(12px);
    }
    h1 { font-size: 28px; margin-bottom: 8px; }
    p { color: #888; margin-bottom: 24px; font-size: 15px; line-height: 1.5; }
    label { display: block; font-size: 13px; color: #aaa; margin-bottom: 6px; }
    input, select {
      width: 100%;
      padding: 10px 14px;
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 8px;
      color: #e0e0e8;
      font-size: 14px;
      margin-bottom: 16px;
      outline: none;
    }
    input:focus, select:focus { border-color: #6366f1; }
    button {
      width: 100%;
      padding: 12px;
      background: #6366f1;
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
    }
    button:hover { background: #4f46e5; }
    .row { display: flex; gap: 12px; }
    .row > * { flex: 1; }
  </style>
</head>
<body>
  <div class="card">
    <h1>⚡ MCP Validator</h1>
    <p>Validate any MCP server by auto-generating and running test cases, security fuzzing, resources, and prompts.</p>
    <form id="f" onsubmit="go(event)">
      <label>MCP Server URL</label>
      <input id="url" type="url" placeholder="https://your-server.com/mcp" required>
      <div class="row">
        <div>
          <label>Format</label>
          <select id="fmt">
            <option value="md">Markdown</option>
            <option value="json">JSON</option>
            <option value="sarif">SARIF (GitHub Security)</option>
            <option value="junit">JUnit XML</option>
          </select>
        </div>
        <div>
          <label>Timeout (ms)</label>
          <input id="to" type="number" value="30000">
        </div>
      </div>
      <button type="submit">Run Validation</button>
    </form>
  </div>
  <script>
    function go(e) {
      e.preventDefault();
      const u = encodeURIComponent(document.getElementById('url').value);
      const f = document.getElementById('fmt').value;
      const t = document.getElementById('to').value;
      window.open('?url=' + u + '&format=' + f + '&timeout=' + t, '_blank');
    }
  </script>
</body>
</html>`;
