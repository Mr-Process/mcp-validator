# ⚡ MCP Validator

[![GitHub Action](https://img.shields.io/badge/GitHub%20Action-v1.0-blue?logo=github-actions)](https://github.com/Mr-Process/mcp-validator/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare%20Workers-Deployed-orange?logo=cloudflare)](https://mcp-validator.jonathonpowell.workers.dev)
[![MCP Validated](https://mcp-validator.jonathonpowell.workers.dev/badge?url=https://acp-bridge-mcp.jonathonpowell.workers.dev/mcp)](https://mcp-validator.jonathonpowell.workers.dev)

An automated validation, schema testing, and security fuzzing engine for Model Context Protocol (MCP) servers.

---

## 💡 What Is MCP Validator?

Model Context Protocol (MCP) servers are multiplying rapidly across the AI landscape. However, most MCP servers are thin API wrappers created without automated test coverage or schema verification. Developers frequently ship MCP servers blind—without knowing if their tools correctly implement protocol specifications, adhere to declared JSON input/output schemas, or handle edge cases safely without crashing.

**MCP Validator** bridges this critical quality and security gap. It provides an automated, protocol-native test suite generator, contract validator, and security fuzzing engine for any MCP server.

Whether your MCP server runs as a remote HTTP/SSE cloud endpoint or a local command-line binary (`stdio`), **MCP Validator** automatically inspects your server, generates comprehensive test vectors, executes fuzzing payloads, and produces actionable validation reports.

---

## ⚙️ What It Does

MCP Validator executes an end-to-end, multi-stage automated validation pipeline against your target server:

1. **Protocol Handshake & Discovery**:
   - Establishes persistent MCP sessions via JSON-RPC 2.0 (`initialize` & `notifications/initialized`).
   - Automatically discovers all registered Tools (`tools/list`), Resources (`resources/list`), and Prompts (`prompts/list`).

2. **Schema-Driven Test Case Generation**:
   - Inspects each tool's JSON Schema definition.
   - Automatically builds 6 core functional test categories:
     - `valid_minimal`: Only required parameters with valid default values.
     - `valid_full`: Every declared parameter populated.
     - `edge_empty_string`, `edge_zero`, `edge_max`, `edge_boundary`: Boundary testing for numbers and strings.
     - `invalid_missing_required`: Verifies the server correctly rejects missing required parameters.
     - `invalid_wrong_type`: Sends invalid data types (e.g. string where number is expected).
     - `invalid_null`: Tests null safety on non-null parameters.

3. **Security Fuzzing & Mutation Testing**:
   - Automatically injects 5 security attack vectors per string parameter to test server resilience:
     - **SQL Injection**: `' OR '1'='1'; DROP TABLE users; --`
     - **Path Traversal**: `../../../../etc/passwd`
     - **Cross-Site Scripting (XSS)**: `<script>alert('mcp_xss')</script>`
     - **Format String**: `%s%s%s%n%x%d`
     - **Buffer Overflow**: `50,000` character string payloads
   - Asserts that the server backend handles bad inputs safely (returning error responses) without crashing (`status: "crash"`).

4. **Output Contract Verification (`outputSchema`)**:
   - Validates returned tool result payloads against declared `outputSchema` definitions.
   - Flags structural violations as `schema_mismatch` errors.

5. **Resource & Prompt Verification**:
   - Tests resource read capabilities (`resources/read`) and tracks content lengths and MIME types.
   - Tests prompt retrieval (`prompts/get`) with default and generated prompt arguments.

6. **Multi-Format Export & CI/CD Reporting**:
   - Generates reports in Markdown, JSON, **SARIF v2.1.0** (for native GitHub Security / Code Scanning tab integration), or **JUnit XML** (for CI test runners).

---

## 📸 Architecture & Pipeline Flow

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

## ✨ Key Features

- **📡 Dual Transport Support**: Connects to remote HTTP/Streamable HTTP endpoints (`https://...`) or spawns local CLI binaries (`--command "node dist/index.js"`).
- **🔑 Enterprise Authentication**: Pass custom headers (`-H "Authorization: Bearer <token>"`) to validate authenticated MCP servers.
- **🛠️ Tool Schema Validation**: Generates valid, edge, missing parameter, invalid type, and null test cases per tool.
- **🛡️ Output Schema Validation**: Validates tool response payloads against declared `outputSchema` definitions.
- **💣 Security Fuzzing**: Tests SQLi, Path Traversal, XSS, Format Strings, and Buffer Overflows.
- **📄 Resource & Prompt Testing**: Automatically discovers and tests `resources/list`, `resources/read`, `prompts/list`, and `prompts/get`.
- **📊 Enterprise CI/CD Exporters**: Supports Markdown, JSON, **SARIF v2.1.0**, and **JUnit XML**.
- **🏷️ Dynamic SVG Badges**: Embed live badge SVG status cards in your server's README file.
- **🏆 Ecosystem Compatibility Benchmark**: Run automated benchmark matrix reports across public MCP servers.

---

## 📦 Quick Start

### 1. Run via CLI

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
