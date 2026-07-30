# ⚡ MCP Validator

An automated validation, schema testing, and security fuzzing engine for Model Context Protocol (MCP) servers. Supports HTTP/Streamable HTTP servers and local stdio CLI binaries.

## 🚀 Key Features

1. **Full Protocol Support**: Validates Tools (`tools/list`, `tools/call`), Resources (`resources/list`, `resources/read`), and Prompts (`prompts/list`, `prompts/get`).
2. **Schema-Driven Testing**: Auto-generates valid minimal, valid full, boundary, missing required field, type mismatch, and null test vectors from tool JSON Schemas.
3. **Output Schema Validation**: Validates tool output payload structures against declared `outputSchema` definitions.
4. **Security Fuzzing Vectors**: Injects SQLi, Path Traversal, XSS, Format String, and Buffer Overflow payloads to ensure backends fail safely without crashing.
5. **Dual Transport Support**: Connects to remote HTTP/SSE endpoints (`https://...`) or runs local stdio binaries (`--command "node server.js"`).
6. **CI/CD Integration**: Built-in GitHub Action (`action.yml`) and workflow template for PR testing.

---

## 🛠️ Installation & Usage

### 1. HTTP / Streamable HTTP Server

```bash
npm run build
npm start https://your-mcp-server.com/mcp -- --format md
```

### 2. Local Stdio Command

Validate local MCP servers running over stdio before publishing:

```bash
npx tsx src/cli.ts --command "node dist/index.js" --format md
```

### 3. CI/CD GitHub Action

Add `.github/workflows/mcp-validator.yml` to your repository:

```yaml
steps:
  - uses: actions/checkout@v4
  - run: npm ci && npm run build
  - name: Validate MCP Server
    run: npx mcp-validator --command "node dist/index.js" --format md > mcp-report.md
```

---

## 🌐 Cloudflare Worker Web UI

Deploy to Cloudflare Workers for an instant browser-accessible UI:

```bash
npm run deploy
```

Access via browser or curl:
`https://mcp-validator.<subdomain>.workers.dev?url=https://your-mcp-server.com/mcp&format=md`
