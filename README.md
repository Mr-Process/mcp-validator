# ⚡ MCP Validator

[![GitHub Action](https://img.shields.io/badge/GitHub%20Action-v1.0-blue?logo=github-actions)](https://github.com/Mr-Process/mcp-validator/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare%20Workers-Deployed-orange?logo=cloudflare)](https://mcp-validator.jonathonpowell.workers.dev)
[![MCP Validated](https://mcp-validator.jonathonpowell.workers.dev/badge?url=https://acp-bridge-mcp.jonathonpowell.workers.dev/mcp)](https://mcp-validator.jonathonpowell.workers.dev)

An automated validation, schema testing, and security fuzzing engine for Model Context Protocol (MCP) servers. 

MCP Validator connects to any MCP server (over HTTP/SSE or local `stdio`), discovers its tools, resources, and prompts, auto-generates test suites from JSON Schemas, executes security fuzzing vectors, and reports what passes, what breaks, and what violates declared contracts.

---

## 📸 Overview & Architecture

```
                               ┌─────────────────────────┐
                               │     MCP Validator       │
                               └────────────┬────────────┘
                                            │
                    ┌───────────────────────┴───────────────────────┐
                    ▼                                               ▼
         ┌─────────────────────┐                         ┌─────────────────────┐
         │ HTTP / SSE Server   │                         │  Local Stdio Binary │
         │ (Streamable HTTP)   │                         │  (child_process)    │
         └──────────┬──────────┘                         └──────────┬──────────┘
                    │                                               │
                    └───────────────────────┬───────────────────────┘
                                            │
                                            ▼
                           ┌─────────────────────────────────┐
                           │      Validation Engine          │
                           ├─────────────────────────────────┤
                           │  • Tool Discovery & Execution   │
                           │  • Output Schema Validation     │
                           │  • Security Fuzzing (5 Vectors) │
                           │  • Resource & Prompt Testing    │
                           └────────────────┬────────────────┘
                                            │
                                            ▼
                           ┌─────────────────────────────────┐
                           │ Multi-Format Report Generation  │
                           │ (MD, JSON, SARIF, JUnit XML)    │
                           └─────────────────────────────────┘
```

---

## ✨ Features

- **📡 Dual Transport Support**: Connects to remote HTTP/Streamable HTTP endpoints (`https://...`) or spawns local CLI binaries (`--command "node dist/index.js"`).
- **🔑 Enterprise Authentication**: Pass custom headers (`-H "Authorization: Bearer <token>"`) to validate authenticated MCP servers.
- **🛠️ Tool Schema Validation**: Generates 6 test categories per tool (`valid_minimal`, `valid_full`, `edge_empty_string`, `edge_zero`, `edge_max`, `edge_boundary`, `invalid_missing_required`, `invalid_wrong_type`, `invalid_null`).
- **🛡️ Output Schema Validation**: Validates tool response payloads against declared `outputSchema` definitions, flagging `schema_mismatch` errors.
- **💣 Security Fuzzing**: Injects 5 security attack vectors per string property:
  - **SQL Injection**: `' OR '1'='1'; DROP TABLE users; --`
  - **Path Traversal**: `../../../../etc/passwd`
  - **XSS**: `<script>alert('mcp_xss')</script>`
  - **Format String**: `%s%s%s%n%x%d`
  - **Buffer Overflow**: `50,000` character string payloads
- **📄 Resource & Prompt Testing**: Automatically discovers and tests `resources/list`, `resources/read`, `prompts/list`, and `prompts/get`.
- **📊 Enterprise CI/CD Exporters**: Supports Markdown, JSON, **SARIF v2.1.0** (for GitHub Security / Code Scanning tab), and **JUnit XML** (for Jenkins, CircleCI, GitHub Actions).
- **🏷️ Dynamic SVG Badges**: Embed live badge SVG status cards in your server's README file.
- **🏆 Ecosystem Compatibility Benchmark**: Run automated benchmark matrix reports across public MCP servers.

---

## 📦 Quick Start

### 1. Run via npx / CLI

Validate a remote HTTP/SSE MCP server:
```bash
npx tsx src/cli.ts https://acp-bridge-mcp.jonathonpowell.workers.dev/mcp --format md
```

Validate an authenticated server with Bearer Token:
```bash
npx tsx src/cli.ts https://api.example.com/mcp -H "Authorization: Bearer my_secret_token" --format sarif
```

Validate a local stdio MCP server command:
```bash
npx tsx src/cli.ts --command "node dist/index.js" --format junit
```

### 2. Standalone Build & Run

```bash
# Install & build
npm install
npm run build

# Run built CLI
npm start https://acp-bridge-mcp.jonathonpowell.workers.dev/mcp -- --format md
```

---

## 🏷️ Live README SVG Badges

Add a live validation badge to your MCP server repository:

```markdown
[![MCP Validated](https://mcp-validator.jonathonpowell.workers.dev/badge?url=https://your-mcp-server.com/mcp)](https://mcp-validator.jonathonpowell.workers.dev)
```

---

## 🏆 Ecosystem Compatibility Benchmark

Run the automated benchmark suite against reference MCP servers to generate an ecosystem matrix:

```bash
npx tsx src/benchmark.ts
```

Output:
```markdown
# 🏆 MCP Server Ecosystem Compatibility Matrix

| Server Name | Category | Tools | Tests Run | Pass Rate | Fuzzing Passed | Latency (avg) | Status |
|-------------|----------|-------|-----------|-----------|----------------|---------------|--------|
| **Autonomous-ACP-Bridge** | Payment & Escrow Bridge | 5 | 100 | 100% | 45 | 95ms | 🟢 Compliant |
```

---

## 🤖 GitHub Action Integration

Automatically validate your MCP server on every push or pull request using the built-in GitHub Action:

```yaml
name: MCP Server CI

on:
  push:
    branches: [ main, master ]
  pull_request:

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci && npm run build

      - name: Run MCP Validator
        uses: Mr-Process/mcp-validator@main
        with:
          command: "node dist/index.js"
          format: "sarif"
```

---

## 📖 Command Line Options

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `<url>` | `string` | — | HTTP/Streamable HTTP MCP server URL |
| `--command` | `string` | — | Local command to execute stdio MCP server |
| `-H, --header` | `string` | — | Custom HTTP header (e.g. `-H "Authorization: Bearer token"`) |
| `--format` | `json` \| `md` \| `sarif` \| `junit` | `json` | Report output format |
| `--timeout` | `number` | `30000` | Request timeout in milliseconds |
| `--max-tests` | `number` | — | Limit total tool test cases executed |

---

## 📄 License

[MIT License](LICENSE) © 2026 Mr-Process
