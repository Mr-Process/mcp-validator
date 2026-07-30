import { RawMcpClient } from "./client.js";
import { generateTestCases } from "./generator.js";
import { runTests } from "./runner.js";
import { buildReport, reportAsJson, reportAsMarkdown } from "./reporter.js";

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Serve a simple landing page on GET /
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

    try {
      const client = new RawMcpClient(mcpUrl, timeout);
      const tools = await client.discoverTools();
      const testCases = new Map();

      for (const tool of tools) {
        testCases.set(tool.name, generateTestCases(tool.inputSchema as any));
      }

      const results = await runTests(client, tools, testCases, maxTests);
      const report = buildReport(mcpUrl, results);

      if (format === "json") {
        return new Response(reportAsJson(report), {
          headers: { "Content-Type": "application/json" },
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
    <p>Validate any MCP server by auto-generating and running test cases from its tool schemas.</p>
    <form id="f" onsubmit="go(event)">
      <label>MCP Server URL</label>
      <input id="url" type="url" placeholder="https://your-server.com/mcp" required>
      <div class="row">
        <div>
          <label>Format</label>
          <select id="fmt"><option value="md">Markdown</option><option value="json">JSON</option></select>
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
